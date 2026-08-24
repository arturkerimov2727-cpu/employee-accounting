import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl

from fastapi import APIRouter, HTTPException, Request, status

from ..dependencies import get_pool
from ..services.attendance import (
    attendance_days, period_bounds, record_attendance_event, schedule_for_employee,
    settings_map, statistics_from_days, write_audit,
)

router = APIRouter(prefix="/api/miniapp", tags=["miniapp"])


def verified_telegram_user(init_data, bot_token, max_age_seconds):
    if not bot_token:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Telegram Mini App ещё не настроено")
    values = dict(parse_qsl(init_data, keep_blank_values=True))
    supplied_hash = values.pop("hash", "")
    if not supplied_hash:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Не удалось подтвердить данные Telegram")
    data_check_string = "\n".join(f"{key}={values[key]}" for key in sorted(values))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    calculated = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calculated, supplied_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Недействительные данные Telegram")
    try:
        auth_date = int(values["auth_date"])
        user = json.loads(values["user"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "В данных Telegram нет пользователя") from exc
    if datetime.now(timezone.utc).timestamp() - auth_date > max_age_seconds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Срок авторизации Telegram истёк. Откройте приложение заново")
    if not isinstance(user.get("id"), int):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Некорректный пользователь Telegram")
    return user


async def mini_context(request: Request):
    payload = await request.json()
    init_data = payload.get("init_data", "")
    settings = request.app.state.settings
    telegram_user = verified_telegram_user(init_data, settings.telegram_bot_token, settings.telegram_init_data_max_age)
    pool = get_pool(request)
    async with pool.acquire() as connection:
        employee = await connection.fetchrow(
            """SELECT e.id, e.full_name, e.position, e.phone, e.hired_at, d.name AS department
               FROM employees e JOIN departments d ON d.id=e.department_id
               WHERE e.telegram_id=$1 AND e.active=TRUE""", telegram_user["id"],
        )
        if not employee:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Ваш Telegram-аккаунт ещё не связан с сотрудником. Обратитесь к администратору")
    return telegram_user, employee, pool


async def mini_payload(request: Request, include_history=True):
    telegram_user, employee, pool = await mini_context(request)
    today = datetime.now().date()
    async with pool.acquire() as connection:
        settings = await settings_map(connection)
        day = (await attendance_days(connection, employee["id"], today, today, settings.get("timezone")))[0]
        history_start = today - timedelta(days=30)
        history = await attendance_days(connection, employee["id"], history_start, today, settings.get("timezone")) if include_history else []
        schedule = await schedule_for_employee(connection, employee["id"])
    return {
        "employee": {"fullName": employee["full_name"], "position": employee["position"], "department": employee["department"], "phone": employee["phone"], "telegramName": telegram_user.get("first_name", "")},
        "today": day, "schedule": schedule, "history": list(reversed(history)),
    }


@router.post("/me")
async def me(request: Request):
    return await mini_payload(request)


@router.post("/statistics")
async def statistics(request: Request):
    payload = await request.json()
    telegram_user, employee, pool = await mini_context_with_payload(request, payload)
    start, end = period_bounds(payload.get("period", "month"))
    async with pool.acquire() as connection:
        settings = await settings_map(connection)
        days = await attendance_days(connection, employee["id"], start, end, settings.get("timezone"))
    return {"period": {"from": start.isoformat(), "to": end.isoformat()}, "statistics": statistics_from_days(days)}


async def mini_context_with_payload(request: Request, payload):
    init_data = payload.get("init_data", "")
    settings = request.app.state.settings
    telegram_user = verified_telegram_user(init_data, settings.telegram_bot_token, settings.telegram_init_data_max_age)
    pool = get_pool(request)
    async with pool.acquire() as connection:
        employee = await connection.fetchrow(
            """SELECT e.id, e.full_name, e.position, d.name AS department FROM employees e
               JOIN departments d ON d.id=e.department_id WHERE e.telegram_id=$1 AND e.active=TRUE""", telegram_user["id"],
        )
    if not employee:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Ваш Telegram-аккаунт ещё не связан с сотрудником. Обратитесь к администратору")
    return telegram_user, employee, pool


@router.post("/attendance/{event_type}")
async def mark_attendance(event_type: str, request: Request):
    if event_type not in {"in", "out"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Неизвестное действие")
    payload = await request.json()
    telegram_user, employee, pool = await mini_context_with_payload(request, payload)
    async with pool.acquire() as connection:
        async with connection.transaction():
            event = await record_attendance_event(connection, employee["id"], event_type.upper(), str(telegram_user["id"]), "TELEGRAM_MINI_APP")
            settings = await settings_map(connection)
            today = datetime.now().date()
            day = (await attendance_days(connection, employee["id"], today, today, settings.get("timezone")))[0]
            await write_audit(connection, str(telegram_user["id"]), "MINI_APP", "attendance", event["id"], "Событие создано через Telegram Mini App")
    return {"message": "Приход зарегистрирован" if event_type == "in" else "Смена завершена", "event": {"eventType": event["eventType"], "eventTime": event["eventTime"].isoformat()}, "today": day}
