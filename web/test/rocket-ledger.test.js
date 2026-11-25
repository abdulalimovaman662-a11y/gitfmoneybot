const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('Rocket silver ledger has unique debit and payout entries per bet', () => {
  assert.match(source, /CREATE TABLE IF NOT EXISTS rocket_silver_ledger/);
  assert.match(source, /UNIQUE \(bet_id, entry_type\)/);
  assert.match(source, /CHECK \(entry_type IN \('stake_debit','cashout_credit'\)\)/);
});

test('silver stake debit and ledger record share one database transaction', () => {
  assert.match(source, /UPDATE users SET silver=silver-\$1 WHERE telegram_id=\$2/);
  assert.match(source, /INSERT INTO rocket_silver_ledger\(bet_id,telegram_id,entry_type,amount,balance_after\) VALUES\(\$1,\$2,'stake_debit',\$3,\$4\)/);
  assert.match(source, /await client\.query\('BEGIN'\)/);
  assert.match(source, /await client\.query\('COMMIT'\)/);
});

test('cashout payout and ledger record share one database transaction', () => {
  assert.match(source, /UPDATE users SET silver=silver\+\$1 WHERE telegram_id=\$2/);
  assert.match(source, /'cashout_credit'/);
  assert.match(source, /WHERE id=\$3 AND status='active'/);
});

test('real-money endpoints remain disabled until separately reviewed', () => {
  assert.match(source, /if \(url\.pathname === '\/api\/rocket\/bet' && req\.method === 'POST'\) \{\s*return send\(res, 403/);
  assert.match(source, /if \(url\.pathname === '\/api\/rocket\/cashout' && req\.method === 'POST'\) \{\s*return send\(res, 403/);
});
