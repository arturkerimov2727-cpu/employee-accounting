from aiogram.types import KeyboardButton, ReplyKeyboardMarkup, WebAppInfo


def main_keyboard(mini_app_url=""):
    keyboard = [[KeyboardButton(text="🔎 Найти сотрудника")]]
    if mini_app_url:
        keyboard.append([KeyboardButton(text="📱 Открыть приложение", web_app=WebAppInfo(url=mini_app_url))])
    return ReplyKeyboardMarkup(
        keyboard=keyboard,
        resize_keyboard=True
    )
