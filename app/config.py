from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Система учёта сотрудников"

    database_url: str = "postgresql://attendance:attendance@localhost:5432/attendance"

    cookie_name: str = "attendance_session"
    cookie_secure: bool = False
    session_days: int = 7

    telegram_bot_token: str = ""
    telegram_mini_app_url: str = ""
    telegram_init_data_max_age: int = 86400
    telegram_guard_ids: str = ""

    trusted_hosts: str = "localhost,127.0.0.1"
    seed_demo_data: bool = True

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def trusted_host_list(self):
        return [
            host.strip()
            for host in self.trusted_hosts.split(",")
            if host.strip()
        ]

    @property
    def telegram_guard_id_list(self):
        return {int(value.strip()) for value in self.telegram_guard_ids.split(",") if value.strip().isdigit()}


@lru_cache
def get_settings():
    return Settings()
