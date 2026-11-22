
import os
import asyncio
import random
import sqlite3
import aiohttp

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    Message,
    CallbackQuery,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    BotCommand,
    LabeledPrice,
    PreCheckoutQuery
)

TOKEN = os.getenv("BOT_TOKEN")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))
DB_PATH = os.getenv("DB_PATH", "bot.db")
STORE_API_URL = os.getenv("STORE_API_URL", "").rstrip("/")

if not TOKEN:
    raise RuntimeError("Не задан BOT_TOKEN")

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

db.execute("""
CREATE TABLE IF NOT EXISTS payments (
    charge_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    stars INTEGER NOT NULL,
    spins INTEGER NOT NULL
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
        [InlineKeyboardButton(
            text="⭐ 1 прокрутка — 5 Stars",
            callback_data="buy_1"
        )],
        [InlineKeyboardButton(
            text="⭐ 3 прокрутки — 15 Stars",
            callback_data="buy_3"
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
    if get_user(user_id):
        return False

    if referral_id == user_id:
        referral_id = None

    if referral_id and not get_user(referral_id):
        referral_id = None

    db.execute(
        "INSERT INTO users (user_id, spins, invited_by) "
        "VALUES (?, 3, ?)",
        (user_id, referral_id)
    )

    if referral_id:
        db.execute(
            "UPDATE users SET referrals = referrals + 1 "
            "WHERE user_id = ?",
            (referral_id,)
        )

        inviter = get_user(referral_id)

        if inviter["referrals"] % 10 == 0:
            db.execute(
                "UPDATE users SET spins = spins + 3 "
                "WHERE user_id = ?",
                (referral_id,)
            )

            try:
                await bot.send_message(
                    referral_id,
                    "🎉 Ты пригласил 10 новых друзей!\n"
                    "Начислено ещё 3 прокрутки."
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
        f"🎁 До следующих 3 бесплатных прокруток: "
        f"{10 - user['referrals'] % 10}"
    )

    if isinstance(message_or_callback, CallbackQuery):
        await message_or_callback.message.answer(
            text, reply_markup=main_keyboard()
        )
        await message_or_callback.answer()
    else:
        await message_or_callback.answer(
            text, reply_markup=main_keyboard()
        )


async def send_spin_invoice(user_id, count):
    if count == 1:
        price = 5
        title = "1 прокрутка"
        description = "Одна прокрутка NFT Roulette"
    else:
        price = 15
        title = "3 прокрутки"
        description = "Пакет из трёх прокруток NFT Roulette"

    await bot.send_invoice(
        chat_id=user_id,
        title=title,
        description=description,
        payload=f"spinpack:{count}:{user_id}",
        provider_token="",
        currency="XTR",
        prices=[
            LabeledPrice(label=title, amount=price)
        ]
    )


def parse_gift_payload(payload):
    try:
        parts = payload.split(":")
        if len(parts) != 4 or parts[0] != "gift":
            return None

        order_id = int(parts[1])
        user_id = int(parts[2])
        stars = int(parts[3])

        if order_id < 1 or user_id < 1 or stars < 1:
            return None

        return {
            "order_id": order_id,
            "user_id": user_id,
            "stars": stars
        }
    except (ValueError, IndexError):
        return None


async def validate_gift_order(order):
    if not STORE_API_URL:
        return False

    url = STORE_API_URL + "/api/internal/store/validate"

    data = {
        "order_id": order["order_id"],
        "telegram_id": order["user_id"],
        "stars": order["stars"],
        "currency": "XTR"
    }

    timeout = aiohttp.ClientTimeout(total=8)

    try:
        async with aiohttp.ClientSession(
            timeout=timeout
        ) as session:
            async with session.post(
                url,
                json=data,
                headers={"x-bot-token": TOKEN}
            ) as response:
                result = await response.json(
                    content_type=None
                )

                return (
                    response.status == 200
                    and result.get("valid") is True
                )

    except Exception as error:
        print(f"Ошибка проверки заказа: {error}")
        return False


async def sync_gift_payment(payment, user_id, order):
    if not STORE_API_URL:
        return False, "Не задан STORE_API_URL"

    url = STORE_API_URL + "/api/internal/store/paid"

    data = {
        "order_id": order["order_id"],
        "telegram_id": user_id,
        "stars": payment.total_amount,
        "currency": payment.currency,
        "charge_id": payment.telegram_payment_charge_id,
        "provider_charge_id": payment.provider_payment_charge_id
    }

    for attempt in range(3):
        try:
            timeout = aiohttp.ClientTimeout(total=8)

            async with aiohttp.ClientSession(
                timeout=timeout
            ) as session:
                async with session.post(
                    url,
                    json=data,
                    headers={"x-bot-token": TOKEN}
                ) as response:
                    result = await response.json(
                        content_type=None
                    )

                    if response.status == 200 and result.get("success"):
                        return True, "Заказ обновлён"

                    return False, result.get(
                        "error", "Сервер отклонил платёж"
                    )

        except Exception as error:
            if attempt < 2:
                await asyncio.sleep(1 + attempt)
            else:
                return False, str(error)

    return False, "Не удалось связаться с сервером магазина"


@dp.message(CommandStart())
async def start(message: Message):
    args = message.text.split(maxsplit=1)
    referral_id = None

    if len(args) > 1 and args[1].startswith("ref_"):
        try:
            referral_id = int(args[1][4:])
        except ValueError:
            pass

    is_new = await register_user(
        message.from_user.id, referral_id
    )

    if is_new:
        text = (
            "🎉 Добро пожаловать в GiftsDrop!\n\n"
            "Тебе начислено 3 бесплатные прокрутки.\n"
            "Удачи! 🍀"
        )
    else:
        text = "С возвращением! 🎰"

    await message.answer(text, reply_markup=main_keyboard())


@dp.message(Command("roulette"))
async def roulette_command(message: Message):
    await message.answer(
        "Выбери действие:",
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
    link = (
        f"https://t.me/{me.username}"
        f"?start=ref_{message.from_user.id}"
    )

    await message.answer(
        "🔗 Твоя личная ссылка:\n"
        f"{link}\n\n"
        "За каждые 10 новых друзей "
        "ты получаешь 3 прокрутки."
    )


@dp.message(Command("prizes"))
async def prizes_command(message: Message):
    await message.answer(
        "🎁 Главный приз — редкий Telegram NFT-подарок!\n"
        "Вероятность главного приза — 0,01% за прокрутку.\n\n"
        "Выдача производится администратором вручную."
    )


@dp.message(Command("rules"))
async def rules_command(message: Message):
    await message.answer(
        "📜 Правила GiftsDrop:\n\n"
        "1. При первом запуске даются 3 бесплатные прокрутки.\n"
        "2. За каждые 10 новых приглашённых друзей "
        "начисляются ещё 3 прокрутки.\n"
        "3. Одна прокрутка стоит 5 Stars.\n"
        "4. Три прокрутки стоят 15 Stars.\n"
        "5. Вероятность главного приза — 0,01%.\n"
        "6. Выдача призов и подарков производится вручную.\n"
        "7. Повторная регистрация не засчитывается."
    )


@dp.message(Command("support"))
@dp.message(Command("paysupport"))
async def support_command(message: Message):
    await message.answer(
        "По вопросам оплаты и поддержки "
        "обратись к администратору бота."
    )


@dp.message(Command("terms"))
async def terms_command(message: Message):
    await message.answer(
        "Условия использования GiftsDrop:\n\n"
        "Прокрутки и подарки приобретаются за Telegram Stars.\n"
        "Подарки отправляются администратором вручную "
        "после подтверждения оплаты.\n"
        "По вопросам платежей используй /paysupport."
    )


@dp.callback_query(F.data == "buy_1")
async def buy_one(callback: CallbackQuery):
    if not get_user(callback.from_user.id):
        await register_user(callback.from_user.id)

    await send_spin_invoice(callback.from_user.id, 1)
    await callback.answer()


@dp.callback_query(F.data == "buy_3")
async def buy_three(callback: CallbackQuery):
    if not get_user(callback.from_user.id):
        await register_user(callback.from_user.id)

    await send_spin_invoice(callback.from_user.id, 3)
    await callback.answer()


@dp.pre_checkout_query()
async def pre_checkout(query: PreCheckoutQuery):
    payload = query.invoice_payload
    valid = False

    if payload.startswith("spinpack:"):
        try:
            parts = payload.split(":")
            count = int(parts[1])
            user_id = int(parts[2])
            expected_price = 5 if count == 1 else 15

            valid = (
                count in (1, 3)
                and user_id == query.from_user.id
                and query.currency == "XTR"
                and query.total_amount == expected_price
            )
        except (ValueError, IndexError):
            valid = False

    elif payload.startswith("gift:"):
        order = parse_gift_payload(payload)

        if (
            order
            and order["user_id"] == query.from_user.id
            and order["stars"] == query.total_amount
            and query.currency == "XTR"
        ):
            valid = await validate_gift_order(order)

    await query.answer(
        ok=valid,
        error_message=(
            "Не удалось проверить заказ. "
            "Создай новый счёт и попробуй ещё раз."
        ) if not valid else None
    )


@dp.message(F.successful_payment)
async def successful_payment(message: Message):
    payment = message.successful_payment
    payload = payment.invoice_payload

    # Оплата подарка из магазина
    if payload.startswith("gift:"):
        order = parse_gift_payload(payload)

        if not order:
            await message.answer(
                "Платёж получен, но данные заказа некорректны. "
                "Администратор проверит оплату."
            )
            return

        if (
            order["user_id"] != message.from_user.id
            or payment.currency != "XTR"
            or payment.total_amount != order["stars"]
        ):
            await message.answer(
                "Платёж получен, но данные не совпали. "
                "Обратись в поддержку."
            )
            return

        success, result = await sync_gift_payment(
            payment,
            message.from_user.id,
            order
        )

        if success:
            await message.answer(
                "✅ Оплата подарка прошла успешно!\n\n"
                f"Номер заказа: #{order['order_id']}\n"
                "Заказ передан администратору.\n"
                "Подарок будет отправлен вручную."
            )

            if ADMIN_ID:
                try:
                    await bot.send_message(
                        ADMIN_ID,
                        "🎁 НОВЫЙ ОПЛАЧЕННЫЙ ЗАКАЗ!\n\n"
                        f"Заказ: #{order['order_id']}\n"
                        f"Покупатель: {message.from_user.id}\n"
                        f"Username: @{message.from_user.username or 'нет'}\n"
                        f"Оплата: {payment.total_amount} ⭐\n"
                        "Статус: ожидает отправки."
                    )
                except Exception:
                    pass
        else:
            await message.answer(
                "✅ Telegram подтвердил оплату.\n"
                "Заказ передан на дополнительную проверку. "
                "Не оплачивай его повторно."
            )

            if ADMIN_ID:
                try:
                    await bot.send_message(
                        ADMIN_ID,
                        "⚠️ НУЖНА ПРОВЕРКА ОПЛАТЫ ПОДАРКА!\n\n"
                        f"Заказ: #{order['order_id']}\n"
                        f"Покупатель: {message.from_user.id}\n"
                        f"Сумма: {payment.total_amount} ⭐\n"
                        f"Charge ID: {payment.telegram_payment_charge_id}\n"
                        f"Ошибка синхронизации: {result}"
                    )
                except Exception:
                    pass

        return

    # Старая оплата прокруток
    try:
        parts = payload.split(":")
        count = int(parts[1])
        user_id = int(parts[2])
    except (ValueError, IndexError):
        await message.answer(
            "Ошибка заказа. Обратись в поддержку."
        )
        return

    expected_price = 5 if count == 1 else 15

    if (
        parts[0] != "spinpack"
        or count not in (1, 3)
        or user_id != message.from_user.id
        or payment.currency != "XTR"
        or payment.total_amount != expected_price
    ):
        await message.answer(
            "Платёж получен, но данные заказа не совпали. "
            "Напиши в поддержку."
        )
        return

    try:
        db.execute(
            "INSERT INTO payments "
            "(charge_id, user_id, stars, spins) "
            "VALUES (?, ?, ?, ?)",
            (
                payment.telegram_payment_charge_id,
                user_id,
                payment.total_amount,
                count
            )
        )

        db.execute(
            "UPDATE users SET spins = spins + ? "
            "WHERE user_id = ?",
            (count, user_id)
        )

        db.commit()

    except sqlite3.IntegrityError:
        await message.answer(
            "Этот платёж уже был обработан."
        )
        return

    await message.answer(
        f"✅ Оплата прошла успешно!\n"
        f"Начислено прокруток: {count}.\n"
        f"Твой баланс: {get_user(user_id)['spins']}",
        reply_markup=main_keyboard()
    )

    if ADMIN_ID:
        try:
            await bot.send_message(
                ADMIN_ID,
                "💰 Новая оплата прокруток!\n"
                f"Пользователь: {user_id}\n"
                f"Stars: {payment.total_amount}\n"
                f"Прокруток: {count}"
            )
        except Exception:
            pass


@dp.callback_query(F.data == "balance")
async def balance_button(callback: CallbackQuery):
    await show_balance(callback, callback.from_user.id)


@dp.callback_query(F.data == "prizes")
async def prizes_button(callback: CallbackQuery):
    await prizes_command(callback.message)
    await callback.answer()


@dp.callback_query(F.data == "rules")
async def rules_button(callback: CallbackQuery):
    await rules_command(callback.message)
    await callback.answer()


@dp.callback_query(F.data == "referral")
async def referral_button(callback: CallbackQuery):
    me = await bot.get_me()
    link = (
        f"https://t.me/{me.username}"
        f"?start=ref_{callback.from_user.id}"
    )

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
        await callback.message.answer(
            "😔 Прокрутки закончились!\n\n"
            "Пригласи 10 друзей или выбери покупку:",
            reply_markup=main_keyboard()
        )
        await callback.answer()
        return

    db.execute(
        "UPDATE users SET spins = spins - 1 "
        "WHERE user_id = ?",
        (user_id,)
    )
    db.commit()

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
            "Администратор скоро свяжется с тобой."
        )

        if ADMIN_ID:
            try:
                await bot.send_message(
                    ADMIN_ID,
                    "🏆 НОВЫЙ ПОБЕДИТЕЛЬ!\n"
                    f"ID: {user_id}\n"
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
        "SELECT id, user_id FROM wins "
        "WHERE status = 'pending'"
    ).fetchall()

    if not wins:
        await message.answer(
            "Ожидающих выдачи призов нет."
        )
        return

    text = "🎁 Ожидают выдачи:\n\n"

    for win in wins:
        text += (
            f"Заявка #{win['id']} — "
            f"пользователь {win['user_id']}\n"
        )

    text += "\nОтметить выдачу: /done ID_ЗАЯВКИ"
    await message.answer(text)


@dp.message(Command("done"))
async def done_command(message: Message):
    if message.from_user.id != ADMIN_ID or not ADMIN_ID:
        return

    args = message.text.split()

    if len(args) != 2 or not args[1].isdigit():
        await message.answer(
            "Используй: /done ID_ЗАЯВКИ"
        )
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
        await message.answer(
            "Заявка не найдена или уже выдана."
        )


async def main():
    await bot.set_my_commands([
        BotCommand(command="start", description="Запустить бота"),
        BotCommand(command="roulette", description="Крутить рулетку"),
        BotCommand(command="balance", description="Мой баланс"),
        BotCommand(command="referral", description="Пригласить друзей"),
        BotCommand(command="prizes", description="Посмотреть призы"),
        BotCommand(command="rules", description="Правила"),
        BotCommand(command="support", description="Поддержка"),
        BotCommand(command="paysupport", description="Поддержка платежей"),
        BotCommand(command="terms", description="Условия"),
        BotCommand(command="pending", description="Заявки (админ)"),
        BotCommand(command="done", description="Отметить выдачу (админ)")
    ])

    print("GiftsDrop Bot запущен!")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
