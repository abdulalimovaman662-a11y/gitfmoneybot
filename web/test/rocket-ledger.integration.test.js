const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const databaseUrl = process.env.ROCKET_TEST_DATABASE_URL;

test('Rocket ledger PostgreSQL integration: atomic debit, one-time cashout, NFT loss/return', {
  skip: !databaseUrl && 'ROCKET_TEST_DATABASE_URL is not configured'
}, async () => {
  const schema = 'rocket_it_' + process.pid;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query('CREATE SCHEMA ' + schema);
  const pool = new Pool({
    connectionString: databaseUrl,
    options: '-c search_path=' + schema
  });

  try {
    await pool.query(\`
      CREATE TABLE users (
        telegram_id BIGINT PRIMARY KEY,
        silver INTEGER NOT NULL CHECK (silver >= 0)
      );
      CREATE TABLE rocket_rounds (
        id BIGSERIAL PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('betting','running','crashed'))
      );
      CREATE TABLE user_inventory (
        id BIGSERIAL PRIMARY KEY,
        telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
        status TEXT NOT NULL CHECK (status IN ('owned','consumed'))
      );
      CREATE TABLE rocket_bets (
        id BIGSERIAL PRIMARY KEY,
        round_id BIGINT NOT NULL REFERENCES rocket_rounds(id),
        telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
        stake_kind TEXT NOT NULL CHECK (stake_kind IN ('silver','nft')),
        stake_amount INTEGER NOT NULL,
        inventory_id BIGINT REFERENCES user_inventory(id),
        status TEXT NOT NULL DEFAULT 'active',
        payout_silver INTEGER NOT NULL DEFAULT 0,
        cashout_multiplier NUMERIC,
        settled_at TIMESTAMPTZ
      );
      CREATE TABLE rocket_silver_ledger (
        id BIGSERIAL PRIMARY KEY,
        bet_id BIGINT NOT NULL REFERENCES rocket_bets(id),
        telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
        entry_type TEXT NOT NULL CHECK (entry_type IN ('stake_debit','cashout_credit')),
        amount INTEGER NOT NULL CHECK (amount >= 0),
        balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
        UNIQUE (bet_id, entry_type)
      );
      INSERT INTO users VALUES (1001, 1000);
      INSERT INTO rocket_rounds(status) VALUES ('betting'), ('running');
      INSERT INTO user_inventory(telegram_id,status) VALUES (1001,'owned'), (1001,'owned');
    \`);

    // Debit and ledger insert are one transaction: a failed ledger insert rolls back balance + bet.
    const debit = await pool.connect();
    let silverBetId;
    try {
      await debit.query('BEGIN');
      const locked = await debit.query('SELECT silver FROM users WHERE telegram_id=1001 FOR UPDATE');
      assert.equal(Number(locked.rows[0].silver), 1000);
      await debit.query('UPDATE users SET silver=silver-250 WHERE telegram_id=1001');
      const bet = await debit.query(
        "INSERT INTO rocket_bets(round_id,telegram_id,stake_kind,stake_amount) VALUES(1,1001,'silver',250) RETURNING id"
      );
      silverBetId = bet.rows[0].id;
      await debit.query(
        "INSERT INTO rocket_silver_ledger(bet_id,telegram_id,entry_type,amount,balance_after) VALUES($1,1001,'stake_debit',250,750)",
        [silverBetId]
      );
      await debit.query('COMMIT');
    } catch (error) {
      await debit.query('ROLLBACK');
      throw error;
    } finally {
      debit.release();
    }
    assert.equal(Number((await pool.query('SELECT silver FROM users WHERE telegram_id=1001')).rows[0].silver), 750);
    assert.equal(Number((await pool.query("SELECT COUNT(*) FROM rocket_silver_ledger WHERE bet_id=$1 AND entry_type='stake_debit'", [silverBetId])).rows[0].count), 1);

    // Two simultaneous cashouts: row lock + conditional settlement allows only one credit.
    async function cashout() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const bet = await client.query("SELECT * FROM rocket_bets WHERE id=$1 FOR UPDATE", [silverBetId]);
        if (!bet.rowCount || bet.rows[0].status !== 'active') {
          await client.query('ROLLBACK');
          return false;
        }
        const settled = await client.query(
          "UPDATE rocket_bets SET status='cashed_out',payout_silver=300,cashout_multiplier=1.2,settled_at=NOW() WHERE id=$1 AND status='active' RETURNING id",
          [silverBetId]
        );
        if (!settled.rowCount) {
          await client.query('ROLLBACK');
          return false;
        }
        await client.query('UPDATE users SET silver=silver+300 WHERE telegram_id=1001');
        const balance = await client.query('SELECT silver FROM users WHERE telegram_id=1001');
        await client.query(
          "INSERT INTO rocket_silver_ledger(bet_id,telegram_id,entry_type,amount,balance_after) VALUES($1,1001,'cashout_credit',300,$2)",
          [silverBetId, balance.rows[0].silver]
        );
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    const cashouts = await Promise.all([cashout(), cashout()]);
    assert.equal(cashouts.filter(Boolean).length, 1);
    assert.equal(Number((await pool.query('SELECT silver FROM users WHERE telegram_id=1001')).rows[0].silver), 1050);
    assert.equal(Number((await pool.query("SELECT COUNT(*) FROM rocket_silver_ledger WHERE bet_id=$1 AND entry_type='cashout_credit'", [silverBetId])).rows[0].count), 1);

    // NFT is consumed at stake; a crashed bet keeps it consumed (loss).
    const nftLoss = await pool.query(
      "INSERT INTO rocket_bets(round_id,telegram_id,stake_kind,stake_amount,inventory_id) VALUES(2,1001,'nft',50,1) RETURNING id"
    );
    await pool.query("UPDATE user_inventory SET status='consumed' WHERE id=1");
    await pool.query("UPDATE rocket_bets SET status='crashed',settled_at=NOW() WHERE id=$1 AND status='active'", [nftLoss.rows[0].id]);
    assert.equal((await pool.query('SELECT status FROM user_inventory WHERE id=1')).rows[0].status, 'consumed');

    // Successful NFT cashout returns the same inventory item, never silver.
    const nftWin = await pool.query(
      "INSERT INTO rocket_bets(round_id,telegram_id,stake_kind,stake_amount,inventory_id) VALUES(2,1001,'nft',50,2) RETURNING id"
    );
    await pool.query("UPDATE user_inventory SET status='consumed' WHERE id=2");
    const returned = await pool.query(
      "UPDATE user_inventory SET status='owned' WHERE id=2 AND telegram_id=1001 AND status='consumed' RETURNING id"
    );
    await pool.query("UPDATE rocket_bets SET status='cashed_out',payout_silver=0,settled_at=NOW() WHERE id=$1 AND status='active'", [nftWin.rows[0].id]);
    assert.equal(returned.rowCount, 1);
    assert.equal((await pool.query('SELECT status FROM user_inventory WHERE id=2')).rows[0].status, 'owned');
    assert.equal(Number((await pool.query('SELECT silver FROM users WHERE telegram_id=1001')).rows[0].silver), 1050);
  } finally {
    await pool.end();
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
});
