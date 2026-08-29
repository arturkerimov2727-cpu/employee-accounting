from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status

from .config import get_settings
from .security import constant_time_equal, hash_token


class AuthContext:
    def __init__(self, user_id, full_name, email, role, session_id, csrf_token):
        self.user_id = user_id
        self.full_name = full_name
        self.email = email
        self.role = role
        self.session_id = session_id
        self.csrf_token = csrf_token


def get_pool(request: Request):
    return request.app.state.pool


async def get_current_user(
    request: Request,
    settings=Depends(get_settings)
):
    raw_token = request.cookies.get(settings.cookie_name) # может быть ответ или None

    if not raw_token:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Требуется вход"
        )

    pool = get_pool(request)

    row = await pool.fetchrow(
        """
        SELECT
            s.id AS session_id,
            s.csrf_token,
            s.expires_at,
            u.id AS user_id,
            u.full_name,
            u.email::text,
            u.role,
            u.status
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1
        """,
        hash_token(raw_token)
    )

    if not row:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Сессия истекла"
        )

    if row["expires_at"] <= datetime.now(timezone.utc):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Сессия истекла"
        )

    if row["status"] != "active":
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Сессия истекла"
        )

    await pool.execute(
        "UPDATE sessions SET last_seen_at = now() WHERE id = $1",
        row["session_id"]
    )

    return AuthContext(
        row["user_id"],
        row["full_name"],
        row["email"],
        row["role"],
        row["session_id"],
        row["csrf_token"]
    )


async def require_csrf(
    request: Request,
    user=Depends(get_current_user)
):
    supplied = request.headers.get(
        "X-CSRF-Token",
        ""
    )

    if not supplied:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Некорректный CSRF-токен"
        )

    if not constant_time_equal(
        supplied,
        user.csrf_token
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Некорректный CSRF-токен"
        )

    return user


def require_roles(*roles):
    async def dependency(
        user=Depends(get_current_user)
    ):
        if user.role not in roles:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Недостаточно прав"
            )

        return user

    return dependency


def require_csrf_roles(*roles):
    async def dependency(
        user=Depends(require_csrf)
    ):
        if user.role not in roles:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Недостаточно прав"
            )

        return user

    return dependency