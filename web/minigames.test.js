'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GAME_CONFIG, scoreGuess, isValidSafeGuess, makeMemoryDeck } = require('./minigames');

test('all mini-games cost 15 silver and have the agreed daily limits', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(GAME_CONFIG).map(([key, value]) => [key, [value.price, value.dailyLimit]])),
    { reaction: [15, 5], safe: [15, 3], memory: [15, 5] }
  );
});

test('safe cracking counts exact and misplaced digits without double counting', () => {
  assert.deepEqual(scoreGuess('1122', '1212'), { exact: 2, misplaced: 2 });
  assert.deepEqual(scoreGuess('1234', '1234'), { exact: 4, misplaced: 0 });
  assert.deepEqual(scoreGuess('1234', '5678'), { exact: 0, misplaced: 0 });
});

test('safe code accepts exactly four decimal digits', () => {
  assert.equal(isValidSafeGuess('0000'), true);
  assert.equal(isValidSafeGuess('1234'), true);
  assert.equal(isValidSafeGuess('12a4'), false);
  assert.equal(isValidSafeGuess('123'), false);
  assert.equal(isValidSafeGuess('12345'), false);
  assert.equal(isValidSafeGuess(1234), false);
});

test('memory deck always contains eight pairs and sixteen cards', () => {
  const deck = makeMemoryDeck();
  assert.equal(deck.length, 16);
  const counts = new Map();
  for (const value of deck) counts.set(value, (counts.get(value) || 0) + 1);
  assert.equal(counts.size, 8);
  for (const count of counts.values()) assert.equal(count, 2);
});

class FakePool {
  constructor(silver = 100) { this.silver = silver; this.sessions = []; }
  async connect() {
    const db = this;
    let snapshot;
    return {
      async query(sql, params = []) {
        const query = sql.replace(/\s+/g, ' ').trim();
        if (query === 'BEGIN') { snapshot = { silver: db.silver, length: db.sessions.length }; return { rows: [] }; }
        if (query === 'COMMIT') { snapshot = null; return { rows: [] }; }
        if (query === 'ROLLBACK') {
          if (snapshot) { db.silver = snapshot.silver; db.sessions.length = snapshot.length; }
          return { rows: [] };
        }
        if (query.startsWith('SELECT telegram_id, silver FROM users')) {
          return { rowCount: 1, rows: [{ telegram_id: '42', silver: db.silver }] };
        }
        if (query.startsWith('SELECT * FROM minigame_sessions WHERE telegram_id = $1 AND request_id = $2')) {
          const row = db.sessions.find(item => item.telegram_id === params[0] && item.request_id === params[1]);
          return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
        }
        if (query.startsWith('SELECT amount FROM xp_ledger WHERE idempotency_key = $1')) {
          return { rowCount: 0, rows: [] };
        }
        if (query.startsWith('SELECT COUNT(*)::int AS used')) {
          const used = db.sessions.filter(item => item.telegram_id === params[0] && item.game_type === params[1]).length;
          return { rows: [{ used }] };
        }
        if (query.startsWith('UPDATE users SET silver = silver -')) {
          db.silver -= params[0];
          return { rowCount: 1, rows: [] };
        }
        if (query.startsWith('INSERT INTO minigame_sessions')) {
          const row = {
            id: params[0], telegram_id: params[1], game_type: params[2],
            request_id: params[3], state: JSON.parse(params[4]),
            status: 'active', score: 0, created_at: new Date()
          };
          db.sessions.push(row);
          return { rowCount: 1, rows: [row] };
        }
        throw new Error('Unexpected SQL in test: ' + query);
      },
      release() {}
    };
  }
}

test('retrying the same start request charges silver only once', async () => {
  const { startMiniGame } = require('./minigames');
  const pool = new FakePool(100);
  const first = await startMiniGame(pool, '42', 'reaction', 'request_00000001');
  const retry = await startMiniGame(pool, '42', 'reaction', 'request_00000001');
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.reused, true);
  assert.equal(pool.silver, 85);
  assert.equal(pool.sessions.length, 1);
});

test('daily attempt limit is enforced before another charge', async () => {
  const { startMiniGame } = require('./minigames');
  const pool = new FakePool(500);
  for (let i = 0; i < 5; i++) {
    const result = await startMiniGame(pool, '42', 'reaction', 'reaction_req_' + String(i).padStart(3, '0'));
    assert.equal(result.status, 201);
  }
  const blocked = await startMiniGame(pool, '42', 'reaction', 'reaction_req_999');
  assert.equal(blocked.status, 429);
  assert.equal(pool.silver, 425);
  assert.equal(pool.sessions.length, 5);
});
