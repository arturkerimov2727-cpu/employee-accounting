from datetime import datetime, timezone

from asyncpg import UniqueViolationError
from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..dependencies import AuthContext, get_pool, require_csrf_roles, require_roles
from app.schemas.schemas import SystemAction

router = APIRouter(prefix="/api/system", tags=["system"])


async def write_audit(connection, actor: str, action: str, entity_type: str, entity_id: int | None, details: str):
    await connection.execute(
        """INSERT INTO audit_log (actor, action, entity_type, entity_id, details)
           VALUES ($1, $2, $3, $4, $5)""",
        actor, action, entity_type, entity_id, details,
    )


async def snapshot(pool, user: AuthContext) -> dict:
    employees = await pool.fetch(
        """SELECT e.id, e.full_name, e.department_id, d.name AS department,
                  e.position, e.phone, e.hired_at, e.active
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
                  a.event_type, a.event_time, a.source, a.comment, a.created_by
           FROM attendance_events a JOIN employees e ON e.id = a.employee_id
           JOIN departments d ON d.id = e.department_id
           ORDER BY a.event_time DESC LIMIT 1200"""
    )
    audit = await pool.fetch(
        """SELECT id, actor, action, entity_type, entity_id, details, created_at
           FROM audit_log ORDER BY created_at DESC LIMIT 200"""
    )
    setting_rows = await pool.fetch("SELECT key, value FROM settings")
    return {
        "employees": [{
            "id": row["id"], "fullName": row["full_name"], "departmentId": row["department_id"],
            "department": row["department"], "position": row["position"], "phone": row["phone"],
            "hiredAt": row["hired_at"].isoformat(), "active": row["active"],
        } for row in employees],
        "departments": [{"id": row["id"], "name": row["name"], "employeeCount": row["employee_count"]} for row in departments],
        "events": [{
            "id": row["id"], "employeeId": row["employee_id"], "employeeName": row["employee_name"],
            "department": row["department"], "eventType": row["event_type"],
            "eventTime": row["event_time"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "source": row["source"], "comment": row["comment"], "createdBy": row["created_by"],
        } for row in events],
        "audit": [{
            "id": row["id"], "actor": row["actor"], "action": row["action"],
            "entityType": row["entity_type"], "entityId": row["entity_id"], "details": row["details"],
            "createdAt": row["created_at"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        } for row in audit],
        "settings": {row["key"]: row["value"] for row in setting_rows},
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
                    employee_id = await connection.fetchval(
                        """INSERT INTO employees (full_name, department_id, position, phone, hired_at)
                           VALUES ($1, $2, $3, $4, $5::date) RETURNING id""",
                        payload.fullName.strip(), payload.departmentId, (payload.position or "Сотрудник").strip(),
                        (payload.phone or "").strip(), payload.hiredAt or datetime.now().date().isoformat(),
                    )
                    await write_audit(connection, user.email, "CREATE", "employee", employee_id, f"Добавлен сотрудник: {payload.fullName.strip()}")
                elif action == "updateEmployee":
                    if not payload.id or not payload.fullName or not payload.departmentId:
                        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Недостаточно данных")
                    result = await connection.execute(
                        """UPDATE employees SET full_name=$1, department_id=$2, position=$3, phone=$4, hired_at=$5::date
                           WHERE id=$6 AND active=TRUE""",
                        payload.fullName.strip(), payload.departmentId, (payload.position or "Сотрудник").strip(),
                        (payload.phone or "").strip(), payload.hiredAt, payload.id,
                    )
                    if result.endswith(" 0"):
                        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сотрудник не найден")
                    await write_audit(connection, user.email, "UPDATE", "employee", payload.id, f"Обновлены данные: {payload.fullName.strip()}")
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
                elif action == "addEvent":
                    if not payload.employeeId or payload.eventType not in {"IN", "OUT"}:
                        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Некорректное событие")
                    event_time = payload.eventTime or datetime.now(timezone.utc)
                    last = await connection.fetchval(
                        """SELECT event_type FROM attendance_events
                           WHERE employee_id=$1 AND event_time::date=$2::date
                           ORDER BY event_time DESC LIMIT 1""",
                        payload.employeeId, event_time.date(),
                    )
                    if last == payload.eventType:
                        message = "Приход уже отмечен" if payload.eventType == "IN" else "Уход уже отмечен"
                        raise HTTPException(status.HTTP_409_CONFLICT, message)
                    if payload.eventType == "OUT" and last != "IN":
                        raise HTTPException(status.HTTP_409_CONFLICT, "Сначала отметьте приход")
                    event_id = await connection.fetchval(
                        """INSERT INTO attendance_events (employee_id, event_type, event_time, source, comment, created_by)
                           VALUES ($1, $2, $3, 'WEB', $4, $5) RETURNING id""",
                        payload.employeeId, payload.eventType, event_time, payload.comment.strip(), user.email,
                    )
                    label = "Приход" if payload.eventType == "IN" else "Уход"
                    await write_audit(connection, user.email, payload.eventType, "attendance", event_id, f"{label}: сотрудник #{payload.employeeId}")
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
