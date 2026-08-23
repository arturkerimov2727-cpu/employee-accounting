from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Система учёта сотрудников"

    database_url: str = "postgresql://attendance:attendance@localhost:5432/attendance"

    cookie_name: str = "attendance_session"
    cookie_secure: bool = False
    session_days: int = 7

    telegram_bot_token: str = ""

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


@lru_cache
def get_settings():
    return Settings()
