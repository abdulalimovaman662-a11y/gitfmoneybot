'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
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
  await pool.query("INSERT INTO users (telegram_id, silver) VALUES (101, 100), (102, 100)");
  await initMiniGamesDatabase(pool);

  const first = await startMiniGame(pool, '101', 'reaction', 'reaction_request_0001');
  const retry = await startMiniGame(pool, '101', 'reaction', 'reaction_request_0001');
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.reused, true);
  assert.equal(Number((await pool.query('SELECT silver FROM users WHERE telegram_id = 101')).rows[0].silver), 85);

  for (let i = 2; i <= 5; i++) {
    const result = await startMiniGame(pool, '101', 'reaction', 'reaction_request_' + String(i).padStart(4, '0'));
    assert.equal(result.status, 201);
  }
  const blocked = await startMiniGame(pool, '101', 'reaction', 'reaction_request_0006');
  assert.equal(blocked.status, 429);
  assert.equal(Number((await pool.query('SELECT silver FROM users WHERE telegram_id = 101')).rows[0].silver), 25);

  const safe = await startMiniGame(pool, '102', 'safe', 'safe_request_000001');
  assert.equal(safe.status, 201);
  const safeRow = (await pool.query('SELECT state FROM minigame_sessions WHERE id = $1', [safe.session.id])).rows[0];
  const solved = await performMiniGameAction(pool, '102', safe.session.id, {
    action: 'guess',
    guess: safeRow.state.secret
  });
  assert.equal(solved.session.status, 'completed');
  assert.equal(solved.session.message, 'Сейф открыт!');

  const memory = await startMiniGame(pool, '102', 'memory', 'memory_request_0001');
  assert.equal(memory.status, 201);
  const memoryRow = (await pool.query('SELECT state FROM minigame_sessions WHERE id = $1', [memory.session.id])).rows[0];
  const pair = new Map();
  let firstIndex = -1;
  let secondIndex = -1;
  memoryRow.state.deck.forEach((value, index) => {
    if (pair.has(value)) { firstIndex = pair.get(value); secondIndex = index; }
    else pair.set(value, index);
  });
  await performMiniGameAction(pool, '102', memory.session.id, { action: 'flip', index: firstIndex });
  const matched = await performMiniGameAction(pool, '102', memory.session.id, { action: 'flip', index: secondIndex });
  assert.equal(matched.session.state.matched.length, 2);
  assert.equal(Number((await pool.query('SELECT silver FROM users WHERE telegram_id = 102')).rows[0].silver), 70);
  assert.equal(Number((await pool.query('SELECT xp FROM users WHERE telegram_id = 102')).rows[0].xp), 0);
});
