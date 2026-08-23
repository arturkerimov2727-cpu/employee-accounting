from aiogram.types import KeyboardButton, ReplyKeyboardMarkup


def main_keyboard():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="🔎 Найти сотрудника")]
        ],
        resize_keyboard=True
    )