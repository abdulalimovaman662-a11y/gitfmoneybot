'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  awardXp,
  recordActivity,
  claimMission,
  claimAchievement
} = require('../progression');

function fakeClient(queryHandler) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      return queryHandler(String(sql), params, calls.length);
    },
    release() { this.released = true; }
  };
}

test('awardXp writes ledger and users.xp in one atomic statement', async () => {
  const db = { calls: [], async query(sql, params) {
    this.calls.push({ sql: String(sql), params });
    return { rowCount: 1, rows: [{ telegram_id: '42' }] };
  }};
  const awarded = await awardXp(db, '42', 50, 'welcome', 'welcome:42');
  assert.equal(awarded, true);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /WITH inserted AS/);
  assert.match(db.calls[0].sql, /INSERT INTO xp_ledger/);
  assert.match(db.calls[0].sql, /UPDATE users AS u/);
  assert.deepEqual(db.calls[0].params.slice(0, 5), ['42', 50, 'welcome', 'welcome:42', 'welcome:42']);
});

test('awardXp rejects invalid awards and reports duplicate idempotency keys', async () => {
  let calls = 0;
  const db = { async query() { calls++; return { rowCount: 0, rows: [] }; } };
  assert.equal(await awardXp(db, '42', 0, 'test', 'bad:0'), false);
  assert.equal(await awardXp(db, '42', -5, 'test', 'bad:-5'), false);
  assert.equal(await awardXp(db, '42', 10, 'spin', 'spin:1'), false);
  assert.equal(calls, 1);
});

test('recordActivity ignores duplicate event IDs before changing counters', async () => {
  const db = { calls: 0, async query() {
    this.calls++;
    return { rowCount: 0, rows: [] };
  }};
  assert.equal(await recordActivity(db, '42', 'spin_completed', 'spin:100'), false);
  assert.equal(db.calls, 1);
});

test('recordActivity advances counters only after a new server event', async () => {
  const db = { calls: [], async query(sql) {
    this.calls.push(String(sql));
    return { rowCount: this.calls.length === 1 ? 1 : 0, rows: [] };
  }};
  assert.equal(await recordActivity(db, '42', 'spin_completed', 'spin:101', 2), true);
  assert.equal(db.calls.length, 5);
  assert.match(db.calls[0], /INSERT INTO activity_events/);
  assert.match(db.calls[3], /UPDATE user_missions/);
  assert.match(db.calls[4], /UPDATE user_achievements/);
});

test('mission claim rejects an incomplete mission without granting rewards', async () => {
  const client = fakeClient((sql) => {
    if (sql.includes('SELECT um.*')) return { rowCount: 1, rows: [{ id: 7, completed_at: null, claimed_at: null, xp_reward: 20, silver_reward: 0 }] };
    return { rowCount: 0, rows: [] };
  });
  const result = await claimMission({ connect: async () => client }, '42', 7);
  assert.equal(result.status, 409);
  assert.equal(client.calls.some(c => c.sql.includes('INSERT INTO xp_ledger')), false);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(client.released, true);
});

test('achievement claim rejects an already claimed reward', async () => {
  const client = fakeClient((sql) => {
    if (sql.includes('SELECT ua.*')) return { rowCount: 1, rows: [{ id: 8, achievement_id: 3, unlocked_at: new Date(), claimed_at: new Date(), xp_reward: 50 }] };
    return { rowCount: 0, rows: [] };
  });
  const result = await claimAchievement({ connect: async () => client }, '42', 3);
  assert.equal(result.status, 409);
  assert.equal(result.error, 'Награда уже получена');
  assert.equal(client.calls.some(c => c.sql.includes('INSERT INTO xp_ledger')), false);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(client.released, true);
});
