'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');

const testDatabase = (process.env.TEST_DB_NAME || process.env.DB_NAME || '').trim();

function runDevGhnDeliver({ orderCode = 'ORD-TEST', ghnOrderCode = 'GHN-TEST', envOverrides = {} } = {}) {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'devGhnDeliver.js');
  const backendDirectory = path.join(__dirname, '..', '..');
  const child = spawn(process.execPath, [scriptPath, orderCode, ghnOrderCode], {
    cwd: backendDirectory,
    env: { ...process.env, ...envOverrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('dev GHN delivery script is guarded and advances only the local test order', {
  skip: !testDatabase ? 'Set TEST_DB_NAME to an isolated _test database.' : false,
}, async (t) => {
  assert.match(testDatabase, /^giftly_[a-z0-9_]*_test$/i);
  assert.notEqual(testDatabase, 'giftly_verification_test');
  assert.equal(testDatabase, 'giftly_e2e_test');
  process.env.DB_NAME = testDatabase;
  process.env.TEST_DB_NAME = testDatabase;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('base64url');
  process.env.GHN_SHOP_ID = '92157';
  process.env.GHN_WEBHOOK_SECRET = 'dev-ghn-deliver-test-secret';

  const pool = require('../../config/db');
  const [[database]] = await pool.query('SELECT DATABASE() name');
  console.log(`[dev-ghn-deliver.test.js] SELECT DATABASE(): ${database.name}`);
  assert.equal(database.name, testDatabase);

  const { app } = require('../../server');
  let server;
  try {
    await t.test('refuses production and non-test databases before sending requests', async () => {
      const production = await runDevGhnDeliver({ envOverrides: { NODE_ENV: 'production' } });
      assert.equal(production.code, 1);
      assert.match(production.stderr, /Refusing to send a development GHN webhook in production/);

      const devDatabase = await runDevGhnDeliver({ envOverrides: {
        NODE_ENV: 'test', DB_NAME: 'gift_ecommerce', TEST_DB_NAME: '',
      } });
      assert.equal(devDatabase.code, 2);
      assert.match(devDatabase.stderr, /DB_NAME and TEST_DB_NAME are both giftly_e2e_test/);
    });

    server = app.listen(0);
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const userEmail = `dev-ghn-deliver-${crypto.randomUUID()}@example.invalid`;
    const [user] = await pool.execute(
      "INSERT INTO users (full_name,email,password_hash,role,status) VALUES (? ,?,'test-only-no-login','USER','ACTIVE')",
      ['GHN Script Test', userEmail],
    );
    const orderCode = `DGHN${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
    const [order] = await pool.execute(`INSERT INTO orders
      (order_code,user_id,status,payment_method,payment_status,recipient_name,phone,shipping_address,
       subtotal,discount_amount,shipping_fee,total_amount)
      VALUES (?,?,'PROCESSING','COD','UNPAID','GHN Test Receiver','0900000000',?,100000,0,0,100000)`,
    [orderCode, user.insertId, JSON.stringify({ addressLine: 'Test Road', ward: 'Test Ward', district: 'Test District', city: 'Test City' })]);
    const ghnOrderCode = `GHN-${orderCode}`;
    await pool.execute("INSERT INTO shipments (order_id,client_order_code,provider,provider_order_code,status) VALUES (?,?,'GHN',?,'CREATED')",
      [order.insertId, orderCode, ghnOrderCode]);

    await t.test('sends signed local delivering and delivered events for the demo order', async () => {
      const result = await runDevGhnDeliver({
        orderCode,
        ghnOrderCode,
        envOverrides: { GIFTLY_LOCAL_API_URL: baseUrl },
      });
      assert.equal(result.code, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /GHN webhook delivering: accepted/);
      assert.match(result.stdout, /GHN webhook delivered: accepted/);
      const [[saved]] = await pool.execute('SELECT status,payment_status,delivered_at FROM orders WHERE id=?', [order.insertId]);
      assert.equal(saved.status, 'DELIVERED');
      assert.equal(saved.payment_status, 'PAID');
      assert.ok(saved.delivered_at);
      const [history] = await pool.execute('SELECT from_status,to_status,source FROM order_status_history WHERE order_id=? ORDER BY id', [order.insertId]);
      assert.deepEqual(history.map((row) => [row.from_status,row.to_status,row.source]), [
        ['PROCESSING','SHIPPED','GHN'], ['SHIPPED','DELIVERED','GHN'],
      ]);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
