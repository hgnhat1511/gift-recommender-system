'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TEST_DATABASE = 'giftly_e2e_test';
const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'createDevShipper.js');

function runScript(envOverrides) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, ...envOverrides },
    encoding: 'utf8',
  });
}

test('development shipper script rejects unsafe DBs and only creates or updates a test shipper', async () => {
  assert.equal(process.env.TEST_DB_NAME, TEST_DATABASE);
  process.env.DB_NAME = TEST_DATABASE;
  process.env.NODE_ENV = 'test';

  const pool = require('../../config/db');
  const [[database]] = await pool.query('SELECT DATABASE() name');
  console.log(`[dev-shipper-script.test.js] SELECT DATABASE(): ${database.name}`);
  assert.equal(database.name, TEST_DATABASE);

  const email = `dev-shipper-${crypto.randomUUID()}@example.invalid`;
  const firstPassword = crypto.randomBytes(24).toString('base64url');
  const nextPassword = crypto.randomBytes(24).toString('base64url');
  try {
    const production = runScript({
      NODE_ENV: 'production', DB_NAME: TEST_DATABASE, TEST_DB_NAME: TEST_DATABASE,
    });
    assert.equal(production.status, 1);
    assert.match(production.stderr, /cannot run in production/i);

    const developmentDatabase = runScript({
      NODE_ENV: 'test', DB_NAME: 'gift_ecommerce', TEST_DB_NAME: 'gift_ecommerce',
    });
    assert.equal(developmentDatabase.status, 1);
    assert.match(developmentDatabase.stderr, /refusing to write to any other database/i);

    const invalid = runScript({
      NODE_ENV: 'test', DB_NAME: TEST_DATABASE, TEST_DB_NAME: TEST_DATABASE,
    });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /SHIPPER_NAME, SHIPPER_EMAIL, and an 8–72 byte SHIPPER_PASSWORD/);

    const create = runScript({
      NODE_ENV: 'test', DB_NAME: TEST_DATABASE, TEST_DB_NAME: TEST_DATABASE,
      SHIPPER_NAME: 'Test Shipper', SHIPPER_EMAIL: email, SHIPPER_PASSWORD: firstPassword,
    });
    assert.equal(create.status, 0, create.stderr || create.stdout);
    assert.match(create.stdout, /Created development shipper account/);

    const [[created]] = await pool.execute('SELECT id,full_name,role,status,password_hash FROM users WHERE email=?', [email]);
    assert.ok(created);
    assert.deepEqual([created.full_name, created.role, created.status], ['Test Shipper', 'SHIPPER', 'ACTIVE']);
    assert.equal(await require('bcryptjs').compare(firstPassword, created.password_hash), true);

    await pool.execute("UPDATE users SET status='LOCKED' WHERE id=?", [created.id]);
    const update = runScript({
      NODE_ENV: 'test', DB_NAME: TEST_DATABASE, TEST_DB_NAME: TEST_DATABASE,
      SHIPPER_NAME: 'Updated Test Shipper', SHIPPER_EMAIL: email, SHIPPER_PASSWORD: nextPassword,
    });
    assert.equal(update.status, 0, update.stderr || update.stdout);
    assert.match(update.stdout, /Updated development shipper account/);

    const [[updated]] = await pool.execute('SELECT full_name,role,status,password_hash FROM users WHERE id=?', [created.id]);
    assert.deepEqual([updated.full_name, updated.role, updated.status], ['Updated Test Shipper', 'SHIPPER', 'ACTIVE']);
    assert.equal(await require('bcryptjs').compare(nextPassword, updated.password_hash), true);
    assert.equal(await require('bcryptjs').compare(firstPassword, updated.password_hash), false);
  } finally {
    await pool.execute('DELETE FROM users WHERE email=?', [email]);
    await pool.end();
  }
});
