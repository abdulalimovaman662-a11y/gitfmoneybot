'use strict';

const crypto = require('crypto');
const { awardXp } = require('./progression');

const XP_REWARD = 5;
const DAILY_XP_CAP = 25;

const GAME_CONFIG = Object.freeze({
  reaction: { title: 'Reaction Arena', price: 15, dailyLimit: 5, durationMs: 30000 },
  safe: { title: 'Взлом сейфа', price: 15, dailyLimit: 3, durationMs: 0 },
  memory: { title: 'Memory Battle', price: 15, dailyLimit: 5, durationMs: 0 }
});

function randomInt(max) {
  return crypto.randomInt(max);
}

function isValidSafeGuess(guess) {
  return typeof guess === 'string' && /^\d{4}$/.test(guess);
}

function makeSafeCode() {
  return String(randomInt(10000)).padStart(4, '0');
}

function scoreGuess(secret, guess) {
  let exact = 0;
  const secretRest = [];
  const guessRest = [];
  for (let i = 0; i < 4; i++) {
    if (secret[i] === guess[i]) exact++;
    else {
      secretRest.push(secret[i]);
      guessRest.push(guess[i]);
    }
  }
  const counts = new Map();
  for (const digit of secretRest) counts.set(digit, (counts.get(digit) || 0) + 1);
  let misplaced = 0;
  for (const digit of guessRest) {
    const count = counts.get(digit) || 0;
    if (count > 0) {
      misplaced++;
      counts.set(digit, count - 1);
    }
  }
  return { exact, misplaced };
}

function makeMemoryDeck() {
  const pairs = Array.from({ length: 8 }, (_, i) => i + 1);
  const deck = [...pairs, ...pairs];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function safePublicState(session) {
  const state = session.state || {};
  if (session.game_type === 'reaction') {
    return {
      target: state.target,
      hits: Number(state.hits || 0),
      duration_ms: GAME_CONFIG.reaction.durationMs,
      started_at: session.created_at
    };
  }
  if (session.game_type === 'safe') {
    return { attempts: Number(state.attempts || 0), max_attempts: 8, last_hint: state.last_hint || null };
  }
  return {
    deck_size: 16,
    matched: state.matched || [],
    open: state.open || [],
    cards: [...new Set([...(state.matched || []), ...(state.open || [])])].map(index => ({ index, value: state.deck[index] })),
    moves: Number(state.moves || 0),
    mismatch_until: state.mismatch_until || null
  };
}

async function initMiniGamesDatabase(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS minigame_sessions (
      id TEXT PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      game_type TEXT NOT NULL CHECK (game_type IN ('reaction','safe','memory')),
      request_id TEXT NOT NULL,
      state JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','expired')),
      score INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      UNIQUE (telegram_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS minigame_sessions_user_day_idx
      ON minigame_sessions (telegram_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS minigame_action_receipts (
      session_id TEXT NOT NULL REFERENCES minigame_sessions(id) ON DELETE CASCADE,
      action_id TEXT NOT NULL,
      response JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (session_id, action_id)
    );
  `);
}

async function startMiniGame(pool, telegramId, gameType, requestId) {
  const config = GAME_CONFIG[gameType];
  if (!config) return { status: 400, error: 'Неизвестная игра' };
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{12,80}$/.test(requestId)) {
    return { status: 400, error: 'Не удалось создать безопасный ID запуска. Попробуй ещё раз.' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query(
      'SELECT telegram_id, silver FROM users WHERE telegram_id = $1 FOR UPDATE',
      [String(telegramId)]
    );
    if (!user.rowCount) {
      await client.query('ROLLBACK');
      return { status: 404, error: 'Аккаунт не найден' };
    }

    const existing = await client.query(
      'SELECT * FROM minigame_sessions WHERE telegram_id = $1 AND request_id = $2',
      [String(telegramId), requestId]
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (row.game_type !== gameType) {
        await client.query('ROLLBACK');
        return { status: 409, error: 'Этот ID запуска уже использован для другой игры.' };
      }
      const priorXp = await client.query(
        'SELECT amount FROM xp_ledger WHERE idempotency_key = $1',
        ['minigame:' + row.id]
      );
      await client.query('COMMIT');
      return { status: 200, session: {
        id: row.id, game: row.game_type, status: row.status, score: Number(row.score),
        state: safePublicState(row), created_at: row.created_at,
        message: row.state?.result_message || (row.status === 'completed' ? 'Раунд уже завершён' : ''),
        xp_awarded: Number(row.state?.xp_awarded ?? priorXp.rows[0]?.amount ?? 0)
      }, balance: Number(user.rows[0].silver), reused: true };
    }

    const daily = await client.query(`
      SELECT COUNT(*)::int AS used
      FROM minigame_sessions
      WHERE telegram_id = $1 AND game_type = $2
        AND created_at >= (NOW() AT TIME ZONE 'UTC')::date AT TIME ZONE 'UTC'
        AND created_at < ((NOW() AT TIME ZONE 'UTC')::date + INTERVAL '1 day') AT TIME ZONE 'UTC'
    `, [String(telegramId), gameType]);
    const used = Number(daily.rows[0]?.used || 0);
    if (used >= config.dailyLimit) {
      await client.query('ROLLBACK');
      return { status: 429, error: `Лимит на сегодня исчерпан: ${config.dailyLimit} запусков`, used, limit: config.dailyLimit };
    }
    const balance = Number(user.rows[0].silver);
    if (balance < config.price) {
      await client.query('ROLLBACK');
      return { status: 400, error: 'Недостаточно серебра. Для запуска нужно 15 серебра.', balance };
    }

    const id = crypto.randomUUID();
    let state;
    if (gameType === 'reaction') {
      state = { target: randomInt(9), hits: 0, last_hit_ms: -1000 };
    } else if (gameType === 'safe') {
      state = { secret: makeSafeCode(), attempts: 0, last_hint: null, last_guess_ms: 0 };
    } else {
      state = { deck: makeMemoryDeck(), matched: [], open: [], moves: 0, mismatch_until: null };
    }

    await client.query(
      'UPDATE users SET silver = silver - $1 WHERE telegram_id = $2',
      [config.price, String(telegramId)]
    );
    const inserted = await client.query(`
      INSERT INTO minigame_sessions (id, telegram_id, game_type, request_id, state, ends_at)
      VALUES ($1,$2,$3,$4,$5::jsonb,
        CASE WHEN $3 = 'reaction' THEN NOW() + INTERVAL '30 seconds' ELSE NULL END)
      RETURNING id, game_type, status, score, state, created_at
    `, [id, String(telegramId), gameType, requestId, JSON.stringify(state)]);

    await client.query('COMMIT');
    const row = inserted.rows[0];
    return { status: 201, session: {
      id: row.id, game: row.game_type, status: row.status, score: Number(row.score),
      state: safePublicState(row), created_at: row.created_at
    }, balance: balance - config.price, used: used + 1, limit: config.dailyLimit, price: config.price };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function performMiniGameAction(pool, telegramId, sessionId, body = {}) {
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return { status: 400, error: 'Некорректная игровая сессия' };
  }
  if (typeof body.action_id !== 'string' || !/^[a-zA-Z0-9_-]{12,80}$/.test(body.action_id)) {
    return { status: 400, error: 'Некорректный ID действия. Обнови игру и попробуй ещё раз.' };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize this player's game actions so daily XP-cap checks cannot race
    // across two different sessions owned by the same Telegram account.
    const owner = await client.query(
      'SELECT telegram_id FROM users WHERE telegram_id = $1 FOR UPDATE',
      [String(telegramId)]
    );
    if (!owner.rowCount) {
      await client.query('ROLLBACK');
      return { status: 404, error: 'Аккаунт не найден' };
    }
    const result = await client.query(
      'SELECT * FROM minigame_sessions WHERE id = $1 AND telegram_id = $2 FOR UPDATE',
      [sessionId, String(telegramId)]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return { status: 404, error: 'Игровая сессия не найдена' };
    }
    const session = result.rows[0];
    const receipt = await client.query(
      'SELECT response FROM minigame_action_receipts WHERE session_id = $1 AND action_id = $2',
      [sessionId, body.action_id]
    );
    if (receipt.rowCount) {
      await client.query('COMMIT');
      return receipt.rows[0].response;
    }
    const state = session.state || {};
    if (session.status !== 'active') {
      const priorXp = await client.query(
        'SELECT amount FROM xp_ledger WHERE idempotency_key = $1',
        ['minigame:' + session.id]
      );
      await client.query('COMMIT');
      return { status: 200, session: {
        id: session.id, game: session.game_type, status: session.status,
        score: Number(session.score), state: safePublicState(session),
        message: state.result_message || (session.status === 'expired' ? 'Время раунда закончилось' : 'Раунд уже завершён'),
        xp_awarded: Number(state.xp_awarded ?? priorXp.rows[0]?.amount ?? 0)
      }, finished: true };
    }

    let score = Number(session.score || 0);
    let message = '';
    if (session.game_type === 'reaction') {
      const elapsed = Date.now() - new Date(session.created_at).getTime();
      // Expire the round server-side even if the player closed the Mini App
      // and the browser timer never got a chance to send the finish action.
      if (elapsed >= GAME_CONFIG.reaction.durationMs && body.action === 'finish') {
        session.status = 'completed';
      } else if (elapsed >= GAME_CONFIG.reaction.durationMs) {
        session.status = 'expired';
        message = 'Время раунда закончилось';
      } else if (body.action === 'hit') {
        const target = Number(body.target);
        if (!Number.isInteger(target) || target !== Number(state.target)) {
          await client.query('ROLLBACK');
          return { status: 409, error: 'Мишень уже сменилась. Попробуй следующую.' };
        }
        const nowMs = Date.now();
        if (nowMs - Number(state.last_hit_ms || 0) < 150) {
          await client.query('ROLLBACK');
          return { status: 429, error: 'Слишком быстро. Играй честно.' };
        }
        state.hits = Math.min(120, Number(state.hits || 0) + 1);
        state.last_hit_ms = nowMs;
        state.target = randomInt(9);
        score = state.hits;
      } else if (body.action === 'finish') {
        await client.query('ROLLBACK');
        return { status: 409, error: 'Раунд ещё идёт.' };
      } else {
        await client.query('ROLLBACK');
        return { status: 400, error: 'Неизвестное действие' };
      }
    } else if (session.game_type === 'safe') {
      if (body.action !== 'guess') {
        await client.query('ROLLBACK');
        return { status: 400, error: 'Отправь комбинацию из четырёх цифр' };
      }
      const guess = String(body.guess || '');
      if (!isValidSafeGuess(guess)) {
        await client.query('ROLLBACK');
        return { status: 400, error: 'Нужно ввести ровно четыре цифры' };
      }
      if (Number(state.attempts || 0) >= 8) {
        session.status = 'completed';
        message = 'Попытки закончились';
      } else {
        const nowMs = Date.now();
        if (nowMs - Number(state.last_guess_ms || 0) < 650) {
          await client.query('ROLLBACK');
          return { status: 429, error: 'Не торопись: следующая попытка будет доступна через мгновение.' };
        }
        state.last_guess_ms = nowMs;
        const hint = scoreGuess(String(state.secret), guess);
        state.attempts = Number(state.attempts || 0) + 1;
        state.last_hint = hint;
        if (hint.exact === 4) {
          session.status = 'completed';
          score = 1;
          message = `Сейф открыт за ${state.attempts} из 8 попыток!`;
        } else if (state.attempts >= 8) {
          session.status = 'completed';
          message = 'Попытки закончились';
        } else {
          message = 'Подсказка получена';
        }
      }
    } else if (session.game_type === 'memory') {
      if (body.action !== 'flip') {
        await client.query('ROLLBACK');
        return { status: 400, error: 'Неизвестное действие' };
      }
      const index = Number(body.index);
      if (!Number.isInteger(index) || index < 0 || index >= 16) {
        await client.query('ROLLBACK');
        return { status: 400, error: 'Некорректная карточка' };
      }
      const now = Date.now();
      if (state.mismatch_until && now < Number(state.mismatch_until)) {
        await client.query('ROLLBACK');
        return { status: 409, error: 'Посмотри на карточки и подожди мгновение.' };
      }
      if (state.mismatch_until && now >= Number(state.mismatch_until)) {
        state.open = [];
        state.mismatch_until = null;
      }
      if ((state.matched || []).includes(index) || (state.open || []).includes(index)) {
        await client.query('ROLLBACK');
        return { status: 409, error: 'Эта карточка уже открыта' };
      }
      state.open = [...(state.open || []), index];
      if (state.open.length === 2) {
        state.moves = Number(state.moves || 0) + 1;
        const [a, b] = state.open;
        if (state.deck[a] === state.deck[b]) {
          state.matched = [...(state.matched || []), a, b];
          state.open = [];
        } else {
          state.mismatch_until = now + 700;
        }
      }
      score = Number(state.matched?.length || 0) / 2;
      if (score >= 8) {
        session.status = 'completed';
        message = 'Все пары найдены!';
      }
    }

    let xpAwarded = 0;
    const successfulCompletion = session.status === 'completed' && (
      (session.game_type === 'reaction' && Number(state.hits || 0) > 0) ||
      (session.game_type === 'safe' && Number(state.last_hint?.exact || 0) === 4) ||
      (session.game_type === 'memory' && score >= 8)
    );
    if (successfulCompletion) {
      const earnedToday = await client.query(`
        SELECT COALESCE(SUM(amount), 0)::int AS earned
        FROM xp_ledger
        WHERE telegram_id = $1 AND source_type = 'minigame'
          AND created_at >= (NOW() AT TIME ZONE 'UTC')::date AT TIME ZONE 'UTC'
          AND created_at < ((NOW() AT TIME ZONE 'UTC')::date + INTERVAL '1 day') AT TIME ZONE 'UTC'
      `, [String(telegramId)]);
      xpAwarded = Math.max(0, Math.min(XP_REWARD, DAILY_XP_CAP - Number(earnedToday.rows[0]?.earned || 0)));
      if (xpAwarded > 0) {
        const awarded = await awardXp(client, String(telegramId), xpAwarded, 'minigame', 'minigame:' + session.id, { game_type: session.game_type });
        if (!awarded) xpAwarded = 0;
      }
    }

    if (session.status !== 'active') {
      state.result_message = message;
      state.xp_awarded = xpAwarded;
    }
    await client.query(`
      UPDATE minigame_sessions
      SET state = $1::jsonb, status = $2, score = $3,
          finished_at = CASE WHEN $2 <> 'active' THEN NOW() ELSE finished_at END
      WHERE id = $4
    `, [JSON.stringify(state), session.status, score, sessionId]);
    const updated = {
      id: session.id, game: session.game_type, status: session.status,
      score, xp_awarded: xpAwarded, state: safePublicState({ ...session, state }), message
    };
    const response = { status: 200, session: updated, finished: session.status !== 'active' };
    await client.query(
      'INSERT INTO minigame_action_receipts (session_id, action_id, response) VALUES ($1,$2,$3::jsonb)',
      [sessionId, body.action_id, JSON.stringify(response)]
    );
    await client.query('COMMIT');
    return response;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  GAME_CONFIG,
  initMiniGamesDatabase,
  startMiniGame,
  performMiniGameAction,
  scoreGuess,
  isValidSafeGuess,
  makeMemoryDeck
};
