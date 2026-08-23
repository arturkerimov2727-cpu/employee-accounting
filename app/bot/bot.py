import logging
from datetime import datetime, timezone

import asyncio

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.fsm.state import State, StatesGroup

from app.bot.buttons.employee_buttons import employee_keyboard, search_keyboard
from app.bot.keyboards.main_keyboard import main_keyboard


logger = logging.getLogger(__name__)
router = Router()


class SearchState(StatesGroup):
    waiting_for_name = State()


def guard_allowed(settings, telegram_id):
    return telegram_id in settings.telegram_guard_id_list


def format_time(value):

    if not value:
        return ""

    return value.astimezone(timezone.utc).strftime("%H:%M")


async def show_employee(message, pool, employee_id):

    employee = await pool.fetchrow(
        """
        SELECT
            e.id,
            e.full_name,
            d.name AS department,
            last.event_type,
            last.event_time

        FROM employees e

        JOIN departments d
            ON d.id = e.department_id

        LEFT JOIN LATERAL (
            SELECT event_type, event_time
            FROM attendance_events
            WHERE employee_id = e.id
              AND event_time::date = CURRENT_DATE
            ORDER BY event_time DESC
            LIMIT 1
        ) last ON TRUE

        WHERE e.id = $1
          AND e.active = TRUE
        """,
        employee_id
    )

    if not employee:
        await message.answer(
            "Сотрудник не найден или больше не работает."
        )
        return

    is_at_work = employee["event_type"] == "IN"

    if is_at_work:

        text = (
            f"👤 <b>{employee['full_name']}</b>\n"
            f"{employee['department']}\n\n"
            f"🟢 На работе с {format_time(employee['event_time'])}"
        )

    else:

        text = (
            f"👤 <b>{employee['full_name']}</b>\n"
            f"{employee['department']}\n\n"
            f"🔴 Не на работе"
        )

    await message.answer(
        text,
        reply_markup=employee_keyboard(
            employee_id,
            is_at_work
        )
    )


@router.message(CommandStart())
async def start_bot(message, settings):

    if not guard_allowed(
        settings,
        message.from_user.id
    ):
        await message.answer(
            "Доступ к боту не разрешён."
        )
        return

    await message.answer(
        "Откройте поиск сотрудника.",
        reply_markup=main_keyboard()
    )


@router.message(Command("find"))
@router.message(F.text == "🔎 Найти сотрудника")
async def start_search(message, state, settings):

    if not guard_allowed(
        settings,
        message.from_user.id
    ):
        await message.answer(
            "Доступ к боту не разрешён."
        )
        return

    await state.set_state(
        SearchState.waiting_for_name
    )

    await message.answer(
        "🔎 Введите фамилию или имя сотрудника:"
    )


@router.message(
    SearchState.waiting_for_name,
    F.text
)
async def search_employee(
    message,
    state,
    pool,
    settings
):

    if not guard_allowed(
        settings,
        message.from_user.id
    ):
        await message.answer(
            "Доступ к боту не разрешён."
        )
        return

    query = message.text.strip()

    if len(query) < 2:

        await message.answer(
            "Введите минимум 2 символа."
        )
        return

    employees = await pool.fetch(
        """
        SELECT id, full_name

        FROM employees

        WHERE active = TRUE
          AND full_name ILIKE $1

        ORDER BY full_name

        LIMIT 8
        """,
        f"%{query}%"
    )

    if not employees:

        await message.answer(
            "Ничего не найдено. Попробуйте другой запрос."
        )
        return

    await state.clear()

    await message.answer(
        "Выберите сотрудника:",
        reply_markup=search_keyboard(employees)
    )


@router.callback_query(
    F.data.startswith("employee:")
)
async def employee_selected(
    callback,
    pool,
    settings
):

    if not guard_allowed(
        settings,
        callback.from_user.id
    ):

        await callback.answer(
            "Доступ запрещён",
            show_alert=True
        )
        return

    await callback.answer()

    employee_id = int(
        callback.data.split(":")[1]
    )

    await show_employee(
        callback.message,
        pool,
        employee_id
    )


@router.callback_query(
    F.data.startswith("attendance:")
)
async def mark_attendance(
    callback,
    pool,
    settings
):

    if not guard_allowed(
        settings,
        callback.from_user.id
    ):

        await callback.answer(
            "Доступ запрещён",
            show_alert=True
        )
        return

    data = callback.data.split(":")

    event_type = data[1]
    employee_id = int(data[2])

    now = datetime.now(timezone.utc)

    async with pool.acquire() as connection:

        async with connection.transaction():

            employee = await connection.fetchrow(
                """
                SELECT full_name

                FROM employees

                WHERE id = $1
                  AND active = TRUE

                FOR UPDATE
                """,
                employee_id
            )

            if not employee:

                await callback.answer(
                    "Сотрудник не найден",
                    show_alert=True
                )
                return

            last_event = await connection.fetchval(
                """
                SELECT event_type

                FROM attendance_events

                WHERE employee_id = $1
                  AND event_time::date = CURRENT_DATE

                ORDER BY event_time DESC

                LIMIT 1
                """,
                employee_id
            )

            if event_type == "IN" and last_event == "IN":

                await callback.answer(
                    "Сотрудник уже на работе",
                    show_alert=True
                )
                return

            if event_type == "OUT" and last_event != "IN":

                await callback.answer(
                    "Сотрудник уже не на работе",
                    show_alert=True
                )
                return

            await connection.execute(
                """
                INSERT INTO attendance_events (
                    employee_id,
                    event_type,
                    event_time,
                    source,
                    created_by
                )

                VALUES ($1, $2, $3, 'TELEGRAM', $4)
                """,
                employee_id,
                event_type,
                now,
                str(callback.from_user.id)
            )

    await callback.answer("Записано")

    await callback.message.edit_reply_markup(
        reply_markup=None
    )

    await callback.message.answer(
        "✅ Запись сохранена."
    )


def create_dispatcher(pool, settings):

    dispatcher = Dispatcher()

    dispatcher["pool"] = pool
    dispatcher["settings"] = settings

    dispatcher.include_router(router)

    return dispatcher

async def run_bot(pool, settings):

    if not settings.telegram_bot_token:
        logger.info(
            "Telegram bot отключён: TELEGRAM_BOT_TOKEN пустой"
        )
        return

    bot = Bot(
        settings.telegram_bot_token,
        default=DefaultBotProperties(
            parse_mode=ParseMode.HTML
        )
    )

    dispatcher = create_dispatcher(
        pool,
        settings
    )

    await dispatcher.start_polling(
        bot,
        pool=pool,
        settings=settings
    )

def start_bot(pool, settings):
    return asyncio.create_task(
        run_bot(pool, settings)
    )