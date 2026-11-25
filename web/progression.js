'use strict';

function utcDateSql() {
  return "(NOW() AT TIME ZONE 'UTC')::date";
}

async function initProgressionDatabase(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS xp_ledger (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      amount INTEGER NOT NULL CHECK (amount > 0),
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS xp_ledger_user_recent_idx
      ON xp_ledger(telegram_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS activity_events (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      event_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 1 CHECK (amount > 0),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(telegram_id, event_type, source_id)
    );
    CREATE INDEX IF NOT EXISTS activity_events_user_type_idx
      ON activity_events(telegram_id, event_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS mission_definitions (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly')),
      action_type TEXT NOT NULL,
      target_count INTEGER NOT NULL CHECK (target_count > 0),
      xp_reward INTEGER NOT NULL DEFAULT 0 CHECK (xp_reward >= 0),
      silver_reward INTEGER NOT NULL DEFAULT 0 CHECK (silver_reward >= 0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_missions (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      mission_id BIGINT NOT NULL REFERENCES mission_definitions(id),
      period_start DATE NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0),
      completed_at TIMESTAMPTZ,
      claimed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(telegram_id, mission_id, period_start)
    );
    CREATE INDEX IF NOT EXISTS user_missions_user_period_idx
      ON user_missions(telegram_id, period_start DESC);

    CREATE TABLE IF NOT EXISTS achievement_definitions (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      action_type TEXT NOT NULL,
      target_count INTEGER NOT NULL CHECK (target_count > 0),
      xp_reward INTEGER NOT NULL DEFAULT 0 CHECK (xp_reward >= 0),
      cosmetic_reward JSONB NOT NULL DEFAULT '{}'::jsonb,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      achievement_id BIGINT NOT NULL REFERENCES achievement_definitions(id),
      progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0),
      unlocked_at TIMESTAMPTZ,
      claimed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(telegram_id, achievement_id)
    );
    CREATE INDEX IF NOT EXISTS user_achievements_user_idx
      ON user_achievements(telegram_id, unlocked_at DESC);
  `);

  const missions = [
    ['daily_first_visit','Загляни в GiftsDrop','Открой платформу сегодня','daily','daily_visit',1,20],
    ['daily_spin','Первая прокрутка','Заверши одну прокрутку','daily','spin_completed',1,10],
    ['daily_battle','Участник батла','Заверши NFT-батл','daily','battle_completed',1,25],
    ['weekly_visits','Постоянный игрок','Зайди в GiftsDrop в 4 разных дня','weekly','daily_visit',4,60],
    ['weekly_spins','Любитель рулетки','Заверши 5 прокруток','weekly','spin_completed',5,50],
    ['weekly_battles','Боец недели','Заверши 3 NFT-батла','weekly','battle_completed',3,75],
    ['weekly_collection','Первый экспонат','Получи NFT за неделю','weekly','nft_collected',1,50],
    ['weekly_social','Новый знакомый','Пригласи одного нового игрока','weekly','referral_completed',1,75]
  ];
  for (const row of missions) {
    await pool.query(`
      INSERT INTO mission_definitions
        (code,title,description,cadence,action_type,target_count,xp_reward)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (code) DO NOTHING
    `, row);
  }

  const achievements = [
    ['first_visit','Добро пожаловать','Первый запуск GiftsDrop','daily_visit',1,50,{}],
    ['first_spin','Первый запуск','Заверши первую прокрутку','spin_completed',1,30,{}],
    ['first_battle','Первый бой','Заверши первый NFT-батл','battle_completed',1,50,{}],
    ['first_nft','Коллекционер','Получи первый NFT','nft_collected',1,75,{}],
    ['spins_10','Десять попыток','Заверши 10 прокруток','spin_completed',10,100,{}],
    ['battles_10','Соревнователь','Заверши 10 NFT-батлов','battle_completed',10,150,{}],
    ['visits_7','Постоянство','Заходи в 7 разных дней','daily_visit',7,120,{}]
  ];
  for (const row of achievements) {
    await pool.query(`
      INSERT INTO achievement_definitions
        (code,title,description,action_type,target_count,xp_reward,cosmetic_reward)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
      ON CONFLICT (code) DO NOTHING
    `, [row[0],row[1],row[2],row[3],row[4],row[5],JSON.stringify(row[6])]);
  }
}

async function awardXp(db, telegramId, amount, sourceType, sourceId, metadata = {}) {
  const safeAmount = Math.floor(Number(amount));
  if (!Number.isInteger(safeAmount) || safeAmount <= 0) return false;
  const key = String(sourceId);
  const inserted = await db.query(`
    INSERT INTO xp_ledger
      (telegram_id, amount, source_type, source_id, idempotency_key, metadata)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  `, [String(telegramId), safeAmount, String(sourceType), key, key, JSON.stringify(metadata)]);
  if (!inserted.rowCount) return false;
  await db.query('UPDATE users SET xp = xp + $1 WHERE telegram_id = $2', [safeAmount, String(telegramId)]);
  return true;
}

async function ensureUserMissions(db, telegramId) {
  await db.query(`
    INSERT INTO user_missions (telegram_id, mission_id, period_start)
    SELECT $1, id,
      CASE WHEN cadence = 'daily' THEN ${utcDateSql()}
           ELSE date_trunc('week', ${utcDateSql()}::timestamp)::date END
    FROM mission_definitions
    WHERE active = TRUE
    ON CONFLICT (telegram_id, mission_id, period_start) DO NOTHING
  `, [String(telegramId)]);
  await db.query(`
    INSERT INTO user_achievements (telegram_id, achievement_id)
    SELECT $1, id FROM achievement_definitions WHERE active = TRUE
    ON CONFLICT (telegram_id, achievement_id) DO NOTHING
  `, [String(telegramId)]);
}

async function recordActivity(db, telegramId, eventType, sourceId, amount = 1, payload = {}) {
  const inserted = await db.query(`
    INSERT INTO activity_events (telegram_id,event_type,source_id,amount,payload)
    VALUES ($1,$2,$3,$4,$5::jsonb)
    ON CONFLICT (telegram_id,event_type,source_id) DO NOTHING
    RETURNING id
  `, [String(telegramId), String(eventType), String(sourceId), Math.max(1, Math.floor(Number(amount)||1)), JSON.stringify(payload)]);
  if (!inserted.rowCount) return false;

  await ensureUserMissions(db, telegramId);
  await db.query(`
    UPDATE user_missions um
    SET progress = LEAST(md.target_count, um.progress + $3),
        completed_at = CASE
          WHEN um.progress + $3 >= md.target_count THEN COALESCE(um.completed_at, NOW())
          ELSE um.completed_at END
    FROM mission_definitions md
    WHERE um.mission_id = md.id
      AND um.telegram_id = $1
      AND md.action_type = $2
      AND um.claimed_at IS NULL
      AND um.period_start = CASE WHEN md.cadence = 'daily' THEN ${utcDateSql()}
        ELSE date_trunc('week', ${utcDateSql()}::timestamp)::date END
  `, [String(telegramId), String(eventType), Math.max(1, Math.floor(Number(amount)||1))]);

  await db.query(`
    UPDATE user_achievements ua
    SET progress = LEAST(ad.target_count, ua.progress + $3),
        unlocked_at = CASE
          WHEN ua.progress + $3 >= ad.target_count THEN COALESCE(ua.unlocked_at, NOW())
          ELSE ua.unlocked_at END
    FROM achievement_definitions ad
    WHERE ua.achievement_id = ad.id
      AND ua.telegram_id = $1
      AND ad.action_type = $2
      AND ua.unlocked_at IS NULL
  `, [String(telegramId), String(eventType), Math.max(1, Math.floor(Number(amount)||1))]);
  return true;
}

async function recordDailyVisit(pool, telegramId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(`
      UPDATE users
      SET last_xp_date = ${utcDateSql()}
      WHERE telegram_id = $1
        AND last_xp_date IS DISTINCT FROM ${utcDateSql()}
      RETURNING telegram_id
    `, [String(telegramId)]);
    const date = await client.query(`SELECT ${utcDateSql()}::text AS day`);
    if (updated.rowCount) {
      await awardXp(client, telegramId, 20, 'daily_visit', `daily-visit:${telegramId}:${date.rows[0].day}`);
    }
    // Backfill today's visit event even for users whose legacy daily XP was already granted.
    await recordActivity(client, telegramId, 'daily_visit', `daily-visit:${date.rows[0].day}`);
    await ensureUserMissions(client, telegramId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function claimMission(pool, telegramId, missionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      SELECT um.*, md.xp_reward, md.silver_reward
      FROM user_missions um JOIN mission_definitions md ON md.id = um.mission_id
      WHERE um.id = $1 AND um.telegram_id = $2
      FOR UPDATE OF um
    `, [missionId, String(telegramId)]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return {status:404}; }
    const row = result.rows[0];
    if (!row.completed_at) { await client.query('ROLLBACK'); return {status:409,error:'Задание ещё не выполнено'}; }
    if (row.claimed_at) { await client.query('ROLLBACK'); return {status:409,error:'Награда уже получена'}; }
    const key = `mission:${row.id}:${telegramId}`;
    if (Number(row.xp_reward) > 0) await awardXp(client, telegramId, Number(row.xp_reward), 'mission', key);
    if (Number(row.silver_reward) > 0) await client.query('UPDATE users SET silver = silver + $1 WHERE telegram_id = $2',[Number(row.silver_reward),String(telegramId)]);
    await client.query('UPDATE user_missions SET claimed_at = NOW() WHERE id = $1',[row.id]);
    await client.query('COMMIT');
    return {status:200,reward:{xp:Number(row.xp_reward),silver:Number(row.silver_reward)}};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function claimAchievement(pool, telegramId, achievementId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      SELECT ua.*, ad.xp_reward, ad.cosmetic_reward
      FROM user_achievements ua JOIN achievement_definitions ad ON ad.id = ua.achievement_id
      WHERE ua.achievement_id = $1 AND ua.telegram_id = $2
      FOR UPDATE OF ua
    `, [achievementId, String(telegramId)]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return {status:404}; }
    const row = result.rows[0];
    if (!row.unlocked_at) { await client.query('ROLLBACK'); return {status:409,error:'Достижение ещё не открыто'}; }
    if (row.claimed_at) { await client.query('ROLLBACK'); return {status:409,error:'Награда уже получена'}; }
    const key = `achievement:${row.achievement_id}:${telegramId}`;
    if (Number(row.xp_reward) > 0) await awardXp(client, telegramId, Number(row.xp_reward), 'achievement', key);
    await client.query('UPDATE user_achievements SET claimed_at = NOW() WHERE id = $1',[row.id]);
    await client.query('COMMIT');
    return {status:200,reward:{xp:Number(row.xp_reward),cosmetic:row.cosmetic_reward||{}}};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function getCoreOverview(pool, telegramId) {
  await ensureUserMissions(pool, telegramId);
  const [account, missions, achievements, ledger] = await Promise.all([
    pool.query('SELECT xp FROM users WHERE telegram_id = $1',[String(telegramId)]),
    pool.query(`
      SELECT um.id, md.code, md.title, md.description, md.cadence,
        md.target_count, um.progress, md.xp_reward, md.silver_reward,
        um.completed_at, um.claimed_at
      FROM user_missions um JOIN mission_definitions md ON md.id = um.mission_id
      WHERE um.telegram_id = $1
        AND um.period_start = CASE WHEN md.cadence = 'daily' THEN ${utcDateSql()}
          ELSE date_trunc('week', ${utcDateSql()}::timestamp)::date END
      ORDER BY CASE md.cadence WHEN 'daily' THEN 0 ELSE 1 END, um.id
    `,[String(telegramId)]),
    pool.query(`
      SELECT ad.id AS achievement_id, ad.code, ad.title, ad.description, ad.target_count,
        ad.xp_reward, ua.progress, ua.unlocked_at, ua.claimed_at
      FROM user_achievements ua JOIN achievement_definitions ad ON ad.id = ua.achievement_id
      WHERE ua.telegram_id = $1 AND ad.active = TRUE
      ORDER BY ad.id
    `,[String(telegramId)]),
    pool.query('SELECT amount,source_type,created_at FROM xp_ledger WHERE telegram_id = $1 ORDER BY id DESC LIMIT 10',[String(telegramId)])
  ]);
  return {
    xp:Number(account.rows[0]?.xp||0),
    missions:missions.rows.map(r=>({...r,id:Number(r.id),target_count:Number(r.target_count),progress:Number(r.progress),xp_reward:Number(r.xp_reward),silver_reward:Number(r.silver_reward)})),
    achievements:achievements.rows.map(r=>({...r,target_count:Number(r.target_count),progress:Number(r.progress),xp_reward:Number(r.xp_reward)})),
    recent_xp:ledger.rows.map(r=>({...r,amount:Number(r.amount)}))
  };
}

module.exports = { initProgressionDatabase, awardXp, recordActivity, recordDailyVisit, claimMission, claimAchievement, getCoreOverview };
