# Employee Attendance System

Система учёта прихода и ухода сотрудников: FastAPI, PostgreSQL и веб-интерфейс руководителя.

## Структура

- `app/routes` — HTTP-маршруты FastAPI.
- `app/config.py` — настройки приложения.
- `app/database.py` — пул PostgreSQL, схема и демонстрационные данные.
- `app/security.py` — хеширование паролей и сессии.
- `app/static` — CSS, JavaScript и изображения.
- `app/templates` — HTML-шаблоны.
- `app/sql` — SQL-схема базы данных.

Рабочий срез включает авторизацию, управление сотрудниками, регистрацию событий
прихода/ухода и отчёты через HTML-интерфейс.

## Запуск локально

```powershell
python -m venv .venv
.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python main.py
```

Перед запуском убедитесь, что PostgreSQL доступен по `DATABASE_URL` из `.env`.
Docker Compose для локальной базы находится в `deploy/docker-compose.yml`.
