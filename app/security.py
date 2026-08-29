import hashlib
import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

password_hasher = PasswordHasher()

def validate_password(password):
    errors: list[str] = []
    if len(password) < 10:
        errors.append("Пароль должен содержать минимум 10 символов")
    if not re.search(r"[a-zа-яё]", password):
        errors.append("Добавьте строчную букву")
    if not re.search(r"[A-ZА-ЯЁ]", password):
        errors.append("Добавьте заглавную букву")
    if not re.search(r"\d", password):
        errors.append("Добавьте цифру")
    return errors

def hash_password(password):
    return password_hasher.hash(password)

def verify_password(password_hash, password):
    try:
        return password_hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False

def create_session_token():
    return secrets.token_urlsafe(32)

def create_csrf_token():
    return secrets.token_urlsafe(24)

def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def constant_time_equal(first, second):
    return secrets.compare_digest(first, second)
