import csv
import io
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response

from ..dependencies import AuthContext, get_pool, require_csrf_roles, require_roles
from ..schemas.schemas import AttendanceCorrectionRequest
from ..services.attendance import (
    attendance_days, period_bounds, schedule_for_employee, settings_map,
    statistics_from_days, update_schedule, write_audit,
)

router = APIRouter(prefix="/api/attendance", tags=["attendance"])


def parse_day(value, fallback):
    if not value:
        return fallback
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Некорректная дата") from exc


async def employee_or_404(connection, employee_id):
    employee = await connection.fetchrow(
        """SELECT e.id, e.full_name, e.position, e.phone, e.hired_at, e.telegram_id,
                  d.id AS department_id, d.name AS department
           FROM employees e JOIN departments d ON d.id=e.department_id
           WHERE e.id=$1 AND e.active=TRUE""", employee_id,
    )
    if not employee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сотрудник не найден")
    return employee


async def employee_summary(connection, employee_id, start, end):
    settings = await settings_map(connection)
    days = await attendance_days(connection, employee_id, start, end, settings.get("timezone"))
    return {"period": {"from": start.isoformat(), "to": end.isoformat()}, "statistics": statistics_from_days(days), "days": days}


@router.get("/employees/{employee_id}/schedule")
async def get_schedule(employee_id: int, request: Request, _user: AuthContext = Depends(require_roles("admin", "manager", "viewer"))):
    pool = get_pool(request)
    async with pool.acquire() as connection:
        await employee_or_404(connection, employee_id)
        return {"schedule": await schedule_for_employee(connection, employee_id)}


@router.put("/employees/{employee_id}/schedule")
async def put_schedule(employee_id: int, payload: dict, request: Request, user: AuthContext = Depends(require_csrf_roles("admin", "manager"))):
    schedule = payload.get("schedule")
    if not isinstance(schedule, list):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Не передан рабочий график")
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
    today = datetime.now().date()
    start, end = period_bounds(period, today) if not from_date and not to_date else (parse_day(from_date, today), parse_day(to_date, today))
    if end < start or (end - start).days > 731:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Некорректный период")
    pool = get_pool(request)
    async with pool.acquire() as connection:
        employee = await employee_or_404(connection, employee_id)
        result = await employee_summary(connection, employee_id, start, end)
        result["employee"] = {"id": employee["id"], "fullName": employee["full_name"], "department": employee["department"], "position": employee["position"]}
        return result


@router.get("/employees/{employee_id}/calendar")
async def get_calendar(employee_id: int, request: Request, month: str | None = None, _user: AuthContext = Depends(require_roles("admin", "manager", "viewer"))):
    try:
        start = date.fromisoformat(f"{month or datetime.now().strftime('%Y-%m')}-01")
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Некорректный месяц") from exc
    finish = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    pool = get_pool(request)
    async with pool.acquire() as connection:
        await employee_or_404(connection, employee_id)
        settings = await settings_map(connection)
        return {"month": start.strftime("%Y-%m"), "days": await attendance_days(connection, employee_id, start, finish, settings.get("timezone"))}


@router.post("/absences")
async def add_absence(payload: dict, request: Request, user: AuthContext = Depends(require_csrf_roles("admin", "manager"))):
    employee_id = payload.get("employeeId")
    absence_type = payload.get("absenceType")
    if not isinstance(employee_id, int) or absence_type not in {"vacation", "sick_leave", "business_trip", "approved_absence"}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Некорректные данные отсутствия")
    start = parse_day(payload.get("startsOn"), datetime.now().date())
    end = parse_day(payload.get("endsOn"), start)
    if end < start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Дата окончания раньше даты начала")
    pool = get_pool(request)
    async with pool.acquire() as connection:
        async with connection.transaction():
            await employee_or_404(connection, employee_id)
            absence_id = await connection.fetchval(
                """INSERT INTO employee_absences (employee_id, absence_type, starts_on, ends_on, comment, created_by)
                   VALUES ($1,$2,$3,$4,$5,$6) RETURNING id""",
                employee_id, absence_type, start, end, str(payload.get("comment", ""))[:500], user.email,
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
            old_time = event["event_time"].isoformat()
            await connection.execute("UPDATE attendance_events SET event_time=$1, comment=CASE WHEN comment='' THEN $2 ELSE comment || E'\\nКоррекция: ' || $2 END WHERE id=$3", payload.event_time, payload.reason.strip(), event_id)
            await write_audit(connection, user.email, "CORRECT_ATTENDANCE", "attendance", event_id, f"Сотрудник #{event['employee_id']}, {event['event_type']}: {old_time} -> {payload.event_time.isoformat()}; причина: {payload.reason.strip()}")
    return {"message": "Время события исправлено"}


async def report_rows(connection, start, end, employee_id=None, department_id=None):
    conditions = ["e.active=TRUE"]
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
        summary = await employee_summary(connection, employee["id"], start, end)
        rows.append({"employeeId": employee["id"], "fullName": employee["full_name"], "department": employee["department"], **summary["statistics"]})
    return rows


@router.get("/analytics/lateness")
async def lateness_analytics(
    request: Request, from_date: str | None = Query(None, alias="from"), to_date: str | None = Query(None, alias="to"), employee_id: int | None = None, department_id: int | None = None,
    _user: AuthContext = Depends(require_roles("admin", "manager")),
):
    today = datetime.now().date()
    start = parse_day(from_date, today.replace(day=1))
    end = parse_day(to_date, today)
    pool = get_pool(request)
    async with pool.acquire() as connection:
        rows = await report_rows(connection, start, end, employee_id, department_id)
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
    today = datetime.now().date()
    start, end = parse_day(from_date, today.replace(day=1)), parse_day(to_date, today)
    if end < start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Некорректный период")
    pool = get_pool(request)
    async with pool.acquire() as connection:
        rows = await report_rows(connection, start, end, employee_id, department_id)
    headings = ["ФИО", "Отдел", "Смены", "Рабочие минуты", "Опоздания", "Минуты опозданий", "Ранние уходы", "Переработка", "Отсутствия"]
    values = [[row["fullName"], row["department"], row["shifts"], row["workedMinutes"], row["lateCount"], row["lateMinutes"], row["earlyLeaveCount"], row["overtimeMinutes"], row["missedWorkdays"]] for row in rows]
    filename = f"attendance-{start}-{end}.{file_format}"
    if file_format == "csv":
        stream = io.StringIO()
        writer = csv.writer(stream, delimiter=";")
        writer.writerow([f"Период: {start} — {end}"])
        writer.writerow(headings)
        writer.writerows(values)
        return Response("\ufeff" + stream.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    if file_format == "xlsx":
        from openpyxl import Workbook
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Посещаемость"
        sheet.append([f"Период: {start} — {end}"])
        sheet.append(headings)
        for value in values:
            sheet.append(value)
        for column in sheet.columns:
            sheet.column_dimensions[column[0].column_letter].width = min(28, max(12, max(len(str(cell.value or "")) for cell in column) + 2))
        output = io.BytesIO()
        workbook.save(output)
        return Response(output.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=landscape(A4), title="Отчёт посещаемости")
    styles = getSampleStyleSheet()
    table = Table([headings] + values, repeatRows=1)
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1d67cf")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), .25, colors.HexColor("#d9e1ed")), ("FONTSIZE", (0, 0), (-1, -1), 7), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    document.build([Paragraph(f"Отчёт посещаемости: {start} — {end}", styles["Title"]), Spacer(1, 12), table])
    return Response(output.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
