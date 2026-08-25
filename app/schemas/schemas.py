from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=3, max_length=120)
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)
    password_confirm: str = Field(min_length=10, max_length=256)

    @field_validator("full_name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        return " ".join(value.split())


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class EmployeeRequest(BaseModel):
    id: int | None = None
    fullName: str = Field(min_length=3, max_length=160)
    departmentId: int
    position: str = Field(default="Сотрудник", max_length=120)
    phone: str = Field(default="", max_length=40)
    hiredAt: str


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
    hiredAt: str | None = None
    telegramId: int | None = None
    schedule: list[dict] | None = None
    absenceType: Literal["vacation", "sick_leave", "business_trip", "approved_absence"] | None = None
    startsOn: str | None = None
    endsOn: str | None = None
    eventId: int | None = None
    newEventTime: datetime | None = None


class UserStatusRequest(BaseModel):
    status: Literal["active", "disabled"]
    role: Literal["admin", "manager", "viewer"] | None = None


class AttendanceCorrectionRequest(BaseModel):
    event_time: datetime
    reason: str = Field(min_length=3, max_length=500)
