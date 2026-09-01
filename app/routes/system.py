from datetime import date, datetime, timezone

from asyncpg import UniqueViolationError
from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..dependencies import AuthContext, get_pool, require_csrf_roles, require_roles
from ..services.attendance import attendance_days, ensure_default_schedule, record_attendance_event, write_audit
from app.schemas.schemas import SystemAction

router = APIRouter(prefix="/api/system", tags=["system"])


def hired_at(value):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Некорректная дата приёма") from None

async def snapshot(pool, user):
    employees = await pool.fetch(
        """SELECT e.id, e.full_name, e.department_id, d.name AS department,
                  e.position, e.phone, e.email, e.birth_date, e.hired_at, e.active, e.telegram_id
           FROM employees e JOIN departments d ON d.id = e.department_id
           WHERE e.active = TRUE ORDER BY e.full_name"""
    )
    departments = await pool.fetch(
        """SELECT d.id, d.name, count(e.id)::int AS employee_count
           FROM departments d LEFT JOIN employees e ON e.department_id = d.id AND e.active = TRUE
           GROUP BY d.id, d.name ORDER BY d.name"""
    )
    events = await pool.fetch(
        """SELECT a.id, a.employee_id, e.full_name AS employee_name, d.name AS department,
                  a.event_type, a.event_time, a.source, a.comment, a.created_by,
                  COALESCE(u.full_name, marker.full_name, a.created_by) AS created_by_name,
                  COALESCE(u.email::text, marker.email::text, '') AS created_by_email
           FROM attendance_events a JOIN employees e ON e.id = a.employee_id
           JOIN departments d ON d.id = e.department_id
           LEFT JOIN users u ON lower(u.email::text) = lower(a.created_by)
           LEFT JOIN employees marker ON marker.telegram_id::text = a.created_by
           ORDER BY a.event_time DESC LIMIT 1200"""
    )
    audit = await pool.fetch(
        """SELECT id, actor, action, entity_type, entity_id, details, created_at
           FROM audit_log ORDER BY created_at DESC LIMIT 200"""
    )
    pending_user_ids = []
    if user.role == "admin":
        pending_user_ids = await pool.fetch(
            "SELECT id FROM users WHERE status = 'pending' ORDER BY created_at DESC"
        )
    setting_rows = await pool.fetch("SELECT key, value FROM settings")
    settings = {row["key"]: row["value"] for row in setting_rows}
    today = datetime.now().date()
    dashboard_days = [
        (await attendance_days(pool, employee["id"], today, today, settings.get("timezone")))[0]
        for employee in employees
    ]
    month_start = today.replace(day=1)
    month_days = [
        await attendance_days(pool, employee["id"], month_start, today, settings.get("timezone"))
        for employee in employees
    ]
    return {
        "employees": [{
            "id": row["id"], "fullName": row["full_name"], "departmentId": row["department_id"],
            "department": row["department"], "position": row["position"], "phone": row["phone"],
            "email": str(row["email"]) if row["email"] else "", "birthDate": row["birth_date"].isoformat() if row["birth_date"] else None,
            "hiredAt": row["hired_at"].isoformat(), "active": row["active"], "telegramId": row["telegram_id"],
        } for row in employees],
        "departments": [{"id": row["id"], "name": row["name"], "employeeCount": row["employee_count"]} for row in departments],
        "events": [{
            "id": row["id"], "employeeId": row["employee_id"], "employeeName": row["employee_name"],
            "department": row["department"], "eventType": row["event_type"],
            "eventTime": row["event_time"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "source": row["source"], "comment": row["comment"], "createdBy": row["created_by"],
            "createdByName": row["created_by_name"], "createdByEmail": row["created_by_email"],
        } for row in events],
        "audit": [{
            "id": row["id"], "actor": row["actor"], "action": row["action"],
            "entityType": row["entity_type"], "entityId": row["entity_id"], "details": row["details"],
            "createdAt": row["created_at"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        } for row in audit],
        "notifications": {
            "pendingUserIds": [row["id"] for row in pending_user_ids],
        },
        "settings": settings,
        "dashboard": {
            "totalEmployees": len(employees),
            "lateToday": sum(day["lateMinutes"] > 0 for day in dashboard_days),
            "absent": sum(day["state"] == "absent" for day in dashboard_days),
            "openShifts": sum(day["state"] == "open_shift" for day in dashboard_days),
            "monthOvertimeMinutes": sum(day["overtimeMinutes"] for days in month_days for day in days),
        },
        "user": {"id": user.user_id, "name": user.full_name, "email": user.email, "role": user.role},
    }


@router.get("")
async def get_system(request: Request, user: AuthContext = Depends(require_roles("admin", "manager", "viewer"))):
    return await snapshot(get_pool(request), user)


@router.post("")
async def mutate_system(
    payload: SystemAction,
    request: Request,
    user: AuthContext = Depends(require_csrf_roles("admin", "manager")),
):
    pool = get_pool(request)
    action = payload.action
    try:
        async with pool.acquire() as connection:
            async with connection.transaction():
                if action == "createEmployee":
                    if not payload.fullName or not payload.departmentId:
                        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Укажите ФИО и отдел")
                    employee_hired_at = hired_at(payload.hiredAt or datetime.now().date().isoformat())
                    employee_id = await connection.fetchval(
                        """INSERT INTO employees (full_name, department_id, position, phone, email, birth_date, hired_at, telegram_id)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id""",
                        payload.fullName.strip(), payload.departmentId, (payload.position or "Сотрудник").strip(),
                        (payload.phone or "").strip(), str(payload.email).lower() if payload.email else None,
                        payload.birthDate, employee_hired_at, payload.telegramId,
                    )
                    await ensure_default_schedule(connection, employee_id)
                    await write_audit(connection, user.email, "CREATE", "employee", employee_id, f"Добавлен сотрудник: {payload.fullName.strip()}")
                elif action == "updateEmployee":
                    if not payload.id or not payload.fullName or not payload.departmentId:
                        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Недостаточно данных")
                    before = await connection.fetchrow(
                        """SELECT full_name, department_id, position, phone, email, birth_date, hired_at, telegram_id
                           FROM employees WHERE id=$1 AND active=TRUE FOR UPDATE""", payload.id,
                    )
                    if not before:
                        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сотрудник не найден")
                    employee_hired_at = hired_at(payload.hiredAt)
                    result = await connection.execute(
                        """UPDATE employees SET full_name=$1, department_id=$2, position=$3, phone=$4, email=$5, birth_date=$6,
                           hired_at=$7::date, telegram_id=$8 WHERE id=$9 AND active=TRUE""",
                        payload.fullName.strip(), payload.departmentId, (payload.position or "Сотрудник").strip(),
                        (payload.phone or "").strip(), str(payload.email).lower() if payload.email else None,
                        payload.birthDate, employee_hired_at, payload.telegramId, payload.id,
                    )
                    if result.endswith(" 0"):
                        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сотрудник не найден")
                    await write_audit(connection, user.email, "UPDATE", "employee", payload.id, f"Обновлены данные: {payload.fullName.strip()}")
                    changes = []
                    fields = {"ФИО": (before["full_name"], payload.fullName.strip()), "Должность": (before["position"], (payload.position or "Сотрудник").strip()), "Телефон": (before["phone"], (payload.phone or "").strip()), "Почта": (before["email"], str(payload.email).lower() if payload.email else None), "Дата рождения": (before["birth_date"], payload.birthDate), "Telegram ID": (before["telegram_id"], payload.telegramId)}
                    for label, (old, new) in fields.items():
                        if str(old or "") != str(new or ""):
                            changes.append(f"{label}: {old or '—'} → {new or '—'}")
                    if before["department_id"] != payload.departmentId:
                        changes.append("Изменён отдел")
                    if changes:
                        await write_audit(connection, user.email, "EMPLOYEE_HISTORY", "employee", payload.id, "; ".join(changes))
                elif action == "archiveEmployee":
                    if not payload.id:
                        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Не указан сотрудник")
                    await connection.execute("UPDATE employees SET active=FALSE WHERE id=$1", payload.id)
                    await write_audit(connection, user.email, "ARCHIVE", "employee", payload.id, "Сотрудник перемещён в архив")
                elif action == "createDepartment":
                    name = (payload.name or "").strip()
                    if not name:
                        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Введите название отдела")
                    department_id = await connection.fetchval("INSERT INTO departments (name) VALUES ($1) RETURNING id", name)
                    await write_audit(connection, user.email, "CREATE", "department", department_id, f"Создан отдел: {name}")
                elif action == "deleteDepartment":
                    if user.role != "admin":
                        raise HTTPException(status.HTTP_403_FORBIDDEN, "Удалять отделы может только администратор")
                    if not payload.id:
                        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Не указан отдел")
                    department = await connection.fetchrow(
                        "SELECT id, name FROM departments WHERE id = $1 FOR UPDATE", payload.id
                    )
                    if not department:
                        raise HTTPException(status.HTTP_404_NOT_FOUND, "Отдел не найден")
                    employee_count = await connection.fetchval(
                        "SELECT count(*) FROM employees WHERE department_id = $1", payload.id
                    )
                    if employee_count:
                        raise HTTPException(
                            status.HTTP_409_CONFLICT,
                            "Нельзя удалить отдел: сначала переведите или удалите всех сотрудников",
                        )
                    await connection.execute("DELETE FROM departments WHERE id = $1", payload.id)
                    await write_audit(connection, user.email, "DELETE", "department", payload.id, f"Удалён отдел: {department['name']}")
                elif action == "addEvent":
                    if not payload.employeeId or payload.eventType not in {"IN", "OUT"}:
                        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Некорректное событие")
                    await record_attendance_event(
                        connection, payload.employeeId, payload.eventType, user.email, "WEB",
                        payload.eventTime or datetime.now(timezone.utc), payload.comment,
                    )
                elif action == "updateSettings":
                    if user.role != "admin":
                        raise HTTPException(status.HTTP_403_FORBIDDEN, "Настройки доступны только администратору")
                    allowed = {"organization", "workday_start", "workday_end", "timezone"}
                    for key, value in (payload.settings or {}).items():
                        if key in allowed:
                            await connection.execute(
                                """INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
                                   ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()""",
                                key, str(value),
                            )
                    await write_audit(connection, user.email, "UPDATE", "settings", None, "Обновлены настройки организации")
                else:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, "Неизвестное действие")
    except UniqueViolationError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Такая запись уже существует") from None
    return await snapshot(pool, user)
