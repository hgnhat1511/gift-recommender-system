'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const testDatabase = (process.env.TEST_DB_NAME || process.env.DB_NAME || '').trim();

test('VNPAY attempts, IPN races, late callbacks, and unpaid admin guards without resetting test data', {
  skip: !testDatabase ? 'Set TEST_DB_NAME to an isolated _test database.' : false,
}, async (t) => {
  assert.match(testDatabase, /^giftly_[a-z0-9_]*_test$/i);
  assert.notEqual(testDatabase, 'giftly_verification_test');
  process.env.TEST_DB_NAME = testDatabase;
  process.env.DB_NAME = testDatabase;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('base64url');
  process.env.VNPAY_TMN_CODE = 'GIFTLYTEST';
  process.env.VNPAY_HASH_SECRET = 'giftly-safe-payment-test-secret';
  process.env.VNPAY_RETURN_URL = 'http://127.0.0.1/api/payments/vnpay/return';
  process.env.VNPAY_PAYMENT_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';

  const pool = require('../../config/db');
  const [[database]] = await pool.query('SELECT DATABASE() name');
  console.log(`[payment-flow-safe.test.js] SELECT DATABASE(): ${database.name}`);
  assert.equal(database.name, testDatabase);

  const { app } = require('../../server');
  const vnpay = require('../../services/payments/vnpay');
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
    const createUser = async (name, role = 'USER') => {
      const email = `payment-safe-${crypto.randomUUID()}@example.invalid`;
      const [result] = await pool.execute('INSERT INTO users (full_name,email,password_hash,role,status) VALUES (?,?,?,? ,\'ACTIVE\')', [name, email, 'test-only-no-login', role]);
      const token = jwt.sign({}, process.env.JWT_SECRET, {
        algorithm: 'HS256', subject: String(result.insertId), expiresIn: '5m',
        issuer: 'giftly-api', audience: 'giftly-client',
      });
      return { id: String(result.insertId), token };
    };
    const createVnpayOrder = async (userId, status = 'PENDING') => {
      const orderCode = `PAY${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
      const [result] = await pool.execute(`INSERT INTO orders
        (order_code,user_id,status,payment_method,payment_status,recipient_name,phone,shipping_address,
         subtotal,discount_amount,shipping_fee,total_amount)
        VALUES (?,?,?,'VNPAY','UNPAID','Payment User','0900000000',?,159000,0,0,159000)`,
      [orderCode, userId, status, JSON.stringify({ addressLine: 'Test Road', ward: 'Test Ward', district: 'Test District', city: 'Test City' })]);
      return { id: String(result.insertId), orderCode };
    };
    const makeIpnFields = (reference, transactionNo) => {
      const fields = {
        vnp_TmnCode: process.env.VNPAY_TMN_CODE,
        vnp_TxnRef: reference,
        vnp_Amount: '15900000',
        vnp_CurrCode: 'VND',
        vnp_ResponseCode: '00',
        vnp_TransactionStatus: '00',
        vnp_TransactionNo: transactionNo,
      };
      fields.vnp_SecureHash = vnpay.sign(fields, process.env.VNPAY_HASH_SECRET);
      return fields;
    };
    const sendIpn = async (fields) => {
      const response = await fetch(`${baseUrl}/payments/vnpay/ipn?${new URLSearchParams(fields)}`);
      return { status: response.status, json: await response.json() };
    };

    const owner = await createUser('Payment Owner');
    const admin = await createUser('Payment Admin', 'ADMIN');
    const paidOrder = await createVnpayOrder(owner.id);
    const cancelledOrder = await createVnpayOrder(owner.id);
    const guardedOrder = await createVnpayOrder(owner.id);

    await t.test('an unpaid VNPAY order exists before checkout; parallel successful IPNs settle it once', async () => {
      const [[before]] = await pool.execute('SELECT status,payment_status,payment_method FROM orders WHERE id=?', [paidOrder.id]);
      assert.deepEqual([before.status, before.payment_status, before.payment_method], ['PENDING', 'UNPAID', 'VNPAY']);
      const start = await api(`/payments/orders/${paidOrder.id}/vnpay`, { method: 'POST', token: owner.token });
      assert.equal(start.status, 200, JSON.stringify(start.json));
      assert.match(start.json.data.paymentUrl, /^https:\/\/sandbox\.vnpayment\.vn\//);
      const reference = start.json.data.reference;
      const [[attempt]] = await pool.execute('SELECT status FROM payment_attempts WHERE reference=?', [reference]);
      assert.equal(attempt.status, 'PENDING');

      const fields = makeIpnFields(reference, '741258963');
      const replies = await Promise.all([sendIpn(fields), sendIpn(fields)]);
      assert.ok(replies.every((reply) => reply.status === 200));
      assert.deepEqual(replies.map((reply) => reply.json.RspCode).sort(), ['00', '02']);
      const [[settled]] = await pool.execute(`SELECT o.status,o.payment_status,a.status attempt_status
        FROM orders o JOIN payment_attempts a ON a.order_id=o.id WHERE o.id=?`, [paidOrder.id]);
      assert.deepEqual([settled.status, settled.payment_status, settled.attempt_status], ['PENDING', 'PAID', 'SUCCEEDED']);
      const [[noticeCount]] = await pool.execute("SELECT COUNT(*) total FROM notifications WHERE order_id=? AND type='PAYMENT'", [paidOrder.id]);
      assert.equal(Number(noticeCount.total), 1);
    });

    await t.test('cancelling expires the attempt; a successful late IPN is marked REVIEW', async () => {
      const start = await api(`/payments/orders/${cancelledOrder.id}/vnpay`, { method: 'POST', token: owner.token });
      assert.equal(start.status, 200, JSON.stringify(start.json));
      const reference = start.json.data.reference;
      const cancel = await api(`/orders/${cancelledOrder.id}/cancel`, { method: 'POST', token: owner.token });
      assert.equal(cancel.status, 200, JSON.stringify(cancel.json));
      const [[afterCancel]] = await pool.execute('SELECT o.status,a.status attempt_status FROM orders o JOIN payment_attempts a ON a.order_id=o.id WHERE o.id=?', [cancelledOrder.id]);
      assert.deepEqual([afterCancel.status, afterCancel.attempt_status], ['CANCELLED', 'EXPIRED']);

      const lateReply = await sendIpn(makeIpnFields(reference, '741258964'));
      assert.equal(lateReply.status, 200);
      assert.equal(lateReply.json.RspCode, '00');
      const [[afterLateIpn]] = await pool.execute('SELECT o.status,o.payment_status,a.status attempt_status FROM orders o JOIN payment_attempts a ON a.order_id=o.id WHERE o.id=?', [cancelledOrder.id]);
      assert.deepEqual([afterLateIpn.status, afterLateIpn.payment_status, afterLateIpn.attempt_status], ['CANCELLED', 'UNPAID', 'REVIEW']);
    });

    await t.test('admin cannot confirm an unpaid VNPAY order', async () => {
      const confirmed = await api(`/admin/orders/${guardedOrder.id}/status`, { method: 'PATCH', token: admin.token, body: { status: 'CONFIRMED' } });
      assert.equal(confirmed.status, 409);
      const [[after]] = await pool.execute('SELECT status,payment_status FROM orders WHERE id=?', [guardedOrder.id]);
      assert.deepEqual([after.status, after.payment_status], ['PENDING', 'UNPAID']);
      await pool.execute("UPDATE orders SET status='CONFIRMED' WHERE id=?", [guardedOrder.id]);
      const processing = await api(`/admin/orders/${guardedOrder.id}/status`, { method: 'PATCH', token: admin.token, body: { status: 'PROCESSING' } });
      assert.equal(processing.status, 409);
      const [[stillUnpaid]] = await pool.execute('SELECT status,payment_status FROM orders WHERE id=?', [guardedOrder.id]);
      assert.deepEqual([stillUnpaid.status, stillUnpaid.payment_status], ['CONFIRMED', 'UNPAID']);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
