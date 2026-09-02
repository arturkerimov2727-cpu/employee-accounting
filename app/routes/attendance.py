import csv
import io
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response

from ..dependencies import AuthContext, get_pool, require_csrf_roles, require_roles
from ..reports.excel import create_excel_report, safe_cell_value
from ..reports.pdf import create_pdf_report
from ..schemas.schemas import AbsenceRequest, AttendanceCorrectionRequest, ScheduleRequest
from ..services.attendance import (
    attendance_days, get_timezone, period_bounds, require_aware_datetime,
    schedule_for_employee, settings_map, statistics_from_days, update_schedule,
    validate_event_sequence, write_audit,
)

router = APIRouter(prefix="/api/attendance", tags=["attendance"])


def parse_day(value, fallback):
    if not value:
        return fallback
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Некорректная дата") from exc


def validate_period_bounds(start, end):
    if end < start or (end - start).days > 731:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Некорректный период")


async def report_period(connection, from_date, to_date):
    settings = await settings_map(connection)
    today = datetime.now(get_timezone(settings.get("timezone"))).date()
    start = parse_day(from_date, today.replace(day=1))
    end = parse_day(to_date, today)
    validate_period_bounds(start, end)
    return start, end, settings.get("timezone")


async def employee_or_404(connection, employee_id):
    employee = await connection.fetchrow(
        """SELECT e.id, e.full_name, e.position, e.phone, e.hired_at,
                  d.id AS department_id, d.name AS department
           FROM employees e JOIN departments d ON d.id=e.department_id
           WHERE e.id=$1 AND e.active=TRUE""", employee_id,
    )
    if not employee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сотрудник не найден")
    return employee


async def employee_summary(connection, employee_id, start, end, timezone_name):
    days = await attendance_days(connection, employee_id, start, end, timezone_name)
    return {"period": {"from": start.isoformat(), "to": end.isoformat()}, "statistics": statistics_from_days(days), "days": days}


@router.get("/employees/{employee_id}/schedule")
async def get_schedule(employee_id: int, request: Request, _user: AuthContext = Depends(require_roles("admin", "manager", "viewer"))):
    pool = get_pool(request)
    async with pool.acquire() as connection:
        await employee_or_404(connection, employee_id)
        return {"schedule": await schedule_for_employee(connection, employee_id)}


@router.put("/employees/{employee_id}/schedule")
async def put_schedule(employee_id: int, payload: ScheduleRequest, request: Request, user: AuthContext = Depends(require_csrf_roles("admin", "manager"))):
    schedule = [item.model_dump() for item in payload.schedule]
    pool = get_pool(request)
    async with pool.acquire() as connection:
        async with connection.transaction():
            await employee_or_404(connection, employee_id)
            result = await update_schedule(connection, employee_id, schedule, user.email)
    return {"schedule": result}


@router.get("/employees/{employee_id}/summary")
async def get_employee_summary(
    employee_id: int, request: Request, period: str = Query("month"),
    from_date: str | None = Query(None, alias="from"), to_date: str | None = Query(None, alias="to"),
    _user: AuthContext = Depends(require_roles("admin", "manager", "viewer")),
):
    pool = get_pool(request)
    async with pool.acquire() as connection:
        settings = await settings_map(connection)
        today = datetime.now(get_timezone(settings.get("timezone"))).date()
        start, end = period_bounds(period, today) if not from_date and not to_date else (parse_day(from_date, today), parse_day(to_date, today))
        validate_period_bounds(start, end)
        employee = await employee_or_404(connection, employee_id)
        result = await employee_summary(connection, employee_id, start, end, settings.get("timezone"))
        result["employee"] = {"id": employee["id"], "fullName": employee["full_name"], "department": employee["department"], "position": employee["position"]}
        return result


@router.get("/employees/{employee_id}/calendar")
async def get_calendar(employee_id: int, request: Request, month: str | None = None, _user: AuthContext = Depends(require_roles("admin", "manager", "viewer"))):
    pool = get_pool(request)
    async with pool.acquire() as connection:
        settings = await settings_map(connection)
        current_month = datetime.now(get_timezone(settings.get("timezone"))).strftime("%Y-%m")
        try:
            start = date.fromisoformat(f"{month or current_month}-01")
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Некорректный месяц") from exc
        finish = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        await employee_or_404(connection, employee_id)
        return {"month": start.strftime("%Y-%m"), "days": await attendance_days(connection, employee_id, start, finish, settings.get("timezone"))}


@router.post("/absences")
async def add_absence(payload: AbsenceRequest, request: Request, user: AuthContext = Depends(require_csrf_roles("admin", "manager"))):
    employee_id = payload.employeeId
    absence_type = payload.absenceType
    start = payload.startsOn
    end = payload.endsOn
    pool = get_pool(request)
    async with pool.acquire() as connection:
        async with connection.transaction():
            await employee_or_404(connection, employee_id)
            absence_id = await connection.fetchval(
                """INSERT INTO employee_absences (employee_id, absence_type, starts_on, ends_on, comment, created_by)
                   VALUES ($1,$2,$3,$4,$5,$6) RETURNING id""",
                employee_id, absence_type, start, end, payload.comment, user.email,
            )
            await write_audit(connection, user.email, "CREATE_ABSENCE", "absence", absence_id, f"{absence_type}: сотрудник #{employee_id}, {start}—{end}")
    return {"id": absence_id, "message": "Отсутствие сохранено"}


@router.patch("/events/{event_id}")
async def correct_event(event_id: int, payload: AttendanceCorrectionRequest, request: Request, user: AuthContext = Depends(require_csrf_roles("admin", "manager"))):
    pool = get_pool(request)
    async with pool.acquire() as connection:
        async with connection.transaction():
            event = await connection.fetchrow("SELECT employee_id, event_type, event_time FROM attendance_events WHERE id=$1 FOR UPDATE", event_id)
            if not event:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Событие не найдено")
            corrected_time = require_aware_datetime(payload.event_time)
            rows = await connection.fetch(
                """SELECT id, event_type, event_time FROM attendance_events
                   WHERE employee_id=$1 ORDER BY event_time, id FOR UPDATE""",
                event["employee_id"],
            )
            sequence = [dict(row) for row in rows]
            for item in sequence:
                if item["id"] == event_id:
                    item["event_time"] = corrected_time
                    break
            sequence.sort(key=lambda item: (item["event_time"], item["id"]))
            validate_event_sequence(sequence)
            old_time = event["event_time"].isoformat()
            await connection.execute("UPDATE attendance_events SET event_time=$1, comment=CASE WHEN comment='' THEN $2 ELSE comment || E'\\nКоррекция: ' || $2 END WHERE id=$3", corrected_time, payload.reason.strip(), event_id)
            await write_audit(connection, user.email, "CORRECT_ATTENDANCE", "attendance", event_id, f"Сотрудник #{event['employee_id']}, {event['event_type']}: {old_time} -> {corrected_time.isoformat()}; причина: {payload.reason.strip()}")
    return {"message": "Время события исправлено"}


async def report_rows(connection, start, end, timezone_name, employee_id=None, department_id=None):
    conditions = ["TRUE"]
    args: list[object] = []
    if employee_id:
        args.append(employee_id)
        conditions.append(f"e.id=${len(args)}")
    if department_id:
        args.append(department_id)
        conditions.append(f"e.department_id=${len(args)}")
    employees = await connection.fetch(
        """SELECT e.id, e.full_name, d.name AS department FROM employees e
           JOIN departments d ON d.id=e.department_id WHERE """ + " AND ".join(conditions) + " ORDER BY e.full_name", *args,
    )
    rows = []
    for employee in employees:
        summary = await employee_summary(connection, employee["id"], start, end, timezone_name)
        rows.append({"employeeId": employee["id"], "fullName": employee["full_name"], "department": employee["department"], **summary["statistics"]})
    return rows


@router.get("/analytics/lateness")
async def lateness_analytics(
    request: Request, from_date: str | None = Query(None, alias="from"), to_date: str | None = Query(None, alias="to"), employee_id: int | None = None, department_id: int | None = None,
    _user: AuthContext = Depends(require_roles("admin", "manager")),
):
    pool = get_pool(request)
    async with pool.acquire() as connection:
        start, end, timezone_name = await report_period(connection, from_date, to_date)
        rows = await report_rows(connection, start, end, timezone_name, employee_id, department_id)
    return {"period": {"from": start.isoformat(), "to": end.isoformat()}, "rows": [
        {**row, "averageLateMinutes": round(row["lateMinutes"] / row["lateCount"]) if row["lateCount"] else 0} for row in rows if row["lateCount"]
    ]}


@router.get("/export/{file_format}")
async def export_report(
    file_format: str, request: Request, from_date: str | None = Query(None, alias="from"), to_date: str | None = Query(None, alias="to"), employee_id: int | None = None, department_id: int | None = None,
    _user: AuthContext = Depends(require_roles("admin", "manager", "viewer")),
):
    if file_format not in {"csv", "xlsx", "pdf"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Поддерживаются CSV, XLSX и PDF")
    pool = get_pool(request)
    async with pool.acquire() as connection:
        start, end, timezone_name = await report_period(connection, from_date, to_date)
        rows = await report_rows(connection, start, end, timezone_name, employee_id, department_id)
    headings = ["ФИО", "Отдел", "Смены", "Рабочие минуты", "Опоздания", "Минуты опозданий", "Ранние уходы", "Переработка", "Отсутствия"]
    values = [[row["fullName"], row["department"], row["shifts"], row["workedMinutes"], row["lateCount"], row["lateMinutes"], row["earlyLeaveCount"], row["overtimeMinutes"], row["missedWorkdays"]] for row in rows]
    filename = f"attendance-{start}-{end}.{file_format}"
    if file_format == "csv":
        stream = io.StringIO()
        writer = csv.writer(stream, delimiter=";")
        writer.writerow([f"Период: {start} — {end}"])
        writer.writerow(headings)
        writer.writerows([[safe_cell_value(value) for value in row] for row in values])
        return Response("\ufeff" + stream.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    if file_format == "xlsx":
        content = create_excel_report(f"{start} — {end}", headings, values)
        return Response(content, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    content = create_pdf_report(f"{start} — {end}", headings, values)
    return Response(content, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
