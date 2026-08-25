import os
from functools import lru_cache


def load_env_file():
    env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if not os.path.isfile(env_file):
        return
    with open(env_file, encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip():
                os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def env_bool(name, default):
    value = os.getenv(name)
    return default if value is None else value.lower() in {"1", "true", "yes", "on"}


def env_int(name, default):
    value = os.getenv(name)
    return int(value) if value else default


load_env_file()


class Settings:
    def __init__(self):
        self.app_name = os.getenv("APP_NAME", "Система учёта сотрудников")
        self.database_url = os.getenv("DATABASE_URL", "postgresql://attendance:attendance@localhost:5432/attendance")
        self.cookie_name = os.getenv("COOKIE_NAME", "attendance_session")
        self.cookie_secure = env_bool("COOKIE_SECURE", False)
        self.session_days = env_int("SESSION_DAYS", 7)
        self.telegram_bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
        self.telegram_init_data_max_age = env_int("TELEGRAM_INIT_DATA_MAX_AGE", 86400)
        self.trusted_hosts = os.getenv("TRUSTED_HOSTS", "localhost,127.0.0.1")
        self.seed_demo_data = env_bool("SEED_DEMO_DATA", True)

    @property
    def trusted_host_list(self):
        return [host.strip() for host in self.trusted_hosts.split(",") if host.strip()]


@lru_cache
def get_settings():
    return Settings()
