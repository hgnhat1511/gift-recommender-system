'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const testDatabase = (process.env.TEST_DB_NAME || 'giftly_verification_test').trim();

test('Khu vực 2i & 2j: Race condition Vận đơn GHN, Bù trừ Pha 3, Hết hạn CREATING và Chặn VNPAY chưa thanh toán', {
  skip: testDatabase ? false : 'Set TEST_DB_NAME to giftly_verification_test'
}, async (t) => {
  assert.match(testDatabase, /^giftly_[a-z0-9_]*_test$/i, 'Test bắt buộc phải chạy trên database test chuyên biệt');
  process.env.DB_NAME = testDatabase;
  process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('base64url');
  process.env.ML_SERVICE_URL = '';

  // Cấu hình VNPAY test
  process.env.VNPAY_TMN_CODE = 'GIFTLYTEST';
  process.env.VNPAY_HASH_SECRET = 'integration-race-secret-test-2026';
  process.env.VNPAY_RETURN_URL = 'http://127.0.0.1/api/payments/vnpay/return';
  const vnpay = require('../../services/payments/vnpay');
  process.env.VNPAY_PAYMENT_URL = vnpay.SANDBOX_URL;

  // Cấu hình GHN staging test
  process.env.GHN_ENVIRONMENT = 'staging';
  process.env.GHN_TOKEN = 'ghn-test-token-2026';
  process.env.GHN_SHOP_ID = '98765';
  process.env.GHN_FROM_NAME = 'Giftly Test Store';
  process.env.GHN_FROM_PHONE = '0901234567';
  process.env.GHN_FROM_ADDRESS = '123 Lê Lợi';
  process.env.GHN_FROM_WARD = 'Bến Nghé';
  process.env.GHN_FROM_DISTRICT = 'Quận 1';
  process.env.GHN_FROM_PROVINCE = 'TP. Hồ Chí Minh';
  process.env.GHN_FROM_IS_NEW_ADDRESS = 'false';
  process.env.GHN_WEBHOOK_SECRET = 'ghn-secret-test-race';

  // Mock GHN network requests qua globalThis.fetch
  const originalFetch = globalThis.fetch;
  const ghnMockCalls = { creates: 0, cancels: 0 };
  let mockCancelShouldFail = false;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes('/v2/shipping-order/create')) {
      ghnMockCalls.creates++;
      // Tạo độ trễ nhân tạo 35ms để mô phỏng thời gian gọi mạng GHN
      await new Promise((resolve) => setTimeout(resolve, 35));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 200,
          message: 'Success',
          data: {
            order_code: `GHN-MOCK-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            expected_delivery_time: '2026-11-10T12:00:00Z',
            total_fee: 32000,
          },
        }),
      };
    }
    if (urlStr.includes('/v2/switch-status/cancel')) {
      ghnMockCalls.cancels++;
      if (mockCancelShouldFail) {
        throw new Error('GHN cancel provider connection timeout');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 200,
          message: 'Success',
        }),
      };
    }
    return originalFetch(url, options);
  };

  const pool = require('../../config/db');
  const { app } = require('../../server');

  let server;
  let userAId, tokenA;
  let adminId, adminToken;
  let testProductId;

  try {
    const [[database]] = await pool.query('SELECT DATABASE() name');
    assert.equal(database.name, testDatabase, 'API phải kết nối chính xác tới TEST_DB_NAME');

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
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await response.json();
      if (expectStatus !== undefined) {
        assert.equal(
          response.status,
          expectStatus,
          `${method} ${path}: expected HTTP ${expectStatus}, got ${response.status} (${json.message || ''})`
        );
      }
      return { status: response.status, data: json.data, message: json.message, body: json };
    };

    // Tạo khách hàng test
    const emailA = `race-customer-${crypto.randomUUID()}@example.invalid`;
    const regA = await api('/auth/register', {
      method: 'POST',
      body: { fullName: 'Khách Race Test', email: emailA, password: 'Password-2026!' },
      expectStatus: 201,
    });
    userAId = regA.data.user.id;
    const loginA = await api('/auth/login', {
      method: 'POST',
      body: { email: emailA, password: 'Password-2026!' },
      expectStatus: 200,
    });
    tokenA = loginA.data.token;

    // Tạo admin test
    const emailAdmin = `race-admin-${crypto.randomUUID()}@example.invalid`;
    const regAdmin = await api('/auth/register', {
      method: 'POST',
      body: { fullName: 'Admin Race Test', email: emailAdmin, password: 'Password-2026!' },
      expectStatus: 201,
    });
    adminId = regAdmin.data.user.id;
    await pool.execute("UPDATE users SET role='ADMIN' WHERE id=?", [adminId]);
    const loginAdmin = await api('/auth/login', {
      method: 'POST',
      body: { email: emailAdmin, password: 'Password-2026!' },
      expectStatus: 200,
    });
    adminToken = loginAdmin.data.token;

    // Lưu địa chỉ giao hàng cho khách
    const addrRes = await api('/account/addresses', {
      method: 'POST',
      auth: tokenA,
      body: {
        recipientName: 'Khách Race',
        phone: '0901234567',
        addressLine: '123 Lê Lợi',
        ward: 'Bến Nghé',
        district: 'Quận 1',
        city: 'TP. Hồ Chí Minh',
      },
      expectStatus: 201,
    });
    const addressId = addrRes.data.id;

    // Chuẩn bị sản phẩm test
    const [cRows] = await pool.query('SELECT id FROM categories LIMIT 1');
    const categoryId = cRows[0].id;
    const [prod] = await pool.query(
      `INSERT INTO products (name, category_id, price, stock, status)
       VALUES ('Sản phẩm Race Test', ?, 200000, 100, 'ACTIVE')`,
      [categoryId]
    );
    testProductId = prod.insertId;

    // Helper tạo đơn COD ở trạng thái PROCESSING
    const createProcessingCodOrder = async () => {
      await api('/cart/items', {
        method: 'POST',
        auth: tokenA,
        body: { productId: testProductId, quantity: 1 },
        expectStatus: 201,
      });
      const orderRes = await api('/orders', {
        method: 'POST',
        auth: tokenA,
        body: {
          addressId,
          paymentMethod: 'COD',
          shippingMethod: 'STANDARD',
        },
        expectStatus: 201,
      });
      return orderRes.data.orderId;
    };

    // =========================================================================
    // YÊU CẦU 5(a): Khách hủy đồng thời với Admin tạo vận đơn GHN (Promise.all)
    // =========================================================================
    await t.test('5(a). Race condition: Khách hủy đồng thời với Admin tạo vận đơn GHN', async () => {
      const iterations = 5;
      for (let i = 0; i < iterations; i++) {
        const orderId = await createProcessingCodOrder();

        const [[initialOrder]] = await pool.query('SELECT status, shipping_carrier FROM orders WHERE id=?', [orderId]);
        assert.equal(initialOrder.status, 'PROCESSING');

        const [cancelRes, shipmentRes] = await Promise.all([
          api(`/orders/${orderId}/cancel`, { method: 'POST', auth: tokenA }),
          api(`/admin/orders/${orderId}/shipments/ghn`, {
            method: 'POST',
            auth: adminToken,
            body: { weightGrams: 500, lengthCm: 20, widthCm: 15, heightCm: 10 },
          }),
        ]);

        const [[finalOrder]] = await pool.query(
          'SELECT status, shipping_carrier, tracking_number FROM orders WHERE id=?',
          [orderId]
        );
        const [shipments] = await pool.query(
          'SELECT id, status, provider_order_code FROM shipments WHERE order_id=?',
          [orderId]
        );

        for (const s of shipments) {
          assert.notEqual(s.status, 'CREATING', `Lần lặp ${i}: Vận đơn không được bị kẹt ở CREATING`);
        }

        if (finalOrder.status === 'PROCESSING') {
          assert.equal(shipmentRes.status, 201, `Admin tạo vận đơn phải trả về 201 (got ${shipmentRes.status})`);
          assert.equal(cancelRes.status, 409, `Khách hủy sau khi đã có vận đơn phải bị chặn 409 (got ${cancelRes.status})`);
          assert.equal(finalOrder.shipping_carrier, 'GHN');
          assert.ok(shipments.length >= 1);
          assert.equal(shipments[0].status, 'CREATED');
        } else if (finalOrder.status === 'CANCELLED') {
          assert.equal(cancelRes.status, 200, `Khách hủy thành công phải trả về 200 (got ${cancelRes.status})`);
          assert.equal(shipmentRes.status, 409, `Admin tạo vận đơn cho đơn đã hủy phải nhận 409 (got ${shipmentRes.status})`);
          if (shipments.length > 0) {
            assert.equal(shipments[0].status, 'CANCELLED', `Shipment nếu có phải bị hủy về CANCELLED`);
          }
        } else {
          assert.fail(`Trạng thái đơn không hợp lệ sau race: ${finalOrder.status}`);
        }
      }
    });

    // =========================================================================
    // YÊU CẦU 2j-1: Bù trừ Pha 3 - Admin hủy đơn đồng thời với Admin tạo vận đơn
    //               Kiểm tra cancelOrder được gọi đúng 1 lần, shipments CANCELLED
    // =========================================================================
    await t.test('2j-1. Bù trừ Pha 3: Admin hủy đơn khi đang tạo vận đơn -> cancelOrder được gọi, shipment CANCELLED', async () => {
      mockCancelShouldFail = false;
      const initialCancels = ghnMockCalls.cancels;
      const orderId = await createProcessingCodOrder();

      // Bắt đầu tạo vận đơn (GHN mạng mock trễ 35ms)
      const shipmentPromise = api(`/admin/orders/${orderId}/shipments/ghn`, {
        method: 'POST',
        auth: adminToken,
        body: { weightGrams: 500, lengthCm: 20, widthCm: 15, heightCm: 10 },
      });

      // Admin lập tức hủy đơn hàng trong khi GHN call đang in-flight
      await new Promise((r) => setTimeout(r, 10));
      const cancelRes = await api(`/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        auth: adminToken,
        body: { status: 'CANCELLED', note: 'Admin chủ động hủy đơn trong khi chuẩn bị giao' },
        expectStatus: 200,
      });
      assert.equal(cancelRes.status, 200);

      const shipmentRes = await shipmentPromise;
      // Nhánh Pha 3 phát hiện đơn không còn PROCESSING -> abort & bù trừ -> trả về 409
      assert.equal(shipmentRes.status, 409);
      assert.match(shipmentRes.message, /Order status changed while creating the shipment/);

      // Kiểm tra cancelOrder của GHN được gọi đúng 1 lần
      assert.equal(ghnMockCalls.cancels, initialCancels + 1, 'cancelOrder phải được gọi chính xác 1 lần');

      // Kiểm tra trạng thái DB
      const [[finalOrder]] = await pool.query('SELECT status FROM orders WHERE id=?', [orderId]);
      assert.equal(finalOrder.status, 'CANCELLED');

      const [shipments] = await pool.query('SELECT * FROM shipments WHERE order_id=?', [orderId]);
      assert.equal(shipments.length, 1);
      assert.equal(shipments[0].status, 'CANCELLED', 'Shipment phải chuyển thành CANCELLED');
      assert.ok(shipments[0].provider_order_code, 'Phải lưu provider_order_code để đối soát');

      // Kiểm tra ghi audit log và shipping history
      const [auditLogs] = await pool.query(
        "SELECT action, details FROM admin_audit_logs WHERE entity_id=? AND action='SHIPMENT_ABORTED'",
        [orderId]
      );
      assert.equal(auditLogs.length, 1, 'Phải ghi audit log SHIPMENT_ABORTED');

      const [shipHist] = await pool.query(
        'SELECT * FROM order_shipping_history WHERE order_id=? ORDER BY id DESC LIMIT 1',
        [orderId]
      );
      assert.equal(shipHist.length, 1);
      assert.match(shipHist[0].note, /Vận đơn GHN đã được tự động hủy/);
    });

    // =========================================================================
    // YÊU CẦU 2j-2: cancelOrder thất bại / timeout khi bù trừ
    //               Ghi nhận SHIPMENT_CANCEL_FAILED & manualActionRequired vào audit/history
    // =========================================================================
    await t.test('2j-2. Bù trừ Pha 3 thất bại (GHN timeout/lỗi): ghi nhận audit log và shipping history để xử lý tay', async () => {
      mockCancelShouldFail = true;
      const orderId = await createProcessingCodOrder();

      const shipmentPromise = api(`/admin/orders/${orderId}/shipments/ghn`, {
        method: 'POST',
        auth: adminToken,
        body: { weightGrams: 500, lengthCm: 20, widthCm: 15, heightCm: 10 },
      });

      await new Promise((r) => setTimeout(r, 10));
      await api(`/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        auth: adminToken,
        body: { status: 'CANCELLED', note: 'Admin hủy test bù trừ lỗi' },
        expectStatus: 200,
      });

      const shipmentRes = await shipmentPromise;
      assert.equal(shipmentRes.status, 409);
      assert.equal(shipmentRes.body.manualActionRequired, true, 'Phải cắm cờ manualActionRequired');

      // Kiểm tra audit log
      const [auditLogs] = await pool.query(
        "SELECT action, details FROM admin_audit_logs WHERE entity_id=? AND action='SHIPMENT_CANCEL_FAILED'",
        [orderId]
      );
      assert.equal(auditLogs.length, 1, 'Phải ghi audit log SHIPMENT_CANCEL_FAILED');
      const details = typeof auditLogs[0].details === 'string' ? JSON.parse(auditLogs[0].details) : auditLogs[0].details;
      assert.equal(details.manualActionRequired, true);
      assert.match(details.error, /GHN cancel provider connection timeout/);

      // Kiểm tra shipping history
      const [shipHist] = await pool.query(
        'SELECT * FROM order_shipping_history WHERE order_id=? ORDER BY id DESC LIMIT 1',
        [orderId]
      );
      assert.equal(shipHist.length, 1);
      assert.match(shipHist[0].note, /Cần hủy thủ công trên portal GHN/);

      mockCancelShouldFail = false;
    });

    // =========================================================================
    // YÊU CẦU 2j-3: Xử lý vận đơn kẹt CREATING
    //               - CREATING kẹt quá 5 phút (stale): Khách được tự hủy, shipment -> FAILED
    //               - CREATING mới tạo (< 5 phút): Khách & Admin dispatch thứ hai bị chặn 409
    // =========================================================================
    await t.test('2j-3. Vận đơn kẹt CREATING: stale (>5 phút) giải phóng cho khách hủy; recent (<5 phút) chặn 409', async () => {
      // 1. Trường hợp stale CREATING (> 5 phút, ví dụ tiến trình chết hoặc timeout cũ)
      const staleOrderId = await createProcessingCodOrder();
      await pool.execute(
        "INSERT INTO shipments (order_id, client_order_code, provider, status, updated_at) VALUES (?, ?, 'GHN', 'CREATING', NOW() - INTERVAL 10 MINUTE)",
        [staleOrderId, `STALE-${Date.now()}`]
      );

      // Khách hàng gửi yêu cầu hủy đơn -> Phải được xử lý thành công, tự động đánh dấu shipment FAILED
      const cancelStaleRes = await api(`/orders/${staleOrderId}/cancel`, {
        method: 'POST',
        auth: tokenA,
        expectStatus: 200,
      });
      assert.equal(cancelStaleRes.status, 200);

      const [[staleOrderDb]] = await pool.query('SELECT status FROM orders WHERE id=?', [staleOrderId]);
      assert.equal(staleOrderDb.status, 'CANCELLED');

      const [[staleShipmentDb]] = await pool.query('SELECT status FROM shipments WHERE order_id=?', [staleOrderId]);
      assert.equal(staleShipmentDb.status, 'FAILED', 'Stale CREATING phải được chuyển thành FAILED để không kẹt');

      // 2. Trường hợp recent CREATING (< 5 phút, đang trong quá trình tạo)
      const recentOrderId = await createProcessingCodOrder();
      await pool.execute(
        "INSERT INTO shipments (order_id, client_order_code, provider, status, updated_at) VALUES (?, ?, 'GHN', 'CREATING', NOW())",
        [recentOrderId, `RECENT-${Date.now()}`]
      );

      // Khách hàng hủy -> Bị chặn 409
      const cancelRecentRes = await api(`/orders/${recentOrderId}/cancel`, {
        method: 'POST',
        auth: tokenA,
        expectStatus: 409,
      });
      assert.equal(cancelRecentRes.status, 409);
      assert.match(cancelRecentRes.message, /không thể tự hủy/);

      // Admin thứ hai gửi request tạo vận đơn trùng lặp -> Bị chặn 409
      const dupShipmentRes = await api(`/admin/orders/${recentOrderId}/shipments/ghn`, {
        method: 'POST',
        auth: adminToken,
        body: { weightGrams: 500, lengthCm: 20, widthCm: 15, heightCm: 10 },
        expectStatus: 409,
      });
      assert.equal(dupShipmentRes.status, 409);
      assert.match(dupShipmentRes.message, /Vận đơn đang trong quá trình tạo/);
    });

    // =========================================================================
    // YÊU CẦU 5(b): Hủy đơn VNPAY chưa thanh toán -> attempt thành EXPIRED
    //                IPN đến muộn chuyển attempt thành REVIEW
    // =========================================================================
    await t.test('5(b). Hủy đơn VNPAY: attempt thành EXPIRED; IPN muộn chuyển vào REVIEW', async () => {
      // 1. Tạo đơn VNPAY
      await api('/cart/items', {
        method: 'POST',
        auth: tokenA,
        body: { productId: testProductId, quantity: 1 },
        expectStatus: 201,
      });
      const orderRes = await api('/orders', {
        method: 'POST',
        auth: tokenA,
        body: {
          addressId,
          paymentMethod: 'VNPAY',
          shippingMethod: 'STANDARD',
        },
        expectStatus: 201,
      });
      const vnpayOrderId = orderRes.data.orderId;

      // 2. Bắt đầu phiên thanh toán VNPAY qua POST /api/payments/orders/:orderId/vnpay
      const startRes = await api(`/payments/orders/${vnpayOrderId}/vnpay`, {
        method: 'POST',
        auth: tokenA,
        expectStatus: 200,
      });
      const txnRef = startRes.data.reference;
      assert.ok(txnRef, 'Phải có txnRef được tạo');

      // Kiểm tra DB: attempt ban đầu là PENDING
      const [[attemptBefore]] = await pool.query(
        "SELECT status, amount FROM payment_attempts WHERE reference=?",
        [txnRef]
      );
      assert.equal(attemptBefore.status, 'PENDING');

      // 3. Khách hàng hủy đơn hàng
      const cancelRes = await api(`/orders/${vnpayOrderId}/cancel`, {
        method: 'POST',
        auth: tokenA,
        expectStatus: 200,
      });
      assert.equal(cancelRes.status, 200);

      // Kiểm tra DB: Đơn thành CANCELLED và attempt thành EXPIRED trong cùng transaction
      const [[orderAfterCancel]] = await pool.query('SELECT status FROM orders WHERE id=?', [vnpayOrderId]);
      assert.equal(orderAfterCancel.status, 'CANCELLED');

      const [[attemptAfterCancel]] = await pool.query(
        "SELECT status FROM payment_attempts WHERE reference=?",
        [txnRef]
      );
      assert.equal(attemptAfterCancel.status, 'EXPIRED', 'Payment attempt PENDING phải được chuyển thành EXPIRED khi hủy đơn');

      // 4. Giả lập IPN thành công từ VNPAY đến muộn
      const expectedAmountMinor = Math.round(Number(attemptBefore.amount) * 100);
      const testTxnNo = String(Date.now()).slice(-8) + Math.floor(Math.random() * 10000);
      const ipnFields = {
        vnp_TmnCode: process.env.VNPAY_TMN_CODE,
        vnp_TxnRef: txnRef,
        vnp_Amount: String(expectedAmountMinor),
        vnp_CurrCode: 'VND',
        vnp_ResponseCode: '00',
        vnp_TransactionStatus: '00',
        vnp_TransactionNo: testTxnNo,
      };
      ipnFields.vnp_SecureHash = vnpay.sign(ipnFields, process.env.VNPAY_HASH_SECRET);

      const ipnQuery = new URLSearchParams(ipnFields).toString();
      const ipnRes = await fetch(`${baseUrl}/payments/vnpay/ipn?${ipnQuery}`);
      assert.equal(ipnRes.status, 200);
      const ipnJson = await ipnRes.json();
      assert.equal(ipnJson.RspCode, '00');
      assert.equal(ipnJson.Message, 'Payment received and flagged for review');

      // Kiểm tra DB sau IPN
      const [[attemptAfterIpn]] = await pool.query(
        "SELECT status, provider_transaction_id, provider_response_code FROM payment_attempts WHERE reference=?",
        [txnRef]
      );
      assert.equal(attemptAfterIpn.status, 'REVIEW', 'Late IPN phải chuyển payment_attempt thành REVIEW');
      assert.equal(attemptAfterIpn.provider_transaction_id, testTxnNo);
      assert.equal(attemptAfterIpn.provider_response_code, '00');

      const [[orderAfterIpn]] = await pool.query('SELECT status, payment_status FROM orders WHERE id=?', [vnpayOrderId]);
      assert.equal(orderAfterIpn.status, 'CANCELLED', 'Đơn hàng đã hủy không được bị đổi trạng thái khi nhận IPN muộn');
      assert.equal(orderAfterIpn.payment_status, 'UNPAID');

      const [auditLogs] = await pool.query(
        "SELECT action, entity_id FROM admin_audit_logs WHERE entity_id=? AND action='PAYMENT_REVIEW'",
        [vnpayOrderId]
      );
      assert.equal(auditLogs.length, 1, 'Phải ghi audit log PAYMENT_REVIEW cho đơn nhận tiền muộn');
    });

    // =========================================================================
    // YÊU CẦU 5(c): Admin bị chặn 409 khi đơn VNPAY chưa PAID mà chuyển sang
    //                CONFIRMED hoặc PROCESSING
    // =========================================================================
    await t.test('5(c). Admin bị chặn 409 khi đơn VNPAY chưa PAID mà chuyển sang CONFIRMED hoặc PROCESSING', async () => {
      // 1. Tạo đơn VNPAY mới (status: PENDING, payment_status: UNPAID)
      await api('/cart/items', {
        method: 'POST',
        auth: tokenA,
        body: { productId: testProductId, quantity: 1 },
        expectStatus: 201,
      });
      const orderRes = await api('/orders', {
        method: 'POST',
        auth: tokenA,
        body: {
          addressId,
          paymentMethod: 'VNPAY',
          shippingMethod: 'STANDARD',
        },
        expectStatus: 201,
      });
      const vnpayOrderId = orderRes.data.orderId;

      const [[orderBeforeAdmin]] = await pool.query('SELECT status, payment_status, payment_method FROM orders WHERE id=?', [vnpayOrderId]);
      assert.equal(orderBeforeAdmin.status, 'PENDING');
      assert.equal(orderBeforeAdmin.payment_status, 'UNPAID');
      assert.equal(orderBeforeAdmin.payment_method, 'VNPAY');

      // 2. Admin thử chuyển PENDING sang CONFIRMED -> Bị chặn 409
      const patchConfirmedRes = await api(`/admin/orders/${vnpayOrderId}/status`, {
        method: 'PATCH',
        auth: adminToken,
        body: { status: 'CONFIRMED' },
        expectStatus: 409,
      });
      assert.equal(patchConfirmedRes.status, 409);
      assert.match(patchConfirmedRes.message, /chưa thanh toán \(PAID\)/);

      // Trạng thái đơn không đổi
      const [[orderAfterConfirmed]] = await pool.query('SELECT status FROM orders WHERE id=?', [vnpayOrderId]);
      assert.equal(orderAfterConfirmed.status, 'PENDING');

      // 3. Đơn hàng ở CONFIRMED nhưng payment_status vẫn là UNPAID -> Admin thử chuyển sang PROCESSING
      await pool.execute("UPDATE orders SET status='CONFIRMED' WHERE id=?", [vnpayOrderId]);
      const patchProcessingRes = await api(`/admin/orders/${vnpayOrderId}/status`, {
        method: 'PATCH',
        auth: adminToken,
        body: { status: 'PROCESSING' },
        expectStatus: 409,
      });
      assert.equal(patchProcessingRes.status, 409);
      assert.match(patchProcessingRes.message, /chưa thanh toán \(PAID\)/);

      // Trạng thái đơn vẫn là CONFIRMED (không sang PROCESSING)
      const [[orderAfterProcessing]] = await pool.query('SELECT status FROM orders WHERE id=?', [vnpayOrderId]);
      assert.equal(orderAfterProcessing.status, 'CONFIRMED');
    });

  } finally {
    // Khôi phục fetch nguyên bản
    globalThis.fetch = originalFetch;
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      await pool.end();
    } catch {
      // ignore
    }
  }
});
