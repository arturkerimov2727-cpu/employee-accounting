"""Single source of truth for attendance calculations and event validation."""

from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status


ABSENCE_LABELS = {
    "vacation": "Отпуск",
    "sick_leave": "Больничный",
    "business_trip": "Командировка",
    "approved_absence": "Разрешённое отсутствие",
}

SCHEDULE_QUERY = """SELECT weekday, is_workday, starts_at, ends_at
                    FROM employee_schedules WHERE employee_id=$1 ORDER BY weekday"""


def get_timezone(name):
    try:
        return ZoneInfo(name or "Europe/Moscow")
    except Exception:
        return timezone(timedelta(hours=3))


def minutes_between(start, end):
    return max(0, round((end - start).total_seconds() / 60))


def require_aware_datetime(value):
    if value.tzinfo is None or value.utcoffset() is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Дата и время должны содержать часовой пояс",
        )
    return value


def validate_event_sequence(events):
    expected = "IN"
    previous_time = None
    for event in events:
        event_time = require_aware_datetime(event["event_time"])
        if previous_time is not None and event_time <= previous_time:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "События сотрудника должны идти в строгом хронологическом порядке",
            )
        if event["event_type"] != expected:
            message = "Сначала отметьте приход" if expected == "IN" else "Сначала отметьте уход"
            raise HTTPException(status.HTTP_409_CONFLICT, message)
        expected = "OUT" if expected == "IN" else "IN"
        previous_time = event_time


async def settings_map(connection):
    rows = await connection.fetch("SELECT key, value FROM settings")
    return {row["key"]: row["value"] for row in rows}


async def write_audit(connection, actor, action, entity_type, entity_id, details):
    await connection.execute(
        """INSERT INTO audit_log (actor, action, entity_type, entity_id, details)
           VALUES ($1, $2, $3, $4, $5)""",
        actor, action, entity_type, entity_id, details[:500],
    )


async def ensure_default_schedule(connection, employee_id, settings=None):
    settings = settings or await settings_map(connection)
    try:
        start = time.fromisoformat(settings.get("workday_start", "09:00"))
        end = time.fromisoformat(settings.get("workday_end", "18:00"))
        if start >= end:
            raise ValueError
    except (TypeError, ValueError):
        start, end = time(9), time(18)
    await connection.execute(
        """INSERT INTO employee_schedules (employee_id, weekday, is_workday, starts_at, ends_at)
           SELECT $1, weekday, weekday < 5,
                  CASE WHEN weekday < 5 THEN $2::time END,
                  CASE WHEN weekday < 5 THEN $3::time END
           FROM generate_series(0, 6) AS days(weekday)
           ON CONFLICT (employee_id, weekday) DO NOTHING""",
        employee_id, start, end,
    )


async def schedule_for_employee(connection, employee_id):
    rows = await connection.fetch(SCHEDULE_QUERY, employee_id)
    if len(rows) != 7:
        await ensure_default_schedule(connection, employee_id)
        rows = await connection.fetch(SCHEDULE_QUERY, employee_id)
    return [
        {"weekday": row["weekday"], "isWorkday": row["is_workday"],
         "startsAt": row["starts_at"].strftime("%H:%M") if row["starts_at"] else None,
         "endsAt": row["ends_at"].strftime("%H:%M") if row["ends_at"] else None}
        for row in rows
    ]


async def update_schedule(connection, employee_id, schedule, actor):
    if (
        not isinstance(schedule, list)
        or not all(isinstance(item, dict) for item in schedule)
        or len(schedule) != 7
        or {item.get("weekday") for item in schedule} != set(range(7))
    ):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "График должен содержать все дни недели")
    for item in schedule:
        weekday = item["weekday"]
        is_workday = bool(item.get("isWorkday"))
        starts_at = item.get("startsAt") if is_workday else None
        ends_at = item.get("endsAt") if is_workday else None
        if is_workday and (not starts_at or not ends_at):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Укажите корректное время смены")
        if is_workday:
            try:
                starts_at = time.fromisoformat(starts_at)
                ends_at = time.fromisoformat(ends_at)
            except (TypeError, ValueError) as exc:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "Укажите корректное время смены",
                ) from exc
            if starts_at >= ends_at:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Укажите корректное время смены")
        await connection.execute(
            """INSERT INTO employee_schedules (employee_id, weekday, is_workday, starts_at, ends_at, updated_at)
               VALUES ($1, $2, $3, $4::time, $5::time, now())
               ON CONFLICT (employee_id, weekday) DO UPDATE SET
                 is_workday=EXCLUDED.is_workday, starts_at=EXCLUDED.starts_at,
                 ends_at=EXCLUDED.ends_at, updated_at=now()""",
            employee_id, weekday, is_workday, starts_at, ends_at,
        )
    await write_audit(connection, actor, "UPDATE_SCHEDULE", "employee", employee_id, "Обновлён индивидуальный рабочий график")
    return await schedule_for_employee(connection, employee_id)


async def record_attendance_event(
    connection, employee_id, event_type, actor, source, event_time=None, comment="",
):
    if event_type not in {"IN", "OUT"}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Некорректный тип события")
    employee = await connection.fetchrow(
        "SELECT id, full_name FROM employees WHERE id=$1 AND active=TRUE FOR UPDATE", employee_id,
    )
    if not employee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сотрудник не найден")
    when = require_aware_datetime(event_time or datetime.now(timezone.utc))
    rows = await connection.fetch(
        """SELECT id, event_type, event_time FROM attendance_events
           WHERE employee_id=$1 ORDER BY event_time, id FOR UPDATE""",
        employee_id,
    )
    sequence = [dict(row) for row in rows]
    sequence.append({"id": None, "event_type": event_type, "event_time": when})
    sequence.sort(key=lambda item: (item["event_time"], item["id"] is None, item["id"] or 0))
    validate_event_sequence(sequence)
    event_id = await connection.fetchval(
        """INSERT INTO attendance_events (employee_id, event_type, event_time, source, comment, created_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id""",
        employee_id, event_type, when, source, comment.strip(), actor,
    )
    label = "Приход" if event_type == "IN" else "Уход"
    await write_audit(connection, actor, event_type, "attendance", event_id, f"{label}: {employee['full_name']} ({source})")
    return {"id": event_id, "employeeId": employee_id, "eventType": event_type, "eventTime": when, "employeeName": employee["full_name"]}


async def attendance_days(
    connection, employee_id, start_day, end_day, timezone_name=None, schedule=None,
):
    tz = get_timezone(timezone_name)
    start_at = datetime.combine(start_day, time.min, tzinfo=tz).astimezone(timezone.utc)
    end_at = datetime.combine(end_day + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    if schedule is None:
        schedule = await schedule_for_employee(connection, employee_id)
    schedule = {item["weekday"]: item for item in schedule}
    events = await connection.fetch(
        """SELECT id, event_type, event_time, source, comment FROM attendance_events
           WHERE employee_id=$1 AND event_time >= $2 AND event_time < $3
           ORDER BY event_time, id""", employee_id, start_at, end_at,
    )
    absences = await connection.fetch(
        """SELECT absence_type, starts_on, ends_on, comment FROM employee_absences
           WHERE employee_id=$1 AND starts_on <= $3 AND ends_on >= $2""", employee_id, start_day, end_day,
    )
    by_day = defaultdict(list)
    for event in events:
        by_day[event["event_time"].astimezone(tz).date()].append(event)
    absence_by_day = {}
    for absence in absences:
        cursor = max(start_day, absence["starts_on"])
        finish = min(end_day, absence["ends_on"])
        while cursor <= finish:
            absence_by_day[cursor] = absence
            cursor += timedelta(days=1)

    result = []
    cursor = start_day
    now = datetime.now(timezone.utc)
    while cursor <= end_day:
        day_schedule = schedule.get(cursor.weekday(), {"isWorkday": False, "startsAt": None, "endsAt": None})
        day_events = by_day.get(cursor, [])
        first_in = next((event for event in day_events if event["event_type"] == "IN"), None)
        last_out = next((event for event in reversed(day_events) if event["event_type"] == "OUT"), None)
        absence = absence_by_day.get(cursor)
        started = first_in["event_time"] if first_in else None
        ended = last_out["event_time"] if last_out and started else None
        is_open = bool(started and not ended)
        planned_minutes = 0
        late_minutes = early_leave_minutes = overtime_minutes = worked_minutes = 0
        if day_schedule["isWorkday"]:
            start_parts = [int(part) for part in day_schedule["startsAt"].split(":")]
            end_parts = [int(part) for part in day_schedule["endsAt"].split(":")]
            schedule_start = datetime.combine(cursor, time(*start_parts), tzinfo=tz)
            schedule_end = datetime.combine(cursor, time(*end_parts), tzinfo=tz)
            planned_minutes = minutes_between(schedule_start, schedule_end)
            if started:
                local_start = started.astimezone(tz)
                late_minutes = max(0, minutes_between(schedule_start, local_start))
                effective_end = ended or (now if cursor == now.astimezone(tz).date() else None)
                if effective_end:
                    worked_minutes = minutes_between(started, effective_end)
                    if ended:
                        early_leave_minutes = max(0, minutes_between(ended.astimezone(tz), schedule_end))
                        overtime_minutes = max(0, worked_minutes - planned_minutes)
        if absence:
            state = "absence"
        elif not day_schedule["isWorkday"]:
            state = "day_off"
        elif is_open:
            state = "open_shift"
        elif started and ended:
            state = "completed"
        elif cursor < now.astimezone(tz).date():
            state = "absent"
        else:
            state = "scheduled"
        result.append({
            "date": cursor.isoformat(), "state": state, "schedule": day_schedule,
            "in": started.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if started else None,
            "out": ended.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if ended else None,
            "workedMinutes": worked_minutes, "plannedMinutes": planned_minutes,
            "lateMinutes": late_minutes, "earlyLeaveMinutes": early_leave_minutes,
            "overtimeMinutes": overtime_minutes, "isOpen": is_open,
            "absenceType": absence["absence_type"] if absence else None,
            "absenceLabel": ABSENCE_LABELS.get(absence["absence_type"]) if absence else None,
            "absenceComment": absence["comment"] if absence else "",
            "events": [{"id": e["id"], "type": e["event_type"], "time": e["event_time"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z"), "comment": e["comment"]} for e in day_events],
        })
        cursor += timedelta(days=1)
    return result


def statistics_from_days(days):
    completed = [day for day in days if day["state"] == "completed"]
    return {
        "shifts": len(completed),
        "workedMinutes": sum(day["workedMinutes"] for day in completed),
        "averageShiftMinutes": round(sum(day["workedMinutes"] for day in completed) / len(completed)) if completed else 0,
        "lateCount": sum(1 for day in completed if day["lateMinutes"]),
        "lateMinutes": sum(day["lateMinutes"] for day in completed),
        "earlyLeaveCount": sum(1 for day in completed if day["earlyLeaveMinutes"]),
        "earlyLeaveMinutes": sum(day["earlyLeaveMinutes"] for day in completed),
        "overtimeMinutes": sum(day["overtimeMinutes"] for day in completed),
        "missedWorkdays": sum(1 for day in days if day["state"] == "absent"),
        "approvedAbsences": sum(1 for day in days if day["state"] == "absence"),
        "openShifts": sum(1 for day in days if day["state"] == "open_shift"),
    }


def period_bounds(period, reference=None):
    reference = reference or datetime.now().date()
    if period == "day":
        return reference, reference
    if period == "week":
        return reference - timedelta(days=reference.weekday()), reference
    if period == "month":
        return reference.replace(day=1), reference
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Период должен быть day, week или month")
