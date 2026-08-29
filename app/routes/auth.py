from datetime import datetime, timedelta, timezone

from asyncpg import UniqueViolationError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from ..config import Settings, get_settings
from ..dependencies import AuthContext, get_current_user, get_pool, require_csrf
from app.schemas.schemas import LoginRequest, RegisterRequest
from ..security import (
    create_csrf_token, create_session_token, hash_password, hash_token,
    validate_password, verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def public_user(user):
    return {"id": user.user_id, "name": user.full_name, "email": user.email, "role": user.role}


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, request: Request):
    if payload.password != payload.password_confirm:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Пароли не совпадают")
    password_errors = validate_password(payload.password)
    if password_errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, ". ".join(password_errors))
    pool = get_pool(request)
    try:
        async with pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute("SELECT pg_advisory_xact_lock($1::bigint)", 72819463)
                has_users = await connection.fetchval("SELECT EXISTS(SELECT 1 FROM users)")
                first_admin = not has_users
                role = "admin" if first_admin else "viewer"
                account_status = "active" if first_admin else "pending"
                row = await connection.fetchrow(
                    """INSERT INTO users (full_name, email, password_hash, role, status, approved_at)
                       VALUES ($1, $2, $3, $4, $5::varchar(20), CASE WHEN $5::varchar(20) = 'active' THEN now() END)
                       RETURNING id""",
                    payload.full_name, str(payload.email).lower(), hash_password(payload.password), role, account_status,
                )
                await connection.execute(
                    """INSERT INTO audit_log (actor, action, entity_type, entity_id, details)
                       VALUES ($1, 'REGISTER', 'user', $2, $3)""",
                    str(payload.email).lower(), row["id"],
                    "Создан первый аккаунт администратора" if first_admin else "Новая заявка на регистрацию",
                )
    except UniqueViolationError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Пользователь с таким email уже существует") from None
    return {
        "firstAdmin": first_admin,
        "message": "Аккаунт администратора создан. Теперь войдите." if first_admin
        else "Заявка отправлена. Дождитесь одобрения администратора.",
    }


@router.post("/login")
async def login(payload: LoginRequest, request: Request, settings: Settings = Depends(get_settings)):
    pool = get_pool(request)
    row = await pool.fetchrow(
        "SELECT id, full_name, email::text, password_hash, role, status FROM users WHERE email = $1",
        str(payload.email).lower(),
    )
    if not row or not verify_password(row["password_hash"], payload.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный email или пароль")
    if row["status"] == "pending":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Аккаунт ожидает одобрения администратора")
    if row["status"] != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Аккаунт отключён")
    raw_token, csrf_token = create_session_token(), create_csrf_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.session_days)
    await pool.execute("DELETE FROM sessions WHERE expires_at <= now()")
    await pool.execute(
        "INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at) VALUES ($1, $2, $3, $4)",
        row["id"], hash_token(raw_token), csrf_token, expires_at,
    )
    response = JSONResponse({"message": "Вход выполнен", "user": {"name": row["full_name"], "role": row["role"]}})
    common = {"secure": settings.cookie_secure, "samesite": "lax", "path": "/", "max_age": settings.session_days * 86400}
    response.set_cookie(settings.cookie_name, raw_token, httponly=True, **common)
    response.set_cookie("attendance_csrf", csrf_token, httponly=False, **common)
    return response


@router.get("/me")
async def me(user: AuthContext = Depends(get_current_user)):
    return {"user": public_user(user)}


@router.post("/logout")
async def logout(
    response: Response,
    request: Request,
    user: AuthContext = Depends(require_csrf),
    settings: Settings = Depends(get_settings),
):
    await get_pool(request).execute("DELETE FROM sessions WHERE id = $1", user.session_id)
    response.delete_cookie(settings.cookie_name, path="/")
    response.delete_cookie("attendance_csrf", path="/")
    return {"message": "Вы вышли из системы"}
