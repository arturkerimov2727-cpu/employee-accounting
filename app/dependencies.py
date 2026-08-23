from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

import asyncpg
from fastapi import Depends, HTTPException, Request, status

from .config import Settings, get_settings
from .security import constant_time_equal, hash_token


@dataclass(frozen=True)
class AuthContext:
    user_id: int
    full_name: str
    email: str
    role: str
    session_id: int
    csrf_token: str


def get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.pool


async def get_current_user(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> AuthContext:
    raw_token = request.cookies.get(settings.cookie_name)
    if not raw_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется вход")
    pool = get_pool(request)
    row = await pool.fetchrow(
        """SELECT s.id AS session_id, s.csrf_token, s.expires_at,
                  u.id AS user_id, u.full_name, u.email::text, u.role, u.status
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = $1""",
        hash_token(raw_token),
    )
    if not row or row["expires_at"] <= datetime.now(timezone.utc) or row["status"] != "active":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия истекла")
    await pool.execute("UPDATE sessions SET last_seen_at = now() WHERE id = $1", row["session_id"])
    return AuthContext(
        user_id=row["user_id"], full_name=row["full_name"], email=row["email"],
        role=row["role"], session_id=row["session_id"], csrf_token=row["csrf_token"],
    )


async def require_csrf(request: Request, user: AuthContext = Depends(get_current_user)) -> AuthContext:
    supplied = request.headers.get("X-CSRF-Token", "")
    if not supplied or not constant_time_equal(supplied, user.csrf_token):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Некорректный CSRF-токен")
    return user


def require_roles(*roles: str) -> Callable:
    async def dependency(user: AuthContext = Depends(get_current_user)) -> AuthContext:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостаточно прав")
        return user
    return dependency


def require_csrf_roles(*roles: str) -> Callable:
    async def dependency(user: AuthContext = Depends(require_csrf)) -> AuthContext:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостаточно прав")
        return user
    return dependency
