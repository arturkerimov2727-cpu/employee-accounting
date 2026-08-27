from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..dependencies import AuthContext, get_pool, require_roles, require_csrf_roles
from app.schemas.schemas import UserStatusRequest

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("")
async def list_users(request: Request, _user: AuthContext = Depends(require_roles("admin"))):
    rows = await get_pool(request).fetch(
        """SELECT id, full_name, email::text, role, status, created_at, approved_at
           FROM users ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC"""
    )
    return {"users": [
        {"id": row["id"], "fullName": row["full_name"], "email": row["email"],
         "role": row["role"], "status": row["status"],
         "createdAt": row["created_at"].isoformat(),
         "approvedAt": row["approved_at"].isoformat() if row["approved_at"] else None}
        for row in rows
    ]}


@router.patch("/{user_id}")
async def update_user(
    user_id: int,
    payload: UserStatusRequest,
    request: Request,
    actor: AuthContext = Depends(require_csrf_roles("admin")),
):
    if user_id == actor.user_id and payload.status == "disabled":
        raise HTTPException(status.HTTP_409_CONFLICT, "Нельзя отключить собственный аккаунт")
    pool = get_pool(request)
    target = await pool.fetchrow("SELECT email::text, role FROM users WHERE id = $1", user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    role = payload.role or target["role"]
    removing_active_admin = target["role"] == "admin" and (role != "admin" or payload.status != "active")
    if removing_active_admin:
        admin_count = await pool.fetchval("SELECT count(*) FROM users WHERE role = 'admin' AND status = 'active'")
        if admin_count <= 1:
            raise HTTPException(status.HTTP_409_CONFLICT, "В системе должен остаться хотя бы один активный администратор")
    await pool.execute(
        """UPDATE users SET status = $1, role = $2,
           approved_at = CASE WHEN $1 = 'active' THEN COALESCE(approved_at, now()) ELSE approved_at END
           WHERE id = $3""",
        payload.status, role, user_id,
    )
    if payload.status == "disabled":
        await pool.execute("DELETE FROM sessions WHERE user_id = $1", user_id)
    await pool.execute(
        """INSERT INTO audit_log (actor, action, entity_type, entity_id, details)
           VALUES ($1, 'UPDATE_ACCESS', 'user', $2, $3)""",
        actor.email, user_id, f"Права {target['email']}: {role}, {payload.status}",
    )
    return {"message": "Доступ пользователя обновлён"}
