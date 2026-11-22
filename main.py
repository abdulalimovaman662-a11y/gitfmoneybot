
import os
import asyncio
import random
import sqlite3

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    Message,
    CallbackQuery,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    BotCommand
)

TOKEN = os.getenv("BOT_TOKEN")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))
DB_PATH = os.getenv("DB_PATH", "bot.db")

if not TOKEN:
    raise RuntimeError("Не задан BOT_TOKEN в настройках проекта")

bot = Bot(token=TOKEN)
dp = Dispatcher()

db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row

db.execute("""
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    spins INTEGER NOT NULL DEFAULT 3,
    referrals INTEGER NOT NULL DEFAULT 0,
    invited_by INTEGER
)
""")

db.execute("""
CREATE TABLE IF NOT EXISTS wins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
)
""")

db.commit()


def get_user(user_id):
    return db.execute(
        "SELECT * FROM users WHERE user_id = ?",
        (user_id,)
    ).fetchone()


def main_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="🎰 Крутить рулетку",
            callback_data="spin"
        )],
        [
            InlineKeyboardButton(
                text="👤 Мой баланс",
                callback_data="balance"
            ),
            InlineKeyboardButton(
                text="🎁 Призы",
                callback_data="prizes"
            )
        ],
        [InlineKeyboardButton(
            text="🔗 Пригласить друзей",
            callback_data="referral"
        )],
        [InlineKeyboardButton(
            text="📜 Правила",
            callback_data="rules"
        )]
    ])


async def register_user(user_id, referral_id=None):
    existing = get_user(user_id)

    if existing:
        return False

    if referral_id == user_id:
        referral_id = None

    if referral_id and not get_user(referral_id):
        referral_id = None

    db.execute(
        "INSERT INTO users (user_id, spins, invited_by) VALUES (?, 3, ?)",
        (user_id, referral_id)
    )

    if referral_id:
        db.execute(
            "UPDATE users SET referrals = referrals + 1 WHERE user_id = ?",
            (referral_id,)
        )

        inviter = get_user(referral_id)

        if inviter["referrals"] % 10 == 0:
            db.execute(
                "UPDATE users SET spins = spins + 3 WHERE user_id = ?",
                (referral_id,)
            )

            try:
                await bot.send_message(
                    referral_id,
                    "🎉 Поздравляем! Ты пригласил "
                    f"{inviter['referrals']} друзей и получил "
                    "ещё 3 прокрутки!"
                )
            except Exception:
                pass

    db.commit()
    return True


async def show_balance(message_or_callback, user_id):
    user = get_user(user_id)

    text = (
        f"🎰 Твои прокрутки: {user['spins']}\n"
        f"👥 Приглашено друзей: {user['referrals']}\n"
        f"🎁 До следующих 3 прокруток: "
        f"{10 - user['referrals'] % 10}"
    )

    if isinstance(message_or_callback, CallbackQuery):
        await message_or_callback.message.answer(text)
        await message_or_callback.answer()
    else:
        await message_or_callback.answer(text)


@dp.message(CommandStart())
async def start(message: Message):
    args = message.text.split(maxsplit=1)
    referral_id = None

    if len(args) > 1 and args[1].startswith("ref_"):
        try:
            referral_id = int(args[1][4:])
        except ValueError:
            pass

    is_new = await register_user(message.from_user.id, referral_id)

    if is_new:
        text = (
            "🎉 Добро пожаловать в NFT Roulette!\n\n"
            "Тебе начислено 3 бесплатные прокрутки.\n"
            "Удачи! 🍀"
        )
    else:
        text = "С возвращением! 🎰"

    await message.answer(text, reply_markup=main_keyboard())


@dp.message(Command("roulette"))
async def roulette_command(message: Message):
    await message.answer(
        "Нажми кнопку, чтобы испытать удачу!",
        reply_markup=main_keyboard()
    )


@dp.message(Command("balance"))
async def balance_command(message: Message):
    if not get_user(message.from_user.id):
        await register_user(message.from_user.id)
    await show_balance(message, message.from_user.id)


@dp.message(Command("referral"))
async def referral_command(message: Message):
    if not get_user(message.from_user.id):
        await register_user(message.from_user.id)

    me = await bot.get_me()
    link = f"https://t.me/{me.username}?start=ref_{message.from_user.id}"

    await message.answer(
        "🔗 Твоя личная ссылка:\n"
        f"{link}\n\n"
        "За каждые 10 новых приглашённых друзей "
        "ты получаешь 3 дополнительные прокрутки."
    )


@dp.message(Command("prizes"))
async def prizes_command(message: Message):
    await message.answer(
        "🎁 Главный приз — редкий Telegram NFT-подарок!\n"
        "Шанс джекпота: 0,01% на одну прокрутку.\n\n"
        "Выдача подарка производится администратором вручную."
    )


@dp.message(Command("rules"))
async def rules_command(message: Message):
    await message.answer(
        "📜 Правила рулетки:\n\n"
        "1. При первом запуске даются 3 прокрутки.\n"
        "2. За каждые 10 новых приглашённых друзей "
        "начисляются ещё 3 прокрутки.\n"
        "3. Шанс главного приза — 0,01% за прокрутку.\n"
        "4. При выигрыше администратор связывается с победителем "
        "и вручную отправляет NFT.\n"
        "5. Повторная регистрация не засчитывается как приглашение."
    )


@dp.message(Command("support"))
async def support_command(message: Message):
    await message.answer(
        "По вопросам поддержки напиши администратору бота."
    )


@dp.callback_query(F.data == "balance")
async def balance_button(callback: CallbackQuery):
    await show_balance(callback, callback.from_user.id)


@dp.callback_query(F.data == "prizes")
async def prizes_button(callback: CallbackQuery):
    await callback.message.answer(
        "🎁 Главный приз — редкий Telegram NFT-подарок!\n"
        "Шанс джекпота: 0,01%."
    )
    await callback.answer()


@dp.callback_query(F.data == "rules")
async def rules_button(callback: CallbackQuery):
    await rules_command(callback.message)
    await callback.answer()


@dp.callback_query(F.data == "referral")
async def referral_button(callback: CallbackQuery):
    me = await bot.get_me()
    link = f"https://t.me/{me.username}?start=ref_{callback.from_user.id}"

    await callback.message.answer(
        "🔗 Твоя ссылка для приглашений:\n"
        f"{link}\n\n"
        "10 новых друзей = 3 дополнительные прокрутки."
    )
    await callback.answer()


@dp.callback_query(F.data == "spin")
async def spin(callback: CallbackQuery):
    user_id = callback.from_user.id
    user = get_user(user_id)

    if not user:
        await register_user(user_id)
        user = get_user(user_id)

    if user["spins"] <= 0:
        await callback.answer(
            "У тебя закончились прокрутки!",
            show_alert=True
        )
        return

    db.execute(
        "UPDATE users SET spins = spins - 1 WHERE user_id = ?",
        (user_id,)
    )
    db.commit()

    # 0,01% = 1 шанс из 10 000
    jackpot = random.randrange(10000) == 0

    if jackpot:
        db.execute(
            "INSERT INTO wins (user_id) VALUES (?)",
            (user_id,)
        )
        db.commit()

        await callback.message.answer(
            "🎉🎉🎉 ДЖЕКПОТ!!!\n\n"
            "Ты выиграл редкий NFT-подарок!\n"
            "Администратор скоро свяжется с тобой "
            "для выдачи приза."
        )

        if ADMIN_ID:
            try:
                await bot.send_message(
                    ADMIN_ID,
                    "🏆 НОВЫЙ ПОБЕДИТЕЛЬ!\n"
                    f"ID пользователя: {user_id}\n"
                    f"Username: @{callback.from_user.username or 'нет'}\n"
                    "Приз ожидает выдачи."
                )
            except Exception:
                pass
    else:
        await callback.message.answer(
            "😔 В этот раз без выигрыша.\n"
            "Попробуй ещё раз!"
        )

    remaining = get_user(user_id)["spins"]

    await callback.message.answer(
        f"Осталось прокруток: {remaining}",
        reply_markup=main_keyboard()
    )
    await callback.answer()


@dp.message(Command("pending"))
async def pending_command(message: Message):
    if message.from_user.id != ADMIN_ID or not ADMIN_ID:
        return

    wins = db.execute(
        "SELECT id, user_id FROM wins WHERE status = 'pending'"
    ).fetchall()

    if not wins:
        await message.answer("Ожидающих выдачи призов нет.")
        return

    text = "🎁 Ожидают выдачи:\n\n"

    for win in wins:
        text += (
            f"Заявка #{win['id']} — пользователь "
            f"{win['user_id']}\n"
        )

    text += "\nЧтобы отметить выдачу: /done ID_ЗАЯВКИ"

    await message.answer(text)


@dp.message(Command("done"))
async def done_command(message: Message):
    if message.from_user.id != ADMIN_ID or not ADMIN_ID:
        return

    args = message.text.split()

    if len(args) != 2 or not args[1].isdigit():
        await message.answer("Используй: /done ID_ЗАЯВКИ")
        return

    win_id = int(args[1])

    cursor = db.execute(
        "UPDATE wins SET status = 'done' "
        "WHERE id = ? AND status = 'pending'",
        (win_id,)
    )
    db.commit()

    if cursor.rowcount:
        await message.answer(
            f"✅ Заявка #{win_id} отмечена как выданная."
        )
    else:
        await message.answer("Заявка не найдена или уже выдана.")


async def main():
    await bot.set_my_commands([
        BotCommand(command="start", description="Запустить бота"),
        BotCommand(command="roulette", description="Крутить рулетку"),
        BotCommand(command="balance", description="Мой баланс"),
        BotCommand(command="referral", description="Пригласить друзей"),
        BotCommand(command="prizes", description="Посмотреть призы"),
        BotCommand(command="rules", description="Правила"),
        BotCommand(command="support", description="Поддержка"),
        BotCommand(command="pending", description="Заявки на выдачу (админ)"),
        BotCommand(command="done", description="Отметить выдачу (админ)")
    ])

    print("NFT Roulette Bot запущен!")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
