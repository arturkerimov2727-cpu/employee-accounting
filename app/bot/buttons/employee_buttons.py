from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup


def employee_keyboard(employee_id, is_at_work):

    if is_at_work:
        action = "OUT"
        text = "🚪 УШЁЛ"

    else:
        action = "IN"
        text = "✅ ПРИШЁЛ"

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=text,
                    callback_data=f"attendance:{action}:{employee_id}"
                )
            ]
        ]
    )


def search_keyboard(employees):

    buttons = []

    for employee in employees:

        buttons.append(
            [
                InlineKeyboardButton(
                    text=employee["full_name"],
                    callback_data=f"employee:{employee['id']}"
                )
            ]
        )

    return InlineKeyboardMarkup(
        inline_keyboard=buttons
    )