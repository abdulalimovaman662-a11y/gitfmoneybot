'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { initProgressionDatabase } = require('./progression');
const { initMiniGamesDatabase, startMiniGame, performMiniGameAction } = require('./minigames');

const databaseUrl = process.env.TEST_DATABASE_URL;

test('mini-games use an isolated PostgreSQL schema and keep charges atomic', {
  skip: !databaseUrl
}, async t => {
  const admin = new Pool({ connectionString: databaseUrl });
  const schema = 'minigames_test_' + crypto.randomBytes(6).toString('hex');
  await admin.query('CREATE SCHEMA "' + schema + '"');
  const pool = new Pool({
    connectionString: databaseUrl,
    options: '-c search_path=' + schema
  });

  t.after(async () => {
    await pool.end();
    await admin.query('DROP SCHEMA "' + schema + '" CASCADE');
    await admin.end();
  });

  await pool.query(`
    CREATE TABLE users (
      telegram_id BIGINT PRIMARY KEY,
      silver INTEGER NOT NULL DEFAULT 0,
      xp BIGINT NOT NULL DEFAULT 0
    )
  `);
  await pool.query("INSERT INTO users (telegram_id, silver) VALUES (101, 100), (102, 100), (103, 100), (104, 1000), (105, 100), (106, 100), (107, 100)");
  await initProgressionDatabase(pool);
  await initMiniGamesDatabase(pool);

  const first = await startMiniGame(pool, '101', 'reaction', 'reaction_request_0001');
  const retry = await startMiniGame(pool, '101', 'reaction', 'reaction_request_0001');
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.reused, true);
  assert.equal(Number((await pool.query('SELECT silver FROM users WHERE telegram_id = 101')).rows[0].silver), 85);

  const concurrentStarts = await Promise.all([
    startMiniGame(pool, '106', 'reaction', 'reaction_concurrent_start_001'),
    startMiniGame(pool, '106', 'reaction', 'reaction_concurrent_start_001')
  ]);
  assert.equal(concurrentStarts.filter(result => result.status === 201).length, 1);
  assert.equal(concurrentStarts.filter(result => result.status === 200 && result.reused).length, 1);
  assert.equal(concurrentStarts[0].session.id, concurrentStarts[1].session.id);
  assert.equal(Number((await pool.query('SELECT silver FROM users WHERE telegram_id = 106')).rows[0].silver), 85,
    'concurrent retries of one start request must charge only once');
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS total FROM minigame_sessions WHERE telegram_id = 106')).rows[0].total), 1);

  for (let i = 2; i <= 5; i++) {
    const result = await startMiniGame(pool, '101', 'reaction', 'reaction_request_' + String(i).padStart(4, '0'));
    assert.equal(result.status, 201);
  }
  const blocked = await startMiniGame(pool, '101', 'reaction', 'reaction_request_0006');
  assert.equal(blocked.status, 429);
  assert.equal(Number((await pool.query('SELECT silver FROM users WHERE telegram_id = 101')).rows[0].silver), 25);

  for (let i = 1; i <= 3; i++) {
    const result = await startMiniGame(pool, '104', 'safe', 'safe_daily_' + String(i).padStart(4, '0'));
    assert.equal(result.status, 201);
  }
  const safeDailyBlocked = await startMiniGame(pool, '104', 'safe', 'safe_daily_0004');
  assert.equal(safeDailyBlocked.status, 429, 'safe game must enforce its three-round daily limit');
  assert.equal(Number((await pool.query('SELECT silver FROM users WHERE telegram_id = 104')).rows[0].silver), 955,
    'a blocked safe round must not charge silver');

  for (let i = 1; i <= 5; i++) {
    const result = await startMiniGame(pool, '104', 'memory', 'memory_daily_' + String(i).padStart(4, '0'));
    assert.equal(result.status, 201);
  }
  const memoryDailyBlocked = await startMiniGame(pool, '104', 'memory', 'memory_daily_0006');
  assert.equal(memoryDailyBlocked.status, 429, 'memory game must enforce its five-round daily limit');
  assert.equal(Number((await pool.query('SELECT silver FROM users WHERE telegram_id = 104')).rows[0].silver), 880,
    'a blocked memory round must not charge silver');

  const safe = await startMiniGame(pool, '102', 'safe', 'safe_request_000001');
  assert.equal(safe.status, 201);
  const safeRow = (await pool.query('SELECT state FROM minigame_sessions WHERE id = $1', [safe.session.id])).rows[0];
  const invalidGuess = await performMiniGameAction(pool, '102', safe.session.id, { action: 'guess', guess: '12x4', action_id: 'safe_invalid_0001' });
  assert.equal(invalidGuess.status, 400);
  const solved = await performMiniGameAction(pool, '102', safe.session.id, {
    action: 'guess',
    guess: safeRow.state.secret,
    action_id: 'safe_solve_00001'
  });
  assert.equal(solved.session.status, 'completed');
  assert.equal(solved.session.message, 'Сейф открыт за 1 из 8 попыток!');
  assert.equal(solved.session.score, 1);
  assert.equal(Number((await pool.query('SELECT score FROM minigame_sessions WHERE id = $1', [safe.session.id])).rows[0].score), 1);

  assert.equal(solved.session.xp_awarded, 5);

  const solvedRetry = await performMiniGameAction(pool, '102', safe.session.id, {
    action: 'guess',
    guess: safeRow.state.secret,
    action_id: 'safe_solve_00001'
  });
  assert.deepEqual(solvedRetry, solved, 'replaying the same action ID must return the original receipt');
  assert.equal(Number((await pool.query(
    "SELECT SUM(amount) AS total FROM xp_ledger WHERE telegram_id = 102 AND source_type = 'minigame'"
  )).rows[0].total), 5, 'replaying a completed action must not award XP twice');
  assert.equal(Number((await pool.query('SELECT silver FROM users WHERE telegram_id = 102')).rows[0].silver), 85,
    'replaying a completed action must not charge silver again');

  const concurrentSafe = await startMiniGame(pool, '105', 'safe', 'safe_concurrent_001');
  assert.equal(concurrentSafe.status, 201);
  const concurrentRow = (await pool.query('SELECT state FROM minigame_sessions WHERE id = $1', [concurrentSafe.session.id])).rows[0];
  const concurrentPayload = {
    action: 'guess',
    guess: concurrentRow.state.secret,
    action_id: 'safe_concurrent_action_01'
  };
  const concurrentResults = await Promise.all([
    performMiniGameAction(pool, '105', concurrentSafe.session.id, concurrentPayload),
    performMiniGameAction(pool, '105', concurrentSafe.session.id, concurrentPayload)
  ]);
  assert.deepEqual(concurrentResults[0], concurrentResults[1],
    'concurrent retries with the same action ID must receive the same stored result');
  assert.equal(concurrentResults[0].session.state.attempts, 1,
    'the same concurrent guess must only count as one attempt');
  assert.equal(Number((await pool.query(
    "SELECT SUM(amount) AS total FROM xp_ledger WHERE telegram_id = 105 AND source_type = 'minigame'"
  )).rows[0].total), 5, 'the concurrent replay must not award XP twice');
  assert.equal(Number((await pool.query('SELECT silver FROM users WHERE telegram_id = 105')).rows[0].silver), 85,
    'the concurrent replay must not charge the round twice');

  const memory = await startMiniGame(pool, '102', 'memory', 'memory_request_0001');
  assert.equal(memory.status, 201);
  const memoryRow = (await pool.query('SELECT state FROM minigame_sessions WHERE id = $1', [memory.session.id])).rows[0];
  const pairs = new Map();
  memoryRow.state.deck.forEach((value, index) => {
    if (!pairs.has(value)) pairs.set(value, []);
    pairs.get(value).push(index);
  });
  let matched;
  let memoryAction = 0;
  for (const indexes of pairs.values()) {
    await performMiniGameAction(pool, '102', memory.session.id, {
      action: 'flip', index: indexes[0], action_id: 'memory_flip_' + String(++memoryAction).padStart(4, '0')
    });
    matched = await performMiniGameAction(pool, '102', memory.session.id, {
      action: 'flip', index: indexes[1], action_id: 'memory_flip_' + String(++memoryAction).padStart(4, '0')
    });
  }
  assert.equal(matched.session.status, 'completed');
  assert.equal(matched.session.state.matched.length, 16);
  assert.equal(matched.session.xp_awarded, 5);
  assert.equal(Number((await pool.query('SELECT silver FROM users WHERE telegram_id = 102')).rows[0].silver), 70);
  assert.equal(Number((await pool.query('SELECT xp FROM users WHERE telegram_id = 102')).rows[0].xp), 10);

  const expiredWithHits = await startMiniGame(pool, '104', 'reaction', 'reaction_expired_hits_001');
  assert.equal(expiredWithHits.status, 201);
  await pool.query(
    "UPDATE minigame_sessions SET created_at = NOW() - INTERVAL '31 seconds', state = jsonb_set(state, '{hits}', '3'::jsonb) WHERE id = $1",
    [expiredWithHits.session.id]
  );
  const lateFinish = await performMiniGameAction(pool, '104', expiredWithHits.session.id, {
    action: 'finish', action_id: 'reaction_late_finish_001'
  });
  assert.equal(lateFinish.session.status, 'completed',
    'a late finish request must preserve a round that already recorded hits');
  assert.equal(lateFinish.session.score, 3);
  assert.equal(lateFinish.session.xp_awarded, 5);
  const lateFinishRetry = await performMiniGameAction(pool, '104', expiredWithHits.session.id, {
    action: 'finish', action_id: 'reaction_late_finish_001'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(lateFinishRetry)), JSON.parse(JSON.stringify(lateFinish)),
    'retrying a late finish must return the original result without awarding XP again');
  assert.equal(Number((await pool.query(
    "SELECT SUM(amount) AS total FROM xp_ledger WHERE telegram_id = 104 AND source_type = 'minigame'"
  )).rows[0].total), 5);

  const xpBeforeEmptyExpiry = Number((await pool.query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM xp_ledger WHERE telegram_id = 105 AND source_type = 'minigame'"
  )).rows[0].total);
  const expiredWithoutHits = await startMiniGame(pool, '105', 'reaction', 'reaction_expired_empty_001');
  assert.equal(expiredWithoutHits.status, 201);
  await pool.query(
    "UPDATE minigame_sessions SET created_at = NOW() - INTERVAL '31 seconds' WHERE id = $1",
    [expiredWithoutHits.session.id]
  );
  const emptyLateFinish = await performMiniGameAction(pool, '105', expiredWithoutHits.session.id, {
    action: 'finish', action_id: 'reaction_empty_finish_001'
  });
  assert.equal(emptyLateFinish.session.status, 'expired',
    'a reaction round with no hits must expire instead of being marked completed');
  assert.equal(emptyLateFinish.session.xp_awarded, 0);
  const xpAfterEmptyExpiry = Number((await pool.query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM xp_ledger WHERE telegram_id = 105 AND source_type = 'minigame'"
  )).rows[0].total);
  assert.equal(xpAfterEmptyExpiry, xpBeforeEmptyExpiry, 'an empty expired round must not add XP');

  await pool.query(`INSERT INTO xp_ledger (telegram_id, amount, source_type, source_id, idempotency_key)
    VALUES (103, 23, 'minigame', 'seed-cap', 'seed-cap'),
           (107, 20, 'minigame', 'seed-concurrent-cap', 'seed-concurrent-cap')`);
  const capReaction = await startMiniGame(pool, '107', 'reaction', 'reaction_concurrent_cap_01');
  const capSafe = await startMiniGame(pool, '107', 'safe', 'safe_concurrent_cap_01');
  const capSafeRow = (await pool.query('SELECT state FROM minigame_sessions WHERE id = $1', [capSafe.session.id])).rows[0];
  await pool.query(
    "UPDATE minigame_sessions SET created_at = NOW() - INTERVAL '31 seconds', state = jsonb_set(state, '{hits}', '1'::jsonb) WHERE id = $1",
    [capReaction.session.id]
  );
  const [capReactionResult, capSafeResult] = await Promise.all([
    performMiniGameAction(pool, '107', capReaction.session.id, {
      action: 'finish', action_id: 'reaction_concurrent_cap_action'
    }),
    performMiniGameAction(pool, '107', capSafe.session.id, {
      action: 'guess', guess: capSafeRow.state.secret, action_id: 'safe_concurrent_cap_action'
    })
  ]);
  assert.equal(
    capReactionResult.session.xp_awarded + capSafeResult.session.xp_awarded,
    5,
    'two simultaneous successful games must share the remaining daily XP cap'
  );
  assert.equal(Number((await pool.query(
    "SELECT SUM(amount) AS total FROM xp_ledger WHERE telegram_id = 107 AND source_type = 'minigame'"
  )).rows[0].total), 25, 'concurrent completions must never exceed the daily XP cap');

  const cappedSafe = await startMiniGame(pool, '103', 'safe', 'safe_request_cap_1');
  const cappedRow = (await pool.query('SELECT state FROM minigame_sessions WHERE id = $1', [cappedSafe.session.id])).rows[0];
  const cappedResult = await performMiniGameAction(pool, '103', cappedSafe.session.id, { action: 'guess', guess: cappedRow.state.secret, action_id: 'safe_cap_solve_0001' });
  assert.equal(cappedResult.session.xp_awarded, 2);
  assert.equal(Number((await pool.query(`SELECT SUM(amount) AS total FROM xp_ledger WHERE telegram_id = 103 AND source_type = 'minigame'`)).rows[0].total), 25);
});
