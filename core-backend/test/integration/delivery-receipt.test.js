'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const testDatabase = (process.env.TEST_DB_NAME || process.env.DB_NAME || '').trim();

test('Delivery receipt confirmation and GHN delivery timestamps', {
  skip: !testDatabase ? 'Set TEST_DB_NAME to an isolated _test database.' : false,
}, async (t) => {
  assert.match(testDatabase, /^giftly_[a-z0-9_]*_test$/i);
  assert.notEqual(testDatabase, 'giftly_verification_test');
  process.env.TEST_DB_NAME = testDatabase;
  process.env.DB_NAME = testDatabase;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('base64url');
  process.env.ML_SERVICE_URL = '';
  process.env.GHN_SHOP_ID = '45678';
  process.env.GHN_WEBHOOK_SECRET = 'delivery-receipt-test-secret';

  const { resetTestDatabase } = require('../../scripts/resetTestDb');
  await resetTestDatabase(testDatabase, { seed: true });
  const pool = require('../../config/db');
  const { app } = require('../../server');
  let server;

  try {
    const [[database]] = await pool.query('SELECT DATABASE() name');
    console.log(`[delivery-receipt.test.js] SELECT DATABASE(): ${database.name}`);
    assert.equal(database.name, testDatabase);
    server = app.listen(0);
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const api = async (path, { method = 'GET', body, auth, headers = {}, expected = 200 } = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await response.json();
      assert.equal(response.status, expected, JSON.stringify(json));
      return json;
    };
    const register = async (name) => {
      const emailName = name.toLowerCase().replace(/\s+/g, '-');
      const email = `${emailName}-${crypto.randomUUID()}@example.invalid`;
      await api('/auth/register', { method: 'POST', expected: 201, body: { fullName: name, email, password: 'Password-2026!' } });
      const login = await api('/auth/login', { method: 'POST', body: { email, password: 'Password-2026!' } });
      return { id: login.data.user.id, token: login.data.token };
    };
    const owner = await register('Receipt Owner');
    const other = await register('Other Customer');
    const addressResponse = await api('/account/addresses', {
      method: 'POST', auth: owner.token, expected: 201,
      body: { recipientName: 'Receipt Owner', phone: '0901234567', addressLine: '1 Test Street', ward: 'Test Ward', district: 'Test District', city: 'Test City' },
    });
    const addressId = addressResponse.data.id;
    const [[product]] = await pool.query("SELECT p.id FROM products p WHERE p.status='ACTIVE' AND p.stock>0 AND COALESCE(p.is_synthetic_display,FALSE)=FALSE ORDER BY p.id LIMIT 1");
    assert.ok(product, 'test seed must include an in-stock real product');

    const createCodOrder = async () => {
      await api('/cart/items', { method: 'POST', auth: owner.token, expected: 201, body: { productId: String(product.id), quantity: 1 } });
      const result = await api('/orders', { method: 'POST', auth: owner.token, expected: 201, body: { addressId, paymentMethod: 'COD', shippingMethod: 'STANDARD' } });
      return result.data.orderId;
    };
    const markDeliveredForReceiptTest = async (orderId, ageDays = 0) => {
      await pool.execute(`UPDATE orders SET status='DELIVERED',payment_status='PAID',delivered_at=NOW()-INTERVAL ${ageDays} DAY WHERE id=?`, [orderId]);
    };

    await t.test('khách xác nhận nhận hàng ghi received_confirmed_at, không thêm trạng thái đơn', async () => {
      const orderId = await createCodOrder();
      await markDeliveredForReceiptTest(orderId, 1);
      const result = await api(`/orders/${orderId}/confirm-received`, { method: 'POST', auth: owner.token });
      assert.equal(result.data.automaticallyConfirmed, false);
      const [[saved]] = await pool.query('SELECT status,received_confirmed_at FROM orders WHERE id=?', [orderId]);
      assert.equal(saved.status, 'DELIVERED');
      assert.ok(saved.received_confirmed_at);
    });

    await t.test('khách khác không xác nhận được đơn không thuộc về mình', async () => {
      const orderId = await createCodOrder();
      await markDeliveredForReceiptTest(orderId, 1);
      await api(`/orders/${orderId}/confirm-received`, { method: 'POST', auth: other.token, expected: 404 });
      const [[saved]] = await pool.query('SELECT received_confirmed_at FROM orders WHERE id=?', [orderId]);
      assert.equal(saved.received_confirmed_at, null);
    });

    await t.test('quá hạn 7 ngày tự coi là đã nhận khi đọc, không ghi trạng thái mới', async () => {
      const orderId = await createCodOrder();
      await markDeliveredForReceiptTest(orderId, 8);
      const result = await api(`/orders/${orderId}`, { auth: owner.token });
      assert.equal(result.data.status, 'DELIVERED');
      assert.equal(result.data.canConfirmReceived, false);
      assert.equal(result.data.returnWindowOpen, false);
      assert.ok(result.data.receivedAt);
      assert.equal(result.data.receivedConfirmedAt, null);
      const [[saved]] = await pool.query('SELECT status,received_confirmed_at FROM orders WHERE id=?', [orderId]);
      assert.equal(saved.status, 'DELIVERED');
      assert.equal(saved.received_confirmed_at, null);
    });

    await t.test('webhook GHN lặp lại trạng thái DELIVERED không ghi đè delivered_at', async () => {
      const orderId = await createCodOrder();
      const [[order]] = await pool.query('SELECT order_code FROM orders WHERE id=?', [orderId]);
      await pool.execute("INSERT INTO shipments (order_id,client_order_code,provider,provider_order_code,status) VALUES (?,?,'GHN','GHN-RECEIPT-TEST','CREATED')", [orderId, order.order_code]);
      const postDelivered = (time) => api('/shipments/ghn/webhook', {
        method: 'POST', expected: 200,
        headers: { 'x-giftly-shipping-secret': process.env.GHN_WEBHOOK_SECRET },
        body: { OrderCode: 'GHN-RECEIPT-TEST', ClientOrderCode: order.order_code, ShopID: process.env.GHN_SHOP_ID, Type: 'switch_status', Status: 'delivered', Time: time },
      });
      await postDelivered('2026-11-10T10:00:00.000Z');
      const [[first]] = await pool.query('SELECT status,delivered_at FROM orders WHERE id=?', [orderId]);
      assert.equal(first.status, 'DELIVERED');
      assert.ok(first.delivered_at);
      await postDelivered('2026-11-10T10:01:00.000Z');
      const [[second]] = await pool.query('SELECT status,delivered_at FROM orders WHERE id=?', [orderId]);
      assert.equal(second.status, 'DELIVERED');
      assert.equal(new Date(second.delivered_at).getTime(), new Date(first.delivered_at).getTime());
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
