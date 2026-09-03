# Employee Attendance System

Система учёта прихода и ухода сотрудников с админкой.

## Структура

- `app/routes` — HTTP-маршруты FastAPI.
- `app/config.py` — настройки приложения.
- `app/database.py` — пул PostgreSQL, схема и демонстрационные данные.
- `app/security.py` — хеширование паролей и сессии.
- `app/static` — CSS, JavaScript и изображения.
- `app/templates` — HTML-шаблоны.
- `app/sql` — SQL-схема базы данных.

Функционал: авторизацию, управление сотрудниками, регистрацию событий
прихода/ухода и отчёты через HTML-интерфейс.

## Запуск локально
Для этого нужно подключить собственную базу данных, а я свою не дам <img src="https://cs7.pikabu.ru/post_img/big/2019/05/17/9/1558102364158648214.jpg">


```powershell
python -m venv .venv
.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
python main.py
```
