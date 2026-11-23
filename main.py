
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

# SQLite is kept only to preserve legacy spin balances during the first shared-DB login.
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


def legacy_account(user_id):
    row = db.execute(
        "SELECT spins, referrals FROM users WHERE user_id = ?", (user_id,)
    ).fetchone()
    if not row:
        return None
    return {
        "spins": max(0, int(row["spins"])),
        "referrals": max(0, int(row["referrals"]))
    }


async def internal_api(path, method="GET", payload=None):
    if not STORE_API_URL:
        raise RuntimeError("Не задан STORE_API_URL — адрес сайта GiftsDrop")
    timeout = aiohttp.ClientTimeout(total=12)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.request(
            method,
            STORE_API_URL + path,
            json=payload,
            headers={"x-bot-token": TOKEN}
        ) as response:
            result = await response.json(content_type=None)
            if response.status >= 400:
                raise RuntimeError(result.get("error", "Ошибка общего сервера"))
            return result


async def shared_user(tg_user, referral_id=None):
    legacy = legacy_account(tg_user.id)
    return await internal_api("/api/internal/bot/user", "POST", {
        "telegram_id": str(tg_user.id),
        "username": tg_user.username,
        "first_name": tg_user.first_name,
        "referral_id": str(referral_id) if referral_id else None,
        "legacy_spins": legacy["spins"] if legacy else None,
        "legacy_referrals": legacy["referrals"] if legacy else None
    })


def main_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎰 Крутить рулетку", callback_data="spin")],
        [
            InlineKeyboardButton(text="🪙 20 серебра — 20 Stars", callback_data="buy_20_silver"),
            InlineKeyboardButton(text="🪙 60 серебра — 60 Stars", callback_data="buy_60_silver")
        ],
        [
            InlineKeyboardButton(text="👤 Мой баланс", callback_data="balance"),
            InlineKeyboardButton(text="🎁 Призы", callback_data="prizes")
        ],
        [InlineKeyboardButton(text="🔗 Пригласить друзей", callback_data="referral")],
        [InlineKeyboardButton(text="📜 Правила", callback_data="rules")]
    ])


async def show_balance(message_or_callback, user_id):
    data = await internal_api(
        "/api/internal/bot/user", "POST", {"telegram_id": str(user_id)}
    )
    text = (
        f"🪙 Серебро: {data['silver']}\n"
        f"🎰 Бесплатные прокрутки: {data['free_spins']}\n"
        f"👥 Приглашено друзей: {data['referral_count']}\n"
        f"🎁 До следующих 3 бесплатных прокруток: {data['remaining_referrals']}"
    )
    if isinstance(message_or_callback, CallbackQuery):
        await message_or_callback.message.answer(text, reply_markup=main_keyboard())
        await message_or_callback.answer()
    else:
        await message_or_callback.answer(text, reply_markup=main_keyboard())


async def send_silver_invoice(user_id, amount):
    if amount not in (20, 60):
        raise ValueError("Недопустимая сумма пополнения")
    title = f"{amount} серебра"
    await bot.send_invoice(
        chat_id=user_id,
        title=title,
        description=f"Пополнение баланса GiftsDrop на {amount} серебра",
        payload=f"silverpack:{amount}:{user_id}",
        provider_token="",
        currency="XTR",
        prices=[LabeledPrice(label=title, amount=amount)]
    )


@dp.callback_query(F.data == "buy_20_silver")
async def buy_20_silver(callback: CallbackQuery):
    try:
        await shared_user(callback.from_user)
        await send_silver_invoice(callback.from_user.id, 20)
        await callback.answer()
    except Exception as error:
        await callback.message.answer(f"Не удалось создать счёт: {error}")
        await callback.answer()


@dp.callback_query(F.data == "buy_60_silver")
async def buy_60_silver(callback: CallbackQuery):
    try:
        await shared_user(callback.from_user)
        await send_silver_invoice(callback.from_user.id, 60)
        await callback.answer()
    except Exception as error:
        await callback.message.answer(f"Не удалось создать счёт: {error}")
        await callback.answer()


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

    try:
        result = await shared_user(message.from_user, referral_id)
    except Exception as error:
        await message.answer(f"Сервис временно недоступен: {error}")
        return

    if result.get("created"):
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
    try:
        await shared_user(message.from_user)
        await show_balance(message, message.from_user.id)
    except Exception as error:
        await message.answer(f"Не удалось загрузить баланс: {error}")


@dp.message(Command("referral"))
async def referral_command(message: Message):
    try:
        await shared_user(message.from_user)
    except Exception as error:
        await message.answer(f"Сервис временно недоступен: {error}")
        return
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
        "🎁 Призы GiftsDrop:\n"
        "Обычный NFT — 9,99%.\n"
        "Редкий NFT — 0,01%.\n"
        "Без выигрыша — 90%.\n\n"
        "Выдача производится администратором вручную."
    )


@dp.message(Command("rules"))
async def rules_command(message: Message):
    await message.answer(
        "📜 Правила GiftsDrop:\n\n"
        "1. При первом запуске даются 3 бесплатные прокрутки.\n"
        "2. За каждые 10 новых приглашённых друзей "
        "начисляются ещё 3 прокрутки.\n"
        "3. 1 Telegram Star = 1 серебро при пополнении.\n"
        "4. Одна прокрутка стоит 20 серебра.\n"
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
        "Серебро начисляется из Telegram Stars по курсу 1 к 1.\n"
        "Одна прокрутка стоит 20 серебра.\n"
        "Подарки отправляются администратором вручную "
        "после подтверждения оплаты.\n"
        "По вопросам платежей используй /paysupport."
    )


@dp.pre_checkout_query()
async def pre_checkout(query: PreCheckoutQuery):
    payload = query.invoice_payload
    valid = False

    if payload.startswith("silverpack:"):
        try:
            parts = payload.split(":")
            amount = int(parts[1])
            user_id = int(parts[2])
            valid = (
                amount in (20, 60)
                and user_id == query.from_user.id
                and query.currency == "XTR"
                and query.total_amount == amount
            )
        except (ValueError, IndexError):
            valid = False

    elif payload.startswith("spinpack:"):
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

    # New silver top-ups: one Telegram Star credits one silver.
    if payload.startswith("silverpack:"):
        try:
            parts = payload.split(":")
            amount = int(parts[1])
            user_id = int(parts[2])
        except (ValueError, IndexError):
            await message.answer("Платёж получен, но данные пополнения некорректны.")
            return
        if (amount not in (20, 60) or user_id != message.from_user.id
                or payment.currency != "XTR" or payment.total_amount != amount):
            await message.answer("Данные пополнения не совпали. Обратись в поддержку.")
            return
        try:
            result = await internal_api("/api/internal/bot/silver-payment", "POST", {
                "telegram_id": str(user_id),
                "amount": amount,
                "stars": payment.total_amount,
                "charge_id": payment.telegram_payment_charge_id
            })
            await message.answer(
                "✅ Серебро успешно начислено!\n"
                f"Начислено: {result['credited_silver']} 🪙\n"
                f"Баланс: {result['silver']} 🪙",
                reply_markup=main_keyboard()
            )
        except Exception as error:
            await message.answer(
                "Telegram подтвердил оплату, но начисление задерживается. "
                "Не оплачивай повторно; поддержка проверит платёж."
            )
            if ADMIN_ID:
                await bot.send_message(ADMIN_ID, f"⚠️ Ошибка начисления серебра: {error}")
        return

    # Compatibility for invoices created before the shared silver balance rollout.
    try:
        parts = payload.split(":")
        count = int(parts[1])
        user_id = int(parts[2])
    except (ValueError, IndexError):
        await message.answer("Платёж получен, но данные заказа некорректны. Обратись в поддержку.")
        return

    expected_price = 5 if count == 1 else 15
    if (parts[0] != "spinpack" or count not in (1, 3)
            or user_id != message.from_user.id
            or payment.currency != "XTR"
            or payment.total_amount != expected_price):
        await message.answer("Данные старого платежа не совпали. Обратись в поддержку.")
        return

    try:
        result = await internal_api("/api/internal/bot/legacy-payment", "POST", {
            "telegram_id": str(user_id),
            "count": count,
            "stars": payment.total_amount,
            "charge_id": payment.telegram_payment_charge_id
        })
        await message.answer(
            "✅ Старый платёж подтверждён.\n"
            f"Добавлено прокруток: {result['credited_spins']}.\n"
            "Текущий баланс обновлён в GiftsDrop.",
            reply_markup=main_keyboard()
        )
    except Exception as error:
        await message.answer(
            "Telegram подтвердил платёж, но синхронизация задерживается. "
            "Не оплачивай повторно; поддержка проверит операцию."
        )
        if ADMIN_ID:
            await bot.send_message(ADMIN_ID, f"⚠️ Ошибка синхронизации старого платежа: {error}")


@dp.callback_query(F.data == "balance")
async def balance_button(callback: CallbackQuery):
    try:
        await shared_user(callback.from_user)
        await show_balance(callback, callback.from_user.id)
    except Exception as error:
        await callback.message.answer(f"Не удалось загрузить баланс: {error}")
        await callback.answer()


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
    try:
        await shared_user(callback.from_user)
    except Exception as error:
        await callback.message.answer(f"Сервис временно недоступен: {error}")
        await callback.answer()
        return
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
    user = callback.from_user
    try:
        await shared_user(user)
        result = await internal_api("/api/internal/bot/spin", "POST", {
            "telegram_id": str(user.id),
            "username": user.username,
            "first_name": user.first_name
        })
    except Exception as error:
        await callback.message.answer(f"Не удалось выполнить прокрутку: {error}")
        await callback.answer()
        return

    prize = result.get("prize")
    if prize == "rare":
        await callback.message.answer(
            "🎉🎉🎉 ДЖЕКПОТ!\n\nТы выиграл редкий NFT-подарок! "
            "Администратор свяжется с тобой после проверки."
        )
        if ADMIN_ID:
            await bot.send_message(
                ADMIN_ID,
                "🏆 НОВЫЙ РЕДКИЙ ПОБЕДИТЕЛЬ!\n"
                f"ID: {user.id}\nUsername: @{user.username or 'нет'}\n"
                f"Заявка: #{result.get('claim_id')}"
            )
    elif prize == "ordinary":
        await callback.message.answer(
            "🎉 Поздравляем! Ты выиграл обычный NFT-подарок! "
            "Администратор свяжется с тобой для выдачи."
        )
        if ADMIN_ID:
            await bot.send_message(
                ADMIN_ID,
                "🎁 НОВЫЙ ПОБЕДИТЕЛЬ!\n"
                f"ID: {user.id}\nUsername: @{user.username or 'нет'}\n"
                f"Заявка: #{result.get('claim_id')}"
            )
    else:
        await callback.message.answer("😔 В этот раз без выигрыша. Попробуй ещё раз!")

    await callback.message.answer(
        f"🪙 Серебро: {result['silver']}\n"
        f"🎰 Бесплатные прокрутки: {result['free_spins']}",
        reply_markup=main_keyboard()
    )
    await callback.answer()


@dp.message(Command("pending"))
async def pending_command(message: Message):
    if message.from_user.id != ADMIN_ID or not ADMIN_ID:
        return
    try:
        result = await internal_api("/api/internal/bot/prizes", "GET")
    except Exception as error:
        await message.answer(f"Не удалось загрузить заявки: {error}")
        return
    claims = result.get("claims", [])
    if not claims:
        await message.answer("Ожидающих выдачи призов нет.")
        return
    text = "🎁 Ожидают выдачи:\n\n"
    for claim in claims:
        text += f"Заявка #{claim['id']} — {claim['prize_type']} — пользователь {claim['telegram_id']}\n"
    text += "\nОтметить выдачу: /done ID_ЗАЯВКИ"
    await message.answer(text)


@dp.message(Command("done"))
async def done_command(message: Message):
    if message.from_user.id != ADMIN_ID or not ADMIN_ID:
        return
    args = message.text.split()
    if len(args) != 2 or not args[1].isdigit():
        await message.answer("Используй: /done ID_ЗАЯВКИ")
        return
    try:
        await internal_api(f"/api/internal/bot/prizes/{args[1]}/done", "POST", {
            "admin_id": str(message.from_user.id)
        })
        await message.answer(f"✅ Заявка #{args[1]} отмечена как выданная.")
    except Exception as error:
        await message.answer(f"Не удалось обновить заявку: {error}")


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
