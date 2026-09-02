from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

class FullNameRequest(BaseModel):
    full_name: str = Field(min_length=3, max_length=120)

    @field_validator("full_name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 3:
            raise ValueError("ФИО должно содержать минимум 3 символа")
        return value


class RegisterRequest(FullNameRequest):
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)
    password_confirm: str = Field(min_length=10, max_length=256)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class AdminProfileRequest(FullNameRequest):
    email: EmailStr
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str | None = Field(default=None, min_length=10, max_length=256)


class SystemAction(BaseModel):
    action: str
    id: int | None = None
    employeeId: int | None = None
    eventType: Literal["IN", "OUT"] | None = None
    eventTime: datetime | None = None
    comment: str = Field(default="", max_length=500)
    name: str | None = Field(default=None, max_length=120)
    settings: dict[str, str] | None = None
    fullName: str | None = Field(default=None, max_length=160)
    departmentId: int | None = None
    position: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    birthDate: date | None = None
    hiredAt: str | None = None
    telegramId: int | None = None

    @field_validator("fullName")
    @classmethod
    def clean_optional_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = " ".join(value.split())
        if len(value) < 3:
            raise ValueError("ФИО должно содержать минимум 3 символа")
        return value


class ScheduleDay(BaseModel):
    weekday: int = Field(ge=0, le=6)
    isWorkday: bool
    startsAt: str | None = None
    endsAt: str | None = None

    @model_validator(mode="after")
    def validate_time_range(self):
        if not self.isWorkday:
            return self
        if not self.startsAt or not self.endsAt:
            raise ValueError("Для рабочего дня укажите начало и конец смены")
        try:
            starts_at = time.fromisoformat(self.startsAt)
            ends_at = time.fromisoformat(self.endsAt)
        except ValueError as exc:
            raise ValueError("Укажите корректное время смены") from exc
        if starts_at >= ends_at:
            raise ValueError("Конец смены должен быть позже начала")
        return self


class ScheduleRequest(BaseModel):
    schedule: list[ScheduleDay] = Field(min_length=7, max_length=7)


class AbsenceRequest(BaseModel):
    employeeId: int = Field(gt=0)
    absenceType: Literal["vacation", "sick_leave", "business_trip", "approved_absence"]
    startsOn: date
    endsOn: date
    comment: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def validate_period(self):
        if self.endsOn < self.startsOn:
            raise ValueError("Дата окончания раньше даты начала")
        return self

class UserStatusRequest(BaseModel):
    status: Literal["active", "disabled"]
    role: Literal["admin", "manager", "viewer"] | None = None

class AttendanceCorrectionRequest(BaseModel):
    event_time: datetime
    reason: str = Field(min_length=3, max_length=500)
