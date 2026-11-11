const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vnpay = require('../../services/payments/vnpay');

const testDatabase = process.env.TEST_DB_NAME;

test('Gift Finder, checkout, VNPAY/GHN callbacks and return inventory keep commerce states consistent', {
    skip: testDatabase ? false : 'Set TEST_DB_NAME to an isolated, migrated database ending in _test.'
}, async () => {
    assert.match(testDatabase, /^giftly_[a-z0-9_]*_test$/i, 'integration tests require a dedicated giftly_*_test database');
    process.env.DB_NAME = testDatabase;
    process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('base64url');
    process.env.ML_SERVICE_URL = '';
    process.env.VNPAY_TMN_CODE = 'GIFTLYTEST';
    process.env.VNPAY_HASH_SECRET = 'integration-only-dummy-secret-never-use-for-merchant';
    process.env.VNPAY_RETURN_URL = 'http://127.0.0.1/api/payments/vnpay/return';
    process.env.VNPAY_PAYMENT_URL = vnpay.SANDBOX_URL;
    process.env.GHN_SHOP_ID = '777';
    process.env.GHN_WEBHOOK_SECRET = 'integration-only-dummy-ghn-secret';

    const { resetTestDatabase } = require('../../scripts/resetTestDb');
    await resetTestDatabase(testDatabase, { seed: true });

    const pool = require('../../config/db');
    const { app } = require('../../server');
    let server;
    let userId;
    let adminToken;
    const userIds = [];
    const orderIds = [];
    let orderId;
    let addressId;
    let productId;
    let originalStock;
    let token;

    try {
        const [[database]] = await pool.query('SELECT DATABASE() name');
        console.log(`[commerce.e2e.test.js] SELECT DATABASE(): ${database.name}`);
        assert.equal(database.name, testDatabase, 'the API must be connected to TEST_DB_NAME');
        const [[existingRows]] = await pool.query('SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM orders) orders');
        assert.equal(Number(existingRows.users), 0, 'refusing to run against a test database containing users');
        assert.equal(Number(existingRows.orders), 0, 'refusing to run against a test database containing orders');

        const [products] = await pool.query("SELECT id,stock,price FROM products WHERE status='ACTIVE' AND stock>0 ORDER BY id LIMIT 1");
        assert.ok(products.length, 'seed the isolated test database with at least one in-stock product');
        productId = products[0].id;
        originalStock = Number(products[0].stock);

        server = app.listen(0);
        await new Promise((resolve, reject) => {
            server.once('listening', resolve);
            server.once('error', reject);
        });
        const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
        const api = async (path, { method = 'GET', body, auth, headers = {}, expectStatus } = {}) => {
            const response = await fetch(`${baseUrl}${path}`, {
                method,
                headers: {
                    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                    ...(auth ? { authorization: `Bearer ${auth}` } : {}),
                    ...headers
                },
                body: body === undefined ? undefined : JSON.stringify(body)
            });
            const json = await response.json();
            assert.equal(expectStatus === undefined ? response.ok : response.status === expectStatus, true,
                `${method} ${path}: ${response.status} ${json.message || ''}`);
            return { status: response.status, data: json.data, message: json.message, body: json };
        };
        const createVnpayOrder = async (key) => {
            await api('/cart/items', { method: 'POST', auth: token, body: { productId: String(productId), quantity: 1 } });
            const result = await api('/orders', {
                method: 'POST', auth: token, headers: { 'Idempotency-Key': key },
                body: { addressId, shippingMethod: 'STANDARD', paymentMethod: 'VNPAY' }
            });
            orderIds.push(result.data.orderId);
            return result.data;
        };
        const startPayment = async (id) => api(`/payments/orders/${id}/vnpay`, { method: 'POST', auth: token });
        const signedIpn = async (reference, total, responseCode, transactionStatus, transactionNo) => {
            const fields = {
                vnp_TmnCode: process.env.VNPAY_TMN_CODE,
                vnp_TxnRef: reference,
                vnp_Amount: String(Math.round(Number(total) * 100)),
                vnp_CurrCode: 'VND',
                vnp_ResponseCode: responseCode,
                vnp_TransactionStatus: transactionStatus,
                vnp_TransactionNo: transactionNo
            };
            fields.vnp_SecureHash = vnpay.sign(fields, process.env.VNPAY_HASH_SECRET);
            const response = await fetch(`${baseUrl}/payments/vnpay/ipn?${new URLSearchParams(fields)}`);
            return response.json();
        };

        const email = `commerce-${crypto.randomUUID()}@example.invalid`;
        await api('/auth/register', {
            method: 'POST', body: { fullName: 'Invalid fixture', email: 'not-an-email', password: 'Integration-Test-2026!' }, expectStatus: 400
        });
        const registration = await api('/auth/register', {
            method: 'POST', body: { fullName: 'Giftly integration fixture', email, password: 'Integration-Test-2026!', role: 'ADMIN' }
        });
        userId = registration.data.user.id;
        userIds.push(userId);
        assert.equal(registration.data.user.role, 'USER');
        assert.equal(Object.hasOwn(registration.data.user, 'passwordHash'), false);
        await api('/auth/register', {
            method: 'POST', body: { fullName: 'Duplicate fixture', email: email.toUpperCase(), password: 'Integration-Test-2026!' }, expectStatus: 409
        });

        await api('/auth/login', { method: 'POST', body: { email, password: 'Wrong-Password-2026!' }, expectStatus: 401 });
        const login = await api('/auth/login', {
            method: 'POST', body: { email, password: 'Integration-Test-2026!' }
        });
        token = login.data.token;
        assert.ok(token);
        assert.equal((await api('/auth/me', { auth: token })).data.user.id, userId);
        await api('/auth/me', { auth: `${token}tampered`, expectStatus: 401 });
        await api('/cart', { expectStatus: 401 });
        await api('/admin/dashboard', { auth: token, expectStatus: 403 });

        const lockedEmail = `commerce-locked-${crypto.randomUUID()}@example.invalid`;
        const lockedRegistration = await api('/auth/register', {
            method: 'POST', body: { fullName: 'Locked fixture', email: lockedEmail, password: 'Integration-Test-Locked-2026!' }
        });
        userIds.push(lockedRegistration.data.user.id);
        const lockedToken = (await api('/auth/login', {
            method: 'POST', body: { email: lockedEmail, password: 'Integration-Test-Locked-2026!' }
        })).data.token;
        await pool.execute("UPDATE users SET status='LOCKED' WHERE id=?", [lockedRegistration.data.user.id]);
        await api('/auth/me', { auth: lockedToken, expectStatus: 401 });
        await api('/auth/login', { method: 'POST', body: { email: lockedEmail, password: 'Integration-Test-Locked-2026!' }, expectStatus: 401 });

        const adminEmail = `commerce-admin-${crypto.randomUUID()}@example.invalid`;
        const adminRegistration = await api('/auth/register', {
            method: 'POST', body: { fullName: 'Giftly integration admin fixture', email: adminEmail, password: 'Integration-Test-Admin-2026!' }
        });
        const adminUserId = adminRegistration.data.user.id;
        userIds.push(adminUserId);
        await pool.execute("UPDATE users SET role='ADMIN' WHERE id=?", [adminUserId]);
        adminToken = (await api('/auth/login', {
            method: 'POST', body: { email: adminEmail, password: 'Integration-Test-Admin-2026!' }
        })).data.token;

        const finder = await api('/products/gift-finder', {
            method: 'POST', body: { query: 'coffee', budget: 200000 }
        });
        assert.equal(finder.data.method, 'content_match');
        assert.ok(finder.data.items.length > 0);
        assert.ok(finder.data.items.every((item) => item.price <= 200000));

        const address = await api('/account/addresses', {
            method: 'POST', auth: token,
            body: {
                recipientName: 'Giftly integration fixture', phone: '0900000000', addressLine: '123 Test Street',
                ward: 'Ward 1', district: 'District 1', city: 'Ho Chi Minh City', isDefault: true
            }
        });
        addressId = address.data.id;
        await api('/cart/items', { method: 'POST', auth: token, body: { productId: String(productId), quantity: 1 } });

        const quote = await api('/orders/quote', {
            method: 'POST', auth: token, body: { addressId, shippingMethod: 'STANDARD' }
        });
        assert.equal(Number(quote.data.subtotal), Number(products[0].price));
        assert.equal(quote.data.shippingMethod, 'STANDARD');

        const idempotencyKey = `e2e-${crypto.randomUUID()}`;
        const checkout = { addressId, shippingMethod: 'STANDARD', paymentMethod: 'COD' };
        const created = await api('/orders', {
            method: 'POST', auth: token, headers: { 'Idempotency-Key': idempotencyKey }, body: checkout
        });
        orderId = created.data.orderId;
        orderIds.push(orderId);
        assert.equal(created.status, 201);
        const retry = await api('/orders', {
            method: 'POST', auth: token, headers: { 'Idempotency-Key': idempotencyKey }, body: checkout
        });
        assert.equal(retry.data.orderId, orderId);

        const detail = await api(`/orders/${orderId}`, { auth: token });
        assert.equal(detail.data.items.length, 1);
        assert.equal(detail.data.paymentStatus, 'UNPAID');
        await api(`/orders/${orderId}/cancel`, { method: 'POST', auth: token, body: {} });
        const [[finalState]] = await pool.execute(
            'SELECT o.status,p.stock FROM orders o JOIN products p ON p.id=? WHERE o.id=?', [productId, orderId]
        );
        assert.equal(finalState.status, 'CANCELLED');
        assert.equal(Number(finalState.stock), originalStock, 'cancellation must restore the reserved inventory');

        const unrelatedEmail = `commerce-unrelated-${crypto.randomUUID()}@example.invalid`;
        const unrelatedRegistration = await api('/auth/register', {
            method: 'POST', body: { fullName: 'Unrelated fixture', email: unrelatedEmail, password: 'Integration-Test-Unrelated-2026!' }
        });
        userIds.push(unrelatedRegistration.data.user.id);
        const unrelatedToken = (await api('/auth/login', {
            method: 'POST', body: { email: unrelatedEmail, password: 'Integration-Test-Unrelated-2026!' }
        })).data.token;
        await api(`/orders/${orderId}`, { auth: unrelatedToken, expectStatus: 404 });

        const unrelatedAddress = await api('/account/addresses', {
            method: 'POST', auth: unrelatedToken,
            body: {
                recipientName: 'Concurrent checkout fixture', phone: '0900000001', addressLine: '456 Test Street',
                ward: 'Ward 1', district: 'District 1', city: 'Ho Chi Minh City', isDefault: true
            }
        });
        await pool.execute('UPDATE products SET stock=1 WHERE id=?', [productId]);
        await Promise.all([
            api('/cart/items', { method: 'POST', auth: token, body: { productId: String(productId), quantity: 1 } }),
            api('/cart/items', { method: 'POST', auth: unrelatedToken, body: { productId: String(productId), quantity: 1 } })
        ]);
        const raceCheckout = async (auth, checkoutAddressId, key) => {
            const response = await fetch(`${baseUrl}/orders`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}`, 'Idempotency-Key': key },
                body: JSON.stringify({ addressId: checkoutAddressId, shippingMethod: 'STANDARD', paymentMethod: 'COD' })
            });
            return { status: response.status, body: await response.json(), auth };
        };
        const concurrentOrders = await Promise.all([
            raceCheckout(token, addressId, `race-a-${crypto.randomUUID()}`),
            raceCheckout(unrelatedToken, unrelatedAddress.data.id, `race-b-${crypto.randomUUID()}`)
        ]);
        assert.deepEqual(concurrentOrders.map((result) => result.status).sort(), [201, 409],
            'only one customer may reserve the final unit');
        const winner = concurrentOrders.find((result) => result.status === 201);
        assert.ok(winner.body.data.orderId);
        orderIds.push(winner.body.data.orderId);
        const [[soldOut]] = await pool.execute('SELECT stock FROM products WHERE id=?', [productId]);
        assert.equal(Number(soldOut.stock), 0, 'concurrent checkout must not oversell inventory');
        await api(`/orders/${winner.body.data.orderId}/cancel`, { method: 'POST', auth: winner.auth, body: {} });
        const [[restored]] = await pool.execute('SELECT stock FROM products WHERE id=?', [productId]);
        assert.equal(Number(restored.stock), 1, 'cancelling the winning fixture restores the reserved unit');
        await pool.execute('UPDATE products SET stock=? WHERE id=?', [originalStock, productId]);

        const lateOrder = await createVnpayOrder(`vnpay-late-${crypto.randomUUID()}`);
        const latePayment = await startPayment(lateOrder.orderId);
        const repeatStart = await startPayment(lateOrder.orderId);
        assert.equal(repeatStart.data.reference, latePayment.data.reference, 'payment initiation must reuse its pending attempt');
        const paymentUrl = new URL(latePayment.data.paymentUrl);
        assert.equal(paymentUrl.searchParams.get('vnp_TmnCode'), process.env.VNPAY_TMN_CODE);
        assert.equal(paymentUrl.searchParams.get('vnp_Amount'), String(Math.round(lateOrder.total * 100)));

        const returnFields = {
            vnp_TmnCode: process.env.VNPAY_TMN_CODE,
            vnp_TxnRef: latePayment.data.reference,
            vnp_Amount: String(Math.round(lateOrder.total * 100)),
            vnp_CurrCode: 'VND', vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: '700001'
        };
        returnFields.vnp_SecureHash = vnpay.sign(returnFields, process.env.VNPAY_HASH_SECRET);
        const browserReturn = await fetch(`${baseUrl}/payments/vnpay/return?${new URLSearchParams(returnFields)}`, { redirect: 'manual' });
        assert.equal(browserReturn.status, 302);
        assert.match(browserReturn.headers.get('location'), new RegExp(`/orders/${lateOrder.orderId}\\?paymentReturn=awaiting-confirmation`));
        const [[beforeIpn]] = await pool.execute('SELECT payment_status FROM orders WHERE id=?', [lateOrder.orderId]);
        assert.equal(beforeIpn.payment_status, 'UNPAID', 'signed browser return cannot confirm payment');

        const invalidSignature = { ...returnFields, vnp_SecureHash: '0'.repeat(128) };
        let callback = await fetch(`${baseUrl}/payments/vnpay/ipn?${new URLSearchParams(invalidSignature)}`).then((response) => response.json());
        assert.equal(callback.RspCode, '97');
        callback = await signedIpn(latePayment.data.reference, lateOrder.total + 1, '00', '00', '700001');
        assert.equal(callback.RspCode, '04');
        await api(`/orders/${lateOrder.orderId}/cancel`, { method: 'POST', auth: token, body: {} });
        callback = await signedIpn(latePayment.data.reference, lateOrder.total, '00', '00', '700001');
        assert.equal(callback.RspCode, '00');
        const [[lateState]] = await pool.execute(`SELECT o.status,o.payment_status,p.status attempt_status
            FROM orders o JOIN payment_attempts p ON p.order_id=o.id WHERE o.id=?`, [lateOrder.orderId]);
        assert.equal(lateState.status, 'CANCELLED');
        assert.equal(lateState.payment_status, 'UNPAID');
        assert.equal(lateState.attempt_status, 'REVIEW');
        callback = await signedIpn(latePayment.data.reference, lateOrder.total, '00', '00', '700001');
        assert.equal(callback.RspCode, '02', 'replayed callback must not process the payment twice');

        const failedOrder = await createVnpayOrder(`vnpay-failed-${crypto.randomUUID()}`);
        const failedPayment = await startPayment(failedOrder.orderId);
        callback = await signedIpn(failedPayment.data.reference, failedOrder.total, '24', '02', '700002');
        assert.equal(callback.RspCode, '00');
        const [[failedState]] = await pool.execute(`SELECT o.payment_status,p.status attempt_status
            FROM orders o JOIN payment_attempts p ON p.order_id=o.id WHERE o.id=?`, [failedOrder.orderId]);
        assert.equal(failedState.payment_status, 'UNPAID');
        assert.equal(failedState.attempt_status, 'FAILED');
        callback = await signedIpn(failedPayment.data.reference, failedOrder.total, '24', '02', '700002');
        assert.equal(callback.RspCode, '02');
        await api(`/orders/${failedOrder.orderId}/cancel`, { method: 'POST', auth: token, body: {} });

        const paidOrder = await createVnpayOrder(`vnpay-paid-${crypto.randomUUID()}`);
        const paidPayment = await startPayment(paidOrder.orderId);
        callback = await signedIpn(paidPayment.data.reference, paidOrder.total, '00', '00', '700003');
        assert.equal(callback.RspCode, '00');
        const [[paidState]] = await pool.execute(`SELECT o.status,o.payment_status,p.status attempt_status,p.provider_transaction_id
            FROM orders o JOIN payment_attempts p ON p.order_id=o.id WHERE o.id=?`, [paidOrder.orderId]);
        assert.equal(paidState.status, 'PENDING');
        assert.equal(paidState.payment_status, 'PAID');
        assert.equal(paidState.attempt_status, 'SUCCEEDED');
        assert.equal(paidState.provider_transaction_id, '700003');
        const cancelPaid = await api(`/orders/${paidOrder.orderId}/cancel`, {
            method: 'POST', auth: token, body: {}, expectStatus: 409
        });
        assert.match(cancelPaid.message || '', /Only pending unpaid/);
        const adminCancelPaid = await api(`/admin/orders/${paidOrder.orderId}/status`, {
            method: 'PATCH', auth: adminToken, body: { status: 'CANCELLED' }, expectStatus: 409
        });
        assert.match(adminCancelPaid.message || '', /refund workflow/);
        const [[protectedStock]] = await pool.execute('SELECT stock FROM products WHERE id=?', [productId]);
        assert.equal(Number(protectedStock.stock), originalStock - 1, 'a paid order must retain its stock reservation');

        await api('/cart/items', { method: 'POST', auth: token, body: { productId: String(productId), quantity: 1 } });
        const [[stockBeforeShipmentOrder]] = await pool.execute('SELECT stock FROM products WHERE id=?', [productId]);
        const shipmentOrder = await api('/orders', {
            method: 'POST', auth: token, headers: { 'Idempotency-Key': `ghn-${crypto.randomUUID()}` },
            body: { addressId, shippingMethod: 'STANDARD', paymentMethod: 'COD' }
        });
        orderIds.push(shipmentOrder.data.orderId);
        const [[shipmentOrderRow]] = await pool.execute('SELECT order_code FROM orders WHERE id=?', [shipmentOrder.data.orderId]);
        await pool.execute("UPDATE orders SET status='PROCESSING' WHERE id=?", [shipmentOrder.data.orderId]);
        await pool.execute("INSERT INTO shipments(order_id,client_order_code,provider,status) VALUES (?,?,'GHN','CREATING')", [shipmentOrder.data.orderId, shipmentOrderRow.order_code]);
        const shipEvent = (status, offsetSeconds) => ({
            OrderCode: `GHN-${shipmentOrderRow.order_code}`, ClientOrderCode: shipmentOrderRow.order_code,
            ShopID: 777, Status: status, Type: 'switch_status',
            Time: new Date(Math.ceil(Date.now() / 1000) * 1000 + offsetSeconds * 1000).toISOString()
        });
        const invalidWebhook = await api('/shipments/ghn/webhook', {
            method: 'POST', body: shipEvent('delivering', 5),
            headers: { 'x-giftly-shipping-secret': 'wrong-test-secret' }, expectStatus: 401
        });
        assert.match(invalidWebhook.message, /Invalid webhook credentials/);
        const shipmentSecret = { 'x-giftly-shipping-secret': process.env.GHN_WEBHOOK_SECRET };
        const configuredShopId = process.env.GHN_SHOP_ID;
        delete process.env.GHN_SHOP_ID;
        const missingShopId = await api('/shipments/ghn/webhook', {
            method: 'POST', body: { ...shipEvent('delivering', 6), ShopID: undefined },
            headers: shipmentSecret, expectStatus: 401
        });
        process.env.GHN_SHOP_ID = configuredShopId;
        assert.match(missingShopId.message, /Invalid webhook credentials/);
        await api('/shipments/ghn/webhook', { method: 'POST', body: shipEvent('delivering', 5), headers: shipmentSecret });
        const deliveredEvent = shipEvent('delivered', 10);
        await api('/shipments/ghn/webhook', { method: 'POST', body: deliveredEvent, headers: shipmentSecret });
        await api('/shipments/ghn/webhook', { method: 'POST', body: shipEvent('picked', 7), headers: shipmentSecret });
        const backwardEvent = shipEvent('transporting', 15);
        await api('/shipments/ghn/webhook', { method: 'POST', body: backwardEvent, headers: shipmentSecret });
        const duplicateWebhook = await api('/shipments/ghn/webhook', { method: 'POST', body: backwardEvent, headers: shipmentSecret });
        assert.equal(duplicateWebhook.body.duplicate, true);
        const [[shipmentState]] = await pool.execute(`SELECT s.status,DATE_FORMAT(s.last_event_at,'%Y-%m-%dT%H:%i:%sZ') last_event_at,o.status order_status,o.payment_status,
            (SELECT COUNT(*) FROM shipment_events e WHERE e.shipment_id=s.id) event_count
            FROM shipments s JOIN orders o ON o.id=s.order_id WHERE o.id=?`, [shipmentOrder.data.orderId]);
        assert.equal(shipmentState.status, 'DELIVERED');
        assert.equal(shipmentState.order_status, 'DELIVERED');
        assert.equal(shipmentState.payment_status, 'PAID');
        assert.equal(Number(shipmentState.event_count), 4);
        assert.equal(shipmentState.last_event_at, `${deliveredEvent.Time.slice(0, 19)}Z`);

        const returnRequest = await api(`/orders/${shipmentOrder.data.orderId}/returns`, {
            method: 'POST', auth: token, body: { reason: 'Return workflow fixture', details: 'Testing inventory and refund status.' }
        });
        const [[stockBeforeReturn]] = await pool.execute('SELECT stock FROM products WHERE id=?', [productId]);
        assert.equal(Number(stockBeforeReturn.stock), Number(stockBeforeShipmentOrder.stock) - 1);
        await api(`/admin/returns/${returnRequest.data.id}`, {
            method: 'PATCH', auth: adminToken, body: { status: 'COMPLETED' }, expectStatus: 409
        });
        await api(`/admin/returns/${returnRequest.data.id}`, {
            method: 'PATCH', auth: adminToken, body: { status: 'APPROVED', adminNote: 'Approved for return.' }
        });
        const completedReturn = await api(`/admin/returns/${returnRequest.data.id}`, {
            method: 'PATCH', auth: adminToken, body: { status: 'COMPLETED', adminNote: 'Returned goods received.' }
        });
        assert.equal(completedReturn.data.restocked, true);
        assert.equal(completedReturn.data.refundProcessed, false);
        await api(`/admin/returns/${returnRequest.data.id}`, {
            method: 'PATCH', auth: adminToken, body: { status: 'COMPLETED' }, expectStatus: 409
        });
        const [[stockAfterReturn]] = await pool.execute('SELECT stock FROM products WHERE id=?', [productId]);
        assert.equal(Number(stockAfterReturn.stock), Number(stockBeforeShipmentOrder.stock),
            'return completion restocks once and does not claim a refund was processed');
    } finally {
        if (server) {
            server.closeAllConnections?.();
            await new Promise((resolve) => server.close(resolve));
        }
        const fixtureOrderIds = new Set(orderIds.map(String));
        if (userIds.length) {
            const placeholders = userIds.map(() => '?').join(',');
            const [ownedOrders] = await pool.execute(`SELECT id FROM orders WHERE user_id IN (${placeholders})`, userIds).catch(() => [[]]);
            for (const row of ownedOrders) fixtureOrderIds.add(String(row.id));
        }
        for (const fixtureOrderId of fixtureOrderIds) {
            const [fixtureReturns] = await pool.execute('SELECT id FROM return_requests WHERE order_id=?', [fixtureOrderId]).catch(() => [[]]);
            for (const fixtureReturn of fixtureReturns) {
                await pool.execute("DELETE FROM admin_audit_logs WHERE entity_type='return' AND entity_id=?", [fixtureReturn.id]).catch(() => {});
            }
            for (const [table, column] of [
                ['order_items', 'order_id'], ['order_status_history', 'order_id'], ['order_shipping_history', 'order_id'],
                ['inventory_movements', 'order_id'], ['notifications', 'order_id'], ['coupon_uses', 'order_id'],
                ['return_requests', 'order_id']
            ]) await pool.execute(`DELETE FROM ${table} WHERE ${column}=?`, [fixtureOrderId]).catch(() => {});
            await pool.execute("DELETE FROM admin_audit_logs WHERE entity_type='order' AND entity_id=?", [fixtureOrderId]).catch(() => {});
            await pool.execute('DELETE FROM payment_attempts WHERE order_id=?', [fixtureOrderId]).catch(() => {});
            await pool.execute('DELETE FROM shipments WHERE order_id=?', [fixtureOrderId]).catch(() => {});
            await pool.execute('DELETE FROM orders WHERE id=?', [fixtureOrderId]).catch(() => {});
        }
        if (productId && originalStock !== undefined && userId && orderIds.length) {
            await pool.execute('UPDATE products SET stock=? WHERE id=?', [originalStock, productId]).catch(() => {});
        }
        for (const fixtureUserId of userIds) {
            for (const [table, column] of [
                ['cart_items', 'user_id'], ['product_events', 'user_id'], ['favorites', 'user_id'],
                ['addresses', 'user_id'], ['notifications', 'user_id'], ['cart_merge_requests', 'user_id'],
                ['account_deletion_requests', 'user_id']
            ]) await pool.execute(`DELETE FROM ${table} WHERE ${column}=?`, [fixtureUserId]).catch(() => {});
            await pool.execute('DELETE FROM users WHERE id=?', [fixtureUserId]).catch(() => {});
        }
        await pool.end();
    }
});
