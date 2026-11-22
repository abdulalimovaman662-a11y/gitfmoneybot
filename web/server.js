
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = process.env.ADMIN_ID;

if (!BOT_TOKEN || !DATABASE_URL) {
  throw new Error('Не заданы BOT_TOKEN или DATABASE_URL');
}

const pool = new Pool({
  connectionString: DATABASE_URL
});

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

    if (!user || !user.id) return null;

    return user;
  } catch {
    return null;
  }
}

function getTelegramUser(req) {
  return verifyTelegram(req.headers['x-telegram-init-data']);
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/api/me' && req.method === 'GET') {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Не удалось проверить Telegram'
        });
      }

      await pool.query(`
        INSERT INTO users (telegram_id, username, first_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (telegram_id)
        DO UPDATE SET
          username = EXCLUDED.username,
          first_name = EXCLUDED.first_name
      `, [
        String(user.id),
        user.username || null,
        user.first_name || null
      ]);

      const result = await pool.query(
        'SELECT silver, free_spins FROM users WHERE telegram_id = $1',
        [String(user.id)]
      );

      return send(res, 200, result.rows[0]);
    }

    if (url.pathname === '/api/spin' && req.method === 'POST') {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Не удалось проверить Telegram'
        });
      }

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

        if (
          account.free_spins <= 0 &&
          account.silver < 20
        ) {
          await client.query('ROLLBACK');
          return send(res, 400, {
            error: 'Недостаточно серебра'
          });
        }

        if (account.free_spins > 0) {
          await client.query(
            'UPDATE users SET free_spins = free_spins - 1 WHERE telegram_id = $1',
            [String(user.id)]
          );
        } else {
          await client.query(
            'UPDATE users SET silver = silver - 20 WHERE telegram_id = $1',
            [String(user.id)]
          );
        }

        const chance = crypto.randomInt(100000);

        let prize = 'nothing';

        if (chance >= 99990) {
          prize = 'rare';
        } else if (chance >= 90000) {
          prize = 'ordinary';
        }

        await client.query(
          'INSERT INTO spin_history (telegram_id, prize_type) VALUES ($1, $2)',
          [String(user.id), prize]
        );

        const updated = await client.query(
          'SELECT silver, free_spins FROM users WHERE telegram_id = $1',
          [String(user.id)]
        );

        await client.query('COMMIT');

        return send(res, 200, {
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

    if (url.pathname === '/' && req.method === 'GET') {
      const filePath = path.join(__dirname, 'index.html');

      return fs.readFile(filePath, (err, content) => {
        if (err) {
          res.writeHead(500);
          return res.end('Ошибка загрузки сайта');
        }

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8'
        });

        res.end(content);
      });
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
