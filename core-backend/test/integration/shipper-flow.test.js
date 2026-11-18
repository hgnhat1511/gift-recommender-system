'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const testDatabase = (process.env.TEST_DB_NAME || process.env.DB_NAME || '').trim();

test('Internal shipper assignment, isolation, lifecycle, and GHN source separation', {
  skip: !testDatabase ? 'Set TEST_DB_NAME to an isolated _test database.' : false,
}, async (t) => {
  assert.match(testDatabase, /^giftly_[a-z0-9_]*_test$/i);
  assert.notEqual(testDatabase, 'giftly_verification_test');
  process.env.TEST_DB_NAME = testDatabase;
  process.env.DB_NAME = testDatabase;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('base64url');
  process.env.GHN_SHOP_ID = '98765';
  process.env.GHN_WEBHOOK_SECRET = 'shipper-flow-test-secret';
  process.env.PRIVATE_UPLOAD_DIR = path.join(__dirname, '..', '..', 'private_uploads', 'shipper-flow-test');

  const pool = require('../../config/db');
  const [[database]] = await pool.query('SELECT DATABASE() name');
  console.log(`[shipper-flow.test.js] SELECT DATABASE(): ${database.name}`);
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
    const api = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, json: await response.json() };
    };
    const rawApi = async (path, { method = 'POST', body, contentType, token, headers = {} } = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { ...(contentType ? { 'content-type': contentType } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        body,
      });
      return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
    };
    const createUser = async (role) => {
      const email = `shipper-flow-${role.toLowerCase()}-${crypto.randomUUID()}@example.invalid`;
      const [result] = await pool.execute(
        'INSERT INTO users (full_name,email,password_hash,role,status) VALUES (?,?,?,? ,\'ACTIVE\')',
        [`Ship Test ${role}`, email, 'test-only-no-login', role],
      );
      const token = jwt.sign({}, process.env.JWT_SECRET, {
        algorithm: 'HS256', subject: String(result.insertId), expiresIn: '5m',
        issuer: 'giftly-api', audience: 'giftly-client',
      });
      return { id: String(result.insertId), token };
    };
    const createProcessingOrder = async (ownerId) => {
      const orderCode = `SHP${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
      const [result] = await pool.execute(`INSERT INTO orders
        (order_code,user_id,status,payment_method,payment_status,recipient_name,phone,shipping_address,
         subtotal,discount_amount,shipping_fee,total_amount)
        VALUES (?,?,'PROCESSING','COD','UNPAID','Test Receiver','0900000000',?,100000,0,0,100000)`,
      [orderCode, ownerId, JSON.stringify({ addressLine: 'Test Road', ward: 'Test Ward', district: 'Test District', city: 'Test City' })]);
      return { id: String(result.insertId), orderCode };
    };

    const admin = await createUser('ADMIN');
    const shipperA = await createUser('SHIPPER');
    const shipperB = await createUser('SHIPPER');
    const customer = await createUser('USER');
    const orderA = await createProcessingOrder(customer.id);
    const orderB = await createProcessingOrder(customer.id);

    await t.test('admin cannot set SHIPPED/DELIVERED manually and shipper cannot use admin APIs', async () => {
      const shipped = await api(`/admin/orders/${orderA.id}/status`, { method: 'PATCH', token: admin.token, body: { status: 'SHIPPED' } });
      const delivered = await api(`/admin/orders/${orderA.id}/status`, { method: 'PATCH', token: admin.token, body: { status: 'DELIVERED' } });
      const adminList = await api('/admin/orders', { token: shipperA.token });
      const shippers = await api('/admin/shippers', { token: admin.token });
      assert.equal(shipped.status, 409);
      assert.equal(delivered.status, 409);
      assert.equal(adminList.status, 403);
      assert.equal(shippers.status, 200);
      assert.ok(shippers.json.data.some((user) => user.id === shipperA.id));
    });

    await t.test('shippers see internal orders and can move INTERNAL order through delivery', async () => {
      const assigned = await api(`/admin/orders/${orderA.id}/shipper`, { method: 'POST', token: admin.token, body: { shipperUserId: shipperA.id } });
      assert.equal(assigned.status, 201, JSON.stringify(assigned.json));
      assert.equal(assigned.json.data.provider, 'INTERNAL');

      const listA = await api('/shipper/orders', { token: shipperA.token });
      const listB = await api('/shipper/orders', { token: shipperB.token });
      const listUser = await api('/shipper/orders', { token: customer.token });
      assert.equal(listA.status, 200);
      assert.equal(listB.status, 200);
      assert.equal(listUser.status, 403);
      assert.ok(listA.json.data.some((order) => order.id === orderA.id));
      assert.ok(listB.json.data.some((order) => order.id === orderA.id));

      const unauthorizedDispatch = await api(`/shipper/orders/${orderA.id}/dispatch`, { method: 'POST', token: customer.token });
      assert.equal(unauthorizedDispatch.status, 403);
      const ownerOnly = await api(`/orders/${orderA.id}`, { token: shipperA.token });
      assert.equal(ownerOnly.status, 404);
      const lockAssignedShipper = await api(`/admin/customers/${shipperA.id}/status`, { method: 'PATCH', token: admin.token, body: { status: 'LOCKED' } });
      const demoteAssignedShipper = await api(`/admin/customers/${shipperA.id}/role`, { method: 'PATCH', token: admin.token, body: { role: 'USER' } });
      assert.equal(lockAssignedShipper.status, 409);
      assert.equal(demoteAssignedShipper.status, 409);

      const dispatch = await api(`/shipper/orders/${orderA.id}/dispatch`, { method: 'POST', token: shipperA.token });
      assert.equal(dispatch.status, 200, JSON.stringify(dispatch.json));
      assert.equal(dispatch.json.data.status, 'SHIPPED');

      const wrongType = await rawApi(`/shipper/orders/${orderA.id}/proof`, { body: Buffer.from('not an image'), contentType: 'image/png', token: shipperA.token });
      assert.equal(wrongType.status, 415);
      const tooLarge = await rawApi(`/shipper/orders/${orderA.id}/proof`, { body: Buffer.alloc(3 * 1024 * 1024 + 1), contentType: 'image/png', token: shipperA.token });
      assert.equal(tooLarge.status, 413);
      const deniedUpload = await rawApi(`/shipper/orders/${orderA.id}/proof`, { body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64'), contentType: 'image/png', token: customer.token });
      assert.equal(deniedUpload.status, 403);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64');
      const uploaded = await rawApi(`/shipper/orders/${orderA.id}/proof`, {
        body: png, contentType: 'image/png', token: shipperA.token,
        headers: { 'content-disposition': 'attachment; filename="../../outside.png"' },
      });
      assert.equal(uploaded.status, 201, uploaded.body.toString());
      const [[proof]] = await pool.execute('SELECT file_name,mime_type,sha256,uploaded_by FROM delivery_proofs WHERE order_id=?', [orderA.id]);
      assert.match(proof.file_name, /^[a-f0-9-]{36}\.png$/i, 'Stored proof names must be random UUID filenames, not client paths.');
      assert.equal(proof.mime_type, 'image/png');
      assert.equal(proof.sha256, crypto.createHash('sha256').update(png).digest('hex'));
      assert.equal(String(proof.uploaded_by), shipperA.id);
      const [[stillShipped]] = await pool.execute('SELECT status FROM orders WHERE id=?', [orderA.id]);
      assert.equal(stillShipped.status, 'SHIPPED');
      const ownerProof = await rawApi(`/delivery-proofs/${orderA.id}`, { method: 'GET', token: customer.token });
      const adminProof = await rawApi(`/delivery-proofs/${orderA.id}`, { method: 'GET', token: admin.token });
      const shipperProof = await rawApi(`/delivery-proofs/${orderA.id}`, { method: 'GET', token: shipperA.token });
      const otherProof = await rawApi(`/delivery-proofs/${orderA.id}`, { method: 'GET', token: shipperB.token });
      assert.equal(ownerProof.status, 200);
      assert.equal(adminProof.status, 200);
      assert.equal(shipperProof.status, 200);
      assert.equal(otherProof.status, 200);
      assert.equal(ownerProof.headers.get('cache-control'), 'private, no-store');
      assert.equal(ownerProof.headers.get('x-content-type-options'), 'nosniff');

      await pool.execute('UPDATE delivery_proofs SET file_name=? WHERE order_id=?', ['../outside.png', orderA.id]);
      const pathTraversalRead = await rawApi(`/delivery-proofs/${orderA.id}`, { method: 'GET', token: customer.token });
      await pool.execute('UPDATE delivery_proofs SET file_name=? WHERE order_id=?', [proof.file_name, orderA.id]);
      assert.equal(pathTraversalRead.status, 404, 'Stored path traversal filenames must not be served.');

      const deliver = await api(`/shipper/orders/${orderA.id}/deliver`, { method: 'POST', token: shipperA.token });
      assert.equal(deliver.status, 200, JSON.stringify(deliver.json));
      assert.equal(deliver.json.data.status, 'DELIVERED');

      const [[saved]] = await pool.execute('SELECT status,payment_status,delivered_at FROM orders WHERE id=?', [orderA.id]);
      assert.equal(saved.status, 'DELIVERED');
      assert.equal(saved.payment_status, 'PAID');
      assert.ok(saved.delivered_at);
      const [history] = await pool.execute('SELECT from_status,to_status,source,changed_by,created_at FROM order_status_history WHERE order_id=? ORDER BY id', [orderA.id]);
      assert.deepEqual(history.map((row) => [row.from_status, row.to_status, row.source]), [
        ['PROCESSING', 'SHIPPED', 'INTERNAL'], ['SHIPPED', 'DELIVERED', 'INTERNAL'],
      ]);
      assert.ok(history.every((row) => String(row.changed_by) === shipperA.id));
      assert.ok(history.every((row) => row.created_at));
    });

    await t.test('GHN webhook does not transition an INTERNAL order', async () => {
      const assigned = await api(`/admin/orders/${orderB.id}/shipper`, { method: 'POST', token: admin.token, body: { shipperUserId: shipperA.id } });
      assert.equal(assigned.status, 201, JSON.stringify(assigned.json));
      const event = {
        OrderCode: `GHN-${orderB.orderCode}`, ClientOrderCode: orderB.orderCode,
        ShopID: process.env.GHN_SHOP_ID, Status: 'delivering', Type: 'switch_status', Time: new Date().toISOString(),
      };
      const webhook = await api('/shipments/ghn/webhook', {
        method: 'POST', body: event, headers: { 'x-giftly-shipping-secret': process.env.GHN_WEBHOOK_SECRET },
      });
      assert.equal(webhook.status, 200);
      const [[saved]] = await pool.execute('SELECT status FROM orders WHERE id=?', [orderB.id]);
      assert.equal(saved.status, 'PROCESSING');
    });

    await t.test('GHN order is not claimable by shipper and advances only from GHN webhook', async () => {
      const ghnOrder = await createProcessingOrder(customer.id);
      await pool.execute("INSERT INTO shipments (order_id,client_order_code,provider,provider_order_code,status) VALUES (?,?,'GHN',?,'CREATED')",
        [ghnOrder.id, ghnOrder.orderCode, `GHN-${ghnOrder.orderCode}`]);
      const assignment = await api(`/admin/orders/${ghnOrder.id}/shipper`, { method: 'POST', token: admin.token, body: { shipperUserId: shipperA.id } });
      assert.equal(assignment.status, 409);
      const shipperAction = await api(`/shipper/orders/${ghnOrder.id}/dispatch`, { method: 'POST', token: shipperA.token });
      assert.equal(shipperAction.status, 403);

      const invalidSignature = await api('/shipments/ghn/webhook', {
        method: 'POST',
        body: {
          OrderCode: `GHN-${ghnOrder.orderCode}`, ClientOrderCode: ghnOrder.orderCode,
          ShopID: process.env.GHN_SHOP_ID, Status: 'delivering', Type: 'switch_status', Time: new Date().toISOString(),
        },
        headers: { 'x-giftly-shipping-secret': 'invalid-ghn-signature' },
      });
      assert.equal(invalidSignature.status, 401);
      const [[afterInvalidSignature]] = await pool.execute('SELECT status FROM orders WHERE id=?', [ghnOrder.id]);
      assert.equal(afterInvalidSignature.status, 'PROCESSING');

      for (const [status, expectedOrderStatus, offset] of [['delivering', 'SHIPPED', 1], ['delivered', 'DELIVERED', 2]]) {
        const event = {
          OrderCode: `GHN-${ghnOrder.orderCode}`, ClientOrderCode: ghnOrder.orderCode,
          ShopID: process.env.GHN_SHOP_ID, Status: status, Type: 'switch_status',
          Time: new Date(Date.now() + offset * 1000).toISOString(),
        };
        const webhook = await api('/shipments/ghn/webhook', {
          method: 'POST', body: event, headers: { 'x-giftly-shipping-secret': process.env.GHN_WEBHOOK_SECRET },
        });
        assert.equal(webhook.status, 200);
        const [[saved]] = await pool.execute('SELECT status,payment_status,delivered_at FROM orders WHERE id=?', [ghnOrder.id]);
        assert.equal(saved.status, expectedOrderStatus);
        if (expectedOrderStatus === 'DELIVERED') {
          assert.equal(saved.payment_status, 'PAID');
          assert.ok(saved.delivered_at);
        }
      }
      const [history] = await pool.execute('SELECT from_status,to_status,source,created_at FROM order_status_history WHERE order_id=? ORDER BY id', [ghnOrder.id]);
      assert.deepEqual(history.map((row) => [row.from_status, row.to_status, row.source]), [
        ['PROCESSING', 'SHIPPED', 'GHN'], ['SHIPPED', 'DELIVERED', 'GHN'],
      ]);
      assert.ok(history.every((row) => row.created_at));
    });

    await t.test('all active shippers see internal orders and a locked account loses access with its existing JWT', async () => {
      const assignedOrder = await createProcessingOrder(customer.id);
      const unassignedOrder = await createProcessingOrder(customer.id);
      const assignToB = await api(`/admin/orders/${assignedOrder.id}/shipper`, {
        method: 'POST', token: admin.token, body: { shipperUserId: shipperB.id },
      });
      assert.equal(assignToB.status, 201, JSON.stringify(assignToB.json));

      const listA = await api('/shipper/orders', { token: shipperA.token });
      const listB = await api('/shipper/orders', { token: shipperB.token });
      assert.ok(listA.json.data.some((order) => order.id === assignedOrder.id));
      assert.ok(listB.json.data.some((order) => order.id === assignedOrder.id));
      assert.ok(listA.json.data.some((order) => order.id === unassignedOrder.id));
      assert.ok(listB.json.data.some((order) => order.id === unassignedOrder.id));

      const lockedShipper = await createUser('SHIPPER');
      const lock = await api(`/admin/customers/${lockedShipper.id}/status`, {
        method: 'PATCH', token: admin.token, body: { status: 'LOCKED' },
      });
      assert.equal(lock.status, 200, JSON.stringify(lock.json));
      const oldTokenRequest = await api('/shipper/orders', { token: lockedShipper.token });
      assert.equal(oldTokenRequest.status, 401);
    });

    await t.test('internal delivery rejects invalid order steps and changing source after dispatch', async () => {
      const order = await createProcessingOrder(customer.id);
      const assigned = await api(`/admin/orders/${order.id}/shipper`, {
        method: 'POST', token: admin.token, body: { shipperUserId: shipperA.id },
      });
      assert.equal(assigned.status, 201, JSON.stringify(assigned.json));

      const deliverBeforeDispatch = await api(`/shipper/orders/${order.id}/deliver`, { method: 'POST', token: shipperA.token });
      assert.equal(deliverBeforeDispatch.status, 409);
      const [[stillProcessing]] = await pool.execute('SELECT status FROM orders WHERE id=?', [order.id]);
      assert.equal(stillProcessing.status, 'PROCESSING');

      const dispatch = await api(`/shipper/orders/${order.id}/dispatch`, { method: 'POST', token: shipperA.token });
      assert.equal(dispatch.status, 200);
      const reassignAfterDispatch = await api(`/admin/orders/${order.id}/shipper`, {
        method: 'POST', token: admin.token, body: { shipperUserId: shipperB.id },
      });
      assert.equal(reassignAfterDispatch.status, 409);
      const [[unchangedSource]] = await pool.execute('SELECT status,shipper_user_id FROM orders WHERE id=?', [order.id]);
      assert.equal(unchangedSource.status, 'SHIPPED');
      assert.equal(String(unchangedSource.shipper_user_id), shipperA.id);
    });

    await t.test('simultaneous and repeated internal delivery records one DELIVERED transition and one timestamp', async () => {
      const order = await createProcessingOrder(customer.id);
      const assigned = await api(`/admin/orders/${order.id}/shipper`, {
        method: 'POST', token: admin.token, body: { shipperUserId: shipperB.id },
      });
      assert.equal(assigned.status, 201, JSON.stringify(assigned.json));
      const dispatch = await api(`/shipper/orders/${order.id}/dispatch`, { method: 'POST', token: shipperB.token });
      assert.equal(dispatch.status, 200);

      const responses = await Promise.all([
        api(`/shipper/orders/${order.id}/deliver`, { method: 'POST', token: shipperB.token }),
        api(`/shipper/orders/${order.id}/deliver`, { method: 'POST', token: shipperB.token }),
      ]);
      assert.ok(responses.every((response) => response.status === 200));
      assert.equal(responses.filter((response) => response.json.data.unchanged === true).length, 1);

      const [[first]] = await pool.execute('SELECT status,payment_status,delivered_at FROM orders WHERE id=?', [order.id]);
      assert.equal(first.status, 'DELIVERED');
      assert.equal(first.payment_status, 'PAID');
      assert.ok(first.delivered_at);
      const repeated = await api(`/shipper/orders/${order.id}/deliver`, { method: 'POST', token: shipperB.token });
      assert.equal(repeated.status, 200);
      assert.equal(repeated.json.data.unchanged, true);
      const [[second]] = await pool.execute('SELECT delivered_at FROM orders WHERE id=?', [order.id]);
      assert.equal(new Date(second.delivered_at).getTime(), new Date(first.delivered_at).getTime());
      const [[historyCount]] = await pool.execute("SELECT COUNT(*) total FROM order_status_history WHERE order_id=? AND to_status='DELIVERED'", [order.id]);
      assert.equal(Number(historyCount.total), 1);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
