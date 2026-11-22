
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = process.env.ADMIN_ID;
const BOT_USERNAME = 'Gitfmoneybot';

if (!BOT_TOKEN || !DATABASE_URL || !ADMIN_ID) {
  throw new Error('Проверь BOT_TOKEN, DATABASE_URL и ADMIN_ID');
}

const pool = new Pool({ connectionString: DATABASE_URL });

const PRODUCTS = [
  { id: 'gift_300', name: 'Telegram Gift 300', stars: 300, discount: 5, emoji: '🎁' },
  { id: 'gift_500', name: 'Telegram Gift 500', stars: 500, discount: 5, emoji: '🎁' },
  { id: 'gift_750', name: 'Telegram Gift 750', stars: 750, discount: 5, emoji: '💎' },
  { id: 'gift_1000', name: 'Telegram Gift 1000', stars: 1000, discount: 10, emoji: '💎' },
  { id: 'gift_1500', name: 'Telegram Gift 1500', stars: 1500, discount: 10, emoji: '👑' },
  { id: 'gift_2000', name: 'Telegram Gift 2000', stars: 2000, discount: 10, emoji: '👑' },
  { id: 'gift_3000', name: 'Telegram Gift 3000', stars: 3000, discount: 10, emoji: '✨' },
  { id: 'gift_5000', name: 'Telegram Gift 5000', stars: 5000, discount: 10, emoji: '✨' }
];

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      silver INTEGER NOT NULL DEFAULT 0,
      free_spins INTEGER NOT NULL DEFAULT 3,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS referred_by BIGINT,
      ADD COLUMN IF NOT EXISTS referral_count INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS spin_history (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      prize_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS topup_requests (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      stars INTEGER NOT NULL CHECK (stars > 0),
      recipient TEXT NOT NULL
        CHECK (recipient IN ('@traptrap4', '@RichGues')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS gift_orders (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      stars INTEGER NOT NULL CHECK (stars BETWEEN 300 AND 5000),
      discount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending_payment'
        CHECK (status IN (
          'pending_payment',
          'paid',
          'completed',
          'cancelled'
        )),
      telegram_charge_id TEXT UNIQUE,
      provider_charge_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS gift_orders_user_idx
      ON gift_orders(telegram_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS gift_orders_status_idx
      ON gift_orders(status, created_at DESC);
  `);
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(data));
}

function verifyTelegram(initData) {
  if (!initData) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    const authDate = Number(params.get('auth_date'));

    if (!hash || !authDate) return null;
    if (Date.now() / 1000 - authDate > 86400) return null;
    if (authDate > Date.now() / 1000 + 60) return null;

    const entries = [...params.entries()]
      .filter(([key]) => key !== 'hash')
      .sort(([a], [b]) => a.localeCompare(b));

    const dataCheckString = entries
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(calculatedHash, 'hex');

    if (
      a.length !== b.length ||
      !crypto.timingSafeEqual(a, b)
    ) return null;

    const user = JSON.parse(params.get('user') || 'null');
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

function getTelegramUser(req) {
  return verifyTelegram(req.headers['x-telegram-init-data']);
}

function getReferralId(req) {
  try {
    const params = new URLSearchParams(
      req.headers['x-telegram-init-data'] || ''
    );

    const startParam = params.get('start_param') || '';
    const match = startParam.match(/^ref_(\d+)$/);

    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;

      if (body.length > 10000) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Некорректный JSON'));
      }
    });

    req.on('error', reject);
  });
}

async function ensureUser(user, req) {
  const telegramId = String(user.id);
  const referralId = getReferralId(req);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const inserted = await client.query(`
      INSERT INTO users (telegram_id, username, first_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (telegram_id) DO NOTHING
      RETURNING telegram_id
    `, [
      telegramId,
      user.username || null,
      user.first_name || null
    ]);

    await client.query(`
      UPDATE users
      SET username = $1, first_name = $2
      WHERE telegram_id = $3
    `, [
      user.username || null,
      user.first_name || null,
      telegramId
    ]);

    if (
      inserted.rowCount === 1 &&
      referralId &&
      referralId !== telegramId
    ) {
      const referrer = await client.query(`
        UPDATE users
        SET referral_count = referral_count + 1
        WHERE telegram_id = $1
        RETURNING referral_count
      `, [referralId]);

      if (referrer.rowCount === 1) {
        await client.query(`
          UPDATE users
          SET referred_by = $1
          WHERE telegram_id = $2
        `, [referralId, telegramId]);

        const count = Number(referrer.rows[0].referral_count);

        if (count % 10 === 0) {
          await client.query(`
            UPDATE users
            SET free_spins = free_spins + 3
            WHERE telegram_id = $1
          `, [referralId]);
        }
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function requireAdmin(req) {
  const user = getTelegramUser(req);

  return user && String(user.id) === String(ADMIN_ID)
    ? user
    : null;
}

async function createTelegramInvoice(order) {
  const payload = [
    'gift',
    order.id,
    order.telegram_id,
    order.stars
  ].join(':');

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: order.product_name,
        description: `Покупка подарка GIFTSDROP MARKET. Заказ №${order.id}`,
        payload,
        currency: 'XTR',
        prices: [
          {
            label: order.product_name,
            amount: order.stars
          }
        ]
      })
    }
  );

  const data = await response.json();

  if (!response.ok || !data.ok || !data.result) {
    throw new Error(
      data.description || 'Telegram не создал счёт'
    );
  }

  return data.result;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Внутреннее подтверждение оплаты от Python-бота
    if (
      url.pathname === '/api/internal/store/paid' &&
      req.method === 'POST'
    ) {
      if (req.headers['x-bot-token'] !== BOT_TOKEN) {
        return send(res, 403, {
          error: 'Доступ запрещён'
        });
      }

      const body = await readBody(req);
      const orderId = String(body.order_id || '');
      const telegramId = String(body.telegram_id || '');
      const stars = Number(body.stars);
      const chargeId = String(body.charge_id || '');

      if (
        !/^\d+$/.test(orderId) ||
        !/^\d+$/.test(telegramId) ||
        !Number.isSafeInteger(stars) ||
        stars < 300 ||
        stars > 5000 ||
        body.currency !== 'XTR' ||
        !chargeId
      ) {
        return send(res, 400, {
          error: 'Некорректные данные платежа'
        });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          'SELECT * FROM gift_orders WHERE id = $1 FOR UPDATE',
          [orderId]
        );

        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return send(res, 404, {
            error: 'Заказ не найден'
          });
        }

        const order = result.rows[0];

        if (
          String(order.telegram_id) !== telegramId ||
          Number(order.stars) !== stars
        ) {
          await client.query('ROLLBACK');
          return send(res, 400, {
            error: 'Данные платежа не совпадают с заказом'
          });
        }

        if (order.status === 'paid' || order.status === 'completed') {
          if (order.telegram_charge_id === chargeId) {
            await client.query('COMMIT');
            return send(res, 200, { success: true, already_paid: true });
          }

          await client.query('ROLLBACK');
          return send(res, 409, {
            error: 'Заказ уже оплачен другим платежом'
          });
        }

        if (order.status !== 'pending_payment') {
          await client.query('ROLLBACK');
          return send(res, 409, {
            error: 'Заказ нельзя оплатить'
          });
        }

        await client.query(`
          UPDATE gift_orders
          SET status = 'paid',
              telegram_charge_id = $1,
              provider_charge_id = $2,
              paid_at = NOW()
          WHERE id = $3
        `, [
          chargeId,
          body.provider_charge_id || null,
          orderId
        ]);

        await client.query('COMMIT');

        return send(res, 200, { success: true });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    // Каталог магазина
    if (
      url.pathname === '/api/store/catalog' &&
      req.method === 'GET'
    ) {
      return send(res, 200, {
        products: PRODUCTS.map(product => ({
          ...product,
          old_stars: product.stars + product.discount
        }))
      });
    }

    // Создание заказа и Telegram-счёта
    if (
      url.pathname === '/api/store/invoice' &&
      req.method === 'POST'
    ) {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Ошибка авторизации Telegram'
        });
      }

      await ensureUser(user, req);

      const body = await readBody(req);
      const product = PRODUCTS.find(
        item => item.id === String(body.product_id || '')
      );

      if (!product) {
        return send(res, 404, {
          error: 'Товар не найден'
        });
      }

      const created = await pool.query(`
        INSERT INTO gift_orders (
          telegram_id,
          product_id,
          product_name,
          stars,
          discount
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, telegram_id, product_name, stars
      `, [
        String(user.id),
        product.id,
        product.name,
        product.stars,
        product.discount
      ]);

      const order = created.rows[0];

      try {
        const invoiceLink = await createTelegramInvoice(order);

        return send(res, 201, {
          order_id: order.id,
          invoice_link: invoiceLink,
          stars: order.stars
        });
      } catch (error) {
        await pool.query(`
          UPDATE gift_orders
          SET status = 'cancelled'
          WHERE id = $1 AND status = 'pending_payment'
        `, [order.id]);

        throw error;
      }
    }

    // История заказов покупателя
    if (
      url.pathname === '/api/store/orders' &&
      req.method === 'GET'
    ) {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Ошибка авторизации Telegram'
        });
      }

      const result = await pool.query(`
        SELECT
          id,
          product_name,
          stars,
          status,
          created_at,
          paid_at,
          completed_at
        FROM gift_orders
        WHERE telegram_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `, [String(user.id)]);

      return send(res, 200, {
        orders: result.rows
      });
    }

    // Админ-панель: заказы магазина
    if (
      url.pathname === '/api/admin/store/orders' &&
      req.method === 'GET'
    ) {
      const admin = await requireAdmin(req);

      if (!admin) {
        return send(res, 403, {
          error: 'Доступ запрещён'
        });
      }

      const result = await pool.query(`
        SELECT
          o.id,
          o.telegram_id,
          u.username,
          u.first_name,
          o.product_name,
          o.stars,
          o.discount,
          o.status,
          o.created_at,
          o.paid_at
        FROM gift_orders o
        JOIN users u ON u.telegram_id = o.telegram_id
        WHERE o.status IN ('paid', 'completed')
        ORDER BY
          CASE WHEN o.status = 'paid' THEN 0 ELSE 1 END,
          o.created_at DESC
        LIMIT 100
      `);

      return send(res, 200, {
        orders: result.rows
      });
    }

    // Отметить подарок как отправленный
    const giftDone = url.pathname.match(
      /^\/api\/admin\/store\/orders\/(\d+)\/done$/
    );

    if (giftDone && req.method === 'POST') {
      const admin = await requireAdmin(req);

      if (!admin) {
        return send(res, 403, {
          error: 'Доступ запрещён'
        });
      }

      const result = await pool.query(`
        UPDATE gift_orders
        SET status = 'completed',
            completed_at = NOW()
        WHERE id = $1
          AND status = 'paid'
        RETURNING id
      `, [giftDone[1]]);

      if (!result.rowCount) {
        return send(res, 409, {
          error: 'Заказ не найден или уже выполнен'
        });
      }

      return send(res, 200, {
        success: true,
        message: 'Заказ отмечен как выполненный'
      });
    }

    // Аккаунт
    if (url.pathname === '/api/me' && req.method === 'GET') {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Ошибка авторизации Telegram'
        });
      }

      await ensureUser(user, req);

      const result = await pool.query(`
        SELECT silver, free_spins, referral_count
        FROM users
        WHERE telegram_id = $1
      `, [String(user.id)]);

      return send(res, 200, result.rows[0]);
    }

    // Рефералы
    if (url.pathname === '/api/referrals' && req.method === 'GET') {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Ошибка авторизации Telegram'
        });
      }

      await ensureUser(user, req);

      const result = await pool.query(`
        SELECT referral_count
        FROM users
        WHERE telegram_id = $1
      `, [String(user.id)]);

      const count = Number(result.rows[0].referral_count);

      return send(res, 200, {
        referral_count: count,
        progress: count % 10,
        total_rewards: Math.floor(count / 10) * 3,
        remaining: 10 - (count % 10),
        referral_link:
          `https://t.me/${BOT_USERNAME}?startapp=ref_${user.id}`
      });
    }

    // Рулетка
    if (url.pathname === '/api/spin' && req.method === 'POST') {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Ошибка авторизации Telegram'
        });
      }

      await ensureUser(user, req);

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          'SELECT * FROM users WHERE telegram_id = $1 FOR UPDATE',
          [String(user.id)]
        );

        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return send(res, 404, {
            error: 'Пользователь не найден'
          });
        }

        const account = result.rows[0];

        if (account.free_spins <= 0 && account.silver < 20) {
          await client.query('ROLLBACK');
          return send(res, 400, {
            error: 'Недостаточно серебра'
          });
        }

        if (account.free_spins > 0) {
          await client.query(`
            UPDATE users
            SET free_spins = free_spins - 1
            WHERE telegram_id = $1
          `, [String(user.id)]);
        } else {
          await client.query(`
            UPDATE users
            SET silver = silver - 20
            WHERE telegram_id = $1
          `, [String(user.id)]);
        }

        const chance = crypto.randomInt(100000);
        let prize = 'nothing';

        if (chance >= 99990) {
          prize = 'rare';
        } else if (chance >= 90000) {
          prize = 'ordinary';
        }

        await client.query(`
          INSERT INTO spin_history (telegram_id, prize_type)
          VALUES ($1, $2)
        `, [String(user.id), prize]);

        const updated = await client.query(`
          SELECT silver, free_spins
          FROM users
          WHERE telegram_id = $1
        `, [String(user.id)]);

        await client.query('COMMIT');

        return send(res, 200, {
          result: prize === 'nothing' ? 'none' : prize,
          prize,
          silver: updated.rows[0].silver,
          free_spins: updated.rows[0].free_spins
        });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    // Пополнение серебра
    if (url.pathname === '/api/topup' && req.method === 'POST') {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Ошибка авторизации Telegram'
        });
      }

      const body = await readBody(req);
      const stars = Number(body.stars);
      const recipient = body.recipient;

      if (
        !Number.isSafeInteger(stars) ||
        stars < 1 ||
        stars > 100000
      ) {
        return send(res, 400, {
          error: 'Укажи корректное количество звёзд'
        });
      }

      if (!['@traptrap4', '@RichGues'].includes(recipient)) {
        return send(res, 400, {
          error: 'Некорректный получатель'
        });
      }

      await ensureUser(user, req);

      const result = await pool.query(`
        INSERT INTO topup_requests (telegram_id, stars, recipient)
        VALUES ($1, $2, $3)
        RETURNING id, stars, recipient, status
      `, [String(user.id), stars, recipient]);

      return send(res, 201, {
        message: 'Заявка создана',
        id: result.rows[0].id,
        request: result.rows[0]
      });
    }

    // Заявки на пополнение для администратора
    if (url.pathname === '/api/admin/topups' && req.method === 'GET') {
      const admin = await requireAdmin(req);

      if (!admin) {
        return send(res, 403, {
          error: 'Доступ запрещён'
        });
      }

      const result = await pool.query(`
        SELECT
          r.id,
          r.telegram_id,
          u.username,
          u.first_name,
          r.stars,
          r.recipient,
          r.status,
          r.created_at
        FROM topup_requests r
        JOIN users u ON u.telegram_id = r.telegram_id
        WHERE r.status = 'pending'
        ORDER BY r.created_at ASC
        LIMIT 100
      `);

      return send(res, 200, {
        requests: result.rows
      });
    }

    // Подтверждение / отклонение пополнения
    const decision = url.pathname.match(
      /^\/api\/admin\/topups\/(\d+)\/(approve|reject)$/
    );

    if (decision && req.method === 'POST') {
      const admin = await requireAdmin(req);

      if (!admin) {
        return send(res, 403, {
          error: 'Доступ запрещён'
        });
      }

      const requestId = decision[1];
      const action = decision[2];
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          'SELECT * FROM topup_requests WHERE id = $1 FOR UPDATE',
          [requestId]
        );

        if (
          !result.rowCount ||
          result.rows[0].status !== 'pending'
        ) {
          await client.query('ROLLBACK');
          return send(res, 409, {
            error: 'Заявка уже обработана или не найдена'
          });
        }

        const request = result.rows[0];

        if (action === 'approve') {
          await client.query(`
            UPDATE users
            SET silver = silver + $1
            WHERE telegram_id = $2
          `, [request.stars, request.telegram_id]);
        }

        await client.query(`
          UPDATE topup_requests
          SET status = $1, processed_at = NOW()
          WHERE id = $2
        `, [
          action === 'approve' ? 'approved' : 'rejected',
          requestId
        ]);

        await client.query('COMMIT');

        return send(res, 200, {
          success: true,
          message: action === 'approve'
            ? 'Серебро начислено'
            : 'Заявка отклонена'
        });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    // Главная страница
    if (url.pathname === '/' && req.method === 'GET') {
      return fs.readFile(
        path.join(__dirname, 'index.html'),
        (err, content) => {
          if (err) {
            res.writeHead(500);
            return res.end('Ошибка загрузки сайта');
          }

          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8'
          });

          res.end(content);
        }
      );
    }

    return send(res, 404, {
      error: 'Страница не найдена'
    });

  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      send(res, 500, {
        error: 'Внутренняя ошибка сервера'
      });
    }
  }
});

initDatabase()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`GiftsDrop server started on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error('Ошибка запуска базы данных:', error);
    process.exit(1);
  });
