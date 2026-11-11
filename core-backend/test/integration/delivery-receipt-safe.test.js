'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const testDatabase = (process.env.TEST_DB_NAME || process.env.DB_NAME || '').trim();

test('Receipt confirmation and return window use delivered_at without resetting test data', {
  skip: !testDatabase ? 'Set TEST_DB_NAME to an isolated _test database.' : false,
}, async (t) => {
  assert.match(testDatabase, /^giftly_[a-z0-9_]*_test$/i);
  assert.notEqual(testDatabase, 'giftly_verification_test');
  process.env.TEST_DB_NAME = testDatabase;
  process.env.DB_NAME = testDatabase;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('base64url');
  process.env.RETURN_WINDOW_DAYS = '7';
  process.env.GHN_SHOP_ID = '76543';
  process.env.GHN_WEBHOOK_SECRET = 'receipt-safe-test-secret';

  const pool = require('../../config/db');
  const [[database]] = await pool.query('SELECT DATABASE() name');
  console.log(`[delivery-receipt-safe.test.js] SELECT DATABASE(): ${database.name}`);
  assert.equal(database.name, testDatabase);

  const { app } = require('../../server');
  let server;
  try {
    server = app.listen(0);
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const api = async (path, { method = 'GET', body, token } = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, json: await response.json() };
    };
    const createUser = async (name) => {
      const email = `receipt-safe-${crypto.randomUUID()}@example.invalid`;
      const [result] = await pool.execute("INSERT INTO users (full_name,email,password_hash,role,status) VALUES (?,?,?,'USER','ACTIVE')", [name, email, 'test-only-no-login']);
      const token = jwt.sign({}, process.env.JWT_SECRET, {
        algorithm: 'HS256', subject: String(result.insertId), expiresIn: '5m',
        issuer: 'giftly-api', audience: 'giftly-client',
      });
      return { id: String(result.insertId), token };
    };
    const createDeliveredOrder = async (userId, ageDays) => {
      const orderCode = `RCP${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
      const [result] = await pool.execute(`INSERT INTO orders
        (order_code,user_id,status,payment_method,payment_status,recipient_name,phone,shipping_address,
         subtotal,discount_amount,shipping_fee,total_amount,delivered_at)
        VALUES (?,?,'DELIVERED','COD','PAID','Receipt User','0900000000',?,100000,0,0,100000,DATE_SUB(NOW(),INTERVAL ? DAY))`,
      [orderCode, userId, JSON.stringify({ addressLine: 'Test Road', ward: 'Test Ward', district: 'Test District', city: 'Test City' }), ageDays]);
      return { id: String(result.insertId), orderCode };
    };
    const createProcessingOrder = async (userId) => {
      const orderCode = `RCP${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
      const [result] = await pool.execute(`INSERT INTO orders
        (order_code,user_id,status,payment_method,payment_status,recipient_name,phone,shipping_address,
         subtotal,discount_amount,shipping_fee,total_amount)
        VALUES (?,?,'PROCESSING','COD','UNPAID','Receipt User','0900000000',?,100000,0,0,100000)`,
      [orderCode, userId, JSON.stringify({ addressLine: 'Test Road', ward: 'Test Ward', district: 'Test District', city: 'Test City' })]);
      return { id: String(result.insertId), orderCode };
    };

    const owner = await createUser('Receipt Owner');
    const other = await createUser('Receipt Other');
    const confirmOrder = await createDeliveredOrder(owner.id, 1);
    const agedOrder = await createDeliveredOrder(owner.id, 8);
    const returnOrder = await createDeliveredOrder(owner.id, 2);
    const expiredReturnOrder = await createDeliveredOrder(owner.id, 8);
    const processingOrder = await createProcessingOrder(owner.id);

    await t.test('owner confirms received once; repeat keeps the original timestamp and order status', async () => {
      const first = await api(`/orders/${confirmOrder.id}/confirm-received`, { method: 'POST', token: owner.token });
      assert.equal(first.status, 200);
      assert.equal(first.json.data.automaticallyConfirmed, false);
      const [[savedFirst]] = await pool.execute('SELECT status,received_confirmed_at FROM orders WHERE id=?', [confirmOrder.id]);
      assert.equal(savedFirst.status, 'DELIVERED');
      assert.ok(savedFirst.received_confirmed_at);
      const second = await api(`/orders/${confirmOrder.id}/confirm-received`, { method: 'POST', token: owner.token });
      assert.equal(second.status, 200);
      assert.equal(second.json.data.alreadyConfirmed, true);
      const [[savedSecond]] = await pool.execute('SELECT status,received_confirmed_at FROM orders WHERE id=?', [confirmOrder.id]);
      assert.equal(savedSecond.status, 'DELIVERED');
      assert.equal(new Date(savedSecond.received_confirmed_at).getTime(), new Date(savedFirst.received_confirmed_at).getTime());
    });

    await t.test('a different customer cannot confirm the order', async () => {
      const response = await api(`/orders/${confirmOrder.id}/confirm-received`, { method: 'POST', token: other.token });
      assert.equal(response.status, 404);
    });

    await t.test('customer cannot confirm receipt before delivery', async () => {
      const response = await api(`/orders/${processingOrder.id}/confirm-received`, { method: 'POST', token: owner.token });
      assert.equal(response.status, 409);
      const [[saved]] = await pool.execute('SELECT status,received_confirmed_at FROM orders WHERE id=?', [processingOrder.id]);
      assert.equal(saved.status, 'PROCESSING');
      assert.equal(saved.received_confirmed_at, null);
    });

    await t.test('after RETURN_WINDOW_DAYS the order reads as automatically received without writing a confirmation', async () => {
      const response = await api(`/orders/${agedOrder.id}`, { token: owner.token });
      assert.equal(response.status, 200);
      assert.equal(response.json.data.status, 'DELIVERED');
      assert.equal(response.json.data.canConfirmReceived, false);
      assert.equal(response.json.data.returnWindowOpen, false);
      assert.equal(response.json.data.receivedConfirmedAt, null);
      assert.ok(response.json.data.receivedAt);
      const [[saved]] = await pool.execute('SELECT status,received_confirmed_at FROM orders WHERE id=?', [agedOrder.id]);
      assert.equal(saved.status, 'DELIVERED');
      assert.equal(saved.received_confirmed_at, null);
    });

    await t.test('return request is accepted inside the delivered_at window and rejected after it', async () => {
      const accepted = await api(`/orders/${returnOrder.id}/returns`, { method: 'POST', token: owner.token, body: { reason: 'Damaged packaging' } });
      assert.equal(accepted.status, 201, JSON.stringify(accepted.json));
      const rejected = await api(`/orders/${expiredReturnOrder.id}/returns`, { method: 'POST', token: owner.token, body: { reason: 'Late request' } });
      assert.equal(rejected.status, 409, JSON.stringify(rejected.json));
      const [[saved]] = await pool.execute('SELECT COUNT(*) total FROM return_requests WHERE order_id=?', [expiredReturnOrder.id]);
      assert.equal(Number(saved.total), 0);
    });

    await t.test('repeated GHN DELIVERED webhook does not move delivered_at', async () => {
      const orderCode = `RCPGHN${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
      const [result] = await pool.execute(`INSERT INTO orders
        (order_code,user_id,status,payment_method,payment_status,recipient_name,phone,shipping_address,
         subtotal,discount_amount,shipping_fee,total_amount)
        VALUES (?,?,'PROCESSING','COD','UNPAID','Receipt User','0900000000',?,100000,0,0,100000)`,
      [orderCode, owner.id, JSON.stringify({ addressLine: 'Test Road', ward: 'Test Ward', district: 'Test District', city: 'Test City' })]);
      const orderId = String(result.insertId);
      await pool.execute("INSERT INTO shipments (order_id,client_order_code,provider,provider_order_code,status) VALUES (?,?,'GHN',?,'CREATED')", [orderId, orderCode, `GHN-${orderCode}`]);
      const headers = { 'x-giftly-shipping-secret': process.env.GHN_WEBHOOK_SECRET };
      const webhook = async (time) => {
        const response = await fetch(`${baseUrl}/shipments/ghn/webhook`, {
          method: 'POST', headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ OrderCode: `GHN-${orderCode}`, ClientOrderCode: orderCode, ShopID: process.env.GHN_SHOP_ID, Type: 'switch_status', Status: 'delivered', Time: time }),
        });
        assert.equal(response.status, 200, await response.text());
      };
      await webhook('2026-11-11T10:00:00.000Z');
      const [[first]] = await pool.execute('SELECT status,delivered_at,payment_status FROM orders WHERE id=?', [orderId]);
      assert.equal(first.status, 'DELIVERED');
      assert.equal(first.payment_status, 'PAID');
      assert.ok(first.delivered_at);
      await webhook('2026-11-11T10:01:00.000Z');
      const [[second]] = await pool.execute('SELECT status,delivered_at,payment_status FROM orders WHERE id=?', [orderId]);
      assert.equal(second.status, 'DELIVERED');
      assert.equal(second.payment_status, 'PAID');
      assert.equal(new Date(second.delivered_at).getTime(), new Date(first.delivered_at).getTime());
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
