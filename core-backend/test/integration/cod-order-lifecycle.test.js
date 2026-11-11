'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const testDatabase = (process.env.TEST_DB_NAME || 'giftly_e2e_test').trim();

test('Khu vực 2a: Xác minh và hoàn thiện toàn diện vòng đời đơn hàng COD', {
  skip: testDatabase ? false : 'Set TEST_DB_NAME to giftly_e2e_test'
}, async (t) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('TỪ CHỐI CHẠY: Không thể chạy test ghi dữ liệu trên NODE_ENV=production');
  }
  if (!testDatabase.endsWith('_test') || testDatabase === 'gift_ecommerce' || testDatabase === 'giftly_verification_test') {
    throw new Error(`TỪ CHỐI CHẠY: Database "${testDatabase}" không hợp lệ. Chỉ chấp nhận database kết thúc bằng "_test" và tuyệt đối không đụng vào gift_ecommerce hay giftly_verification_test!`);
  }
  assert.match(testDatabase, /^giftly_[a-z0-9_]*_test$/i, 'Test bắt buộc phải chạy trên database test chuyên biệt');

  const { resetTestDatabase } = require('../../scripts/resetTestDb');
  await resetTestDatabase(testDatabase, { seed: true });

  process.env.TEST_DB_NAME = testDatabase;
  process.env.DB_NAME = testDatabase;
  process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('base64url');
  process.env.ML_SERVICE_URL = '';
  process.env.VNPAY_TMN_CODE = 'GIFTLYTEST';
  process.env.VNPAY_HASH_SECRET = 'integration-only-dummy-secret-never-use-for-merchant';
  process.env.VNPAY_RETURN_URL = 'http://127.0.0.1/api/payments/vnpay/return';
  process.env.GHN_SHOP_ID = '98765';
  process.env.GHN_WEBHOOK_SECRET = 'cod-lifecycle-ghn-secret';

  const vnpay = require('../../services/payments/vnpay');
  process.env.VNPAY_PAYMENT_URL = vnpay.SANDBOX_URL;

  const pool = require('../../config/db');
  const { app } = require('../../server');

  let server;
  let userAId, tokenA, addressAId;
  let userBId, tokenB, addressBId;
  let adminId, adminToken;

  // Sản phẩm dùng cho test
  let pInStock1, pInStock2, pOutOfStock, pSingleUnit;
  let codOrderIdForCancel;
  let orderForFulfillmentId;

  try {
    const [[database]] = await pool.query('SELECT DATABASE() name');
    console.log(`[cod-order-lifecycle.test.js] SELECT DATABASE(): ${database.name}`);
    assert.equal(database.name, testDatabase, 'API phải kết nối chính xác tới TEST_DB_NAME');

    // Khởi tạo HTTP server trên cổng ngẫu nhiên (ephemeral port)
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

    let ghnEventOffset = 0;
    const sendGhnEvent = async (orderId, status) => {
      const [[order]] = await pool.query('SELECT order_code FROM orders WHERE id=?', [orderId]);
      const [[shipment]] = await pool.query("SELECT id FROM shipments WHERE order_id=? AND provider='GHN' LIMIT 1", [orderId]);
      if (!shipment) {
        await pool.execute("INSERT INTO shipments (order_id,client_order_code,provider,provider_order_code,status) VALUES (?,?,'GHN',?,'CREATED')", [orderId, order.order_code, `GHN-${order.order_code}`]);
      }
      const event = {
        OrderCode: `GHN-${order.order_code}`,
        ClientOrderCode: order.order_code,
        ShopID: process.env.GHN_SHOP_ID,
        Status: status,
        Type: 'switch_status',
        Time: new Date(Math.ceil(Date.now() / 1000) * 1000 + (++ghnEventOffset) * 1000).toISOString(),
      };
      return api('/shipments/ghn/webhook', {
        method: 'POST',
        body: event,
        headers: { 'x-giftly-shipping-secret': process.env.GHN_WEBHOOK_SECRET },
        expectStatus: 200,
      });
    };

    // 1. Tạo fixture người dùng: Khách A, Khách B, Admin
    const emailA = `customer-a-${crypto.randomUUID()}@example.invalid`;
    const passwordA = 'Password-2026!';
    const regA = await api('/auth/register', {
      method: 'POST',
      body: { fullName: 'Khách Hàng A', email: emailA, password: passwordA },
      expectStatus: 201,
    });
    userAId = regA.data.user.id;
    const loginA = await api('/auth/login', {
      method: 'POST',
      body: { email: emailA, password: passwordA },
      expectStatus: 200,
    });
    tokenA = loginA.data.token;

    const emailB = `customer-b-${crypto.randomUUID()}@example.invalid`;
    const passwordB = 'Password-2026!';
    const regB = await api('/auth/register', {
      method: 'POST',
      body: { fullName: 'Khách Hàng B', email: emailB, password: passwordB },
      expectStatus: 201,
    });
    userBId = regB.data.user.id;
    const loginB = await api('/auth/login', {
      method: 'POST',
      body: { email: emailB, password: passwordB },
      expectStatus: 200,
    });
    tokenB = loginB.data.token;

    const emailAdmin = `admin-${crypto.randomUUID()}@example.invalid`;
    const passwordAdmin = 'Password-2026!';
    const regAdmin = await api('/auth/register', {
      method: 'POST',
      body: { fullName: 'Quản Trị Viên', email: emailAdmin, password: passwordAdmin },
      expectStatus: 201,
    });
    adminId = regAdmin.data.user.id;
    await pool.execute("UPDATE users SET role='ADMIN' WHERE id=?", [adminId]);
    const loginAdmin = await api('/auth/login', {
      method: 'POST',
      body: { email: emailAdmin, password: passwordAdmin },
      expectStatus: 200,
    });
    adminToken = loginAdmin.data.token;

    // Lưu địa chỉ giao hàng cho Khách A và Khách B
    const addrResA = await api('/account/addresses', {
      method: 'POST',
      auth: tokenA,
      body: {
        recipientName: 'Khách A',
        phone: '0901234567',
        addressLine: '123 Lê Lợi',
        ward: 'Bến Nghé',
        district: 'Quận 1',
        city: 'TP. Hồ Chí Minh',
      },
      expectStatus: 201,
    });
    addressAId = addrResA.data.id;

    const addrResB = await api('/account/addresses', {
      method: 'POST',
      auth: tokenB,
      body: {
        recipientName: 'Khách B',
        phone: '0909876543',
        addressLine: '456 Nguyễn Huệ',
        ward: 'Bến Nghé',
        district: 'Quận 1',
        city: 'TP. Hồ Chí Minh',
      },
      expectStatus: 201,
    });
    addressBId = addrResB.data.id;

    // 2. Chuẩn bị các sản phẩm kiểm thử biệt lập trong test DB
    const [cRows] = await pool.query('SELECT id FROM categories LIMIT 1');
    const categoryId = cRows[0].id;

    const [prod1] = await pool.query(
      `INSERT INTO products (name, category_id, price, stock, status)
       VALUES ('Hộp quà test A', ?, 100000, 10, 'ACTIVE')`,
      [categoryId]
    );
    pInStock1 = prod1.insertId;

    const [prod2] = await pool.query(
      `INSERT INTO products (name, category_id, price, stock, status)
       VALUES ('Hộp quà test B', ?, 150000, 5, 'ACTIVE')`,
      [categoryId]
    );
    pInStock2 = prod2.insertId;

    const [prod3] = await pool.query(
      `INSERT INTO products (name, category_id, price, stock, status)
       VALUES ('Hộp quà test hết hàng', ?, 200000, 0, 'ACTIVE')`,
      [categoryId]
    );
    pOutOfStock = prod3.insertId;

    const [prod4] = await pool.query(
      `INSERT INTO products (name, category_id, price, stock, status)
       VALUES ('Hộp quà duy nhất 1 chiếc', ?, 300000, 1, 'ACTIVE')`,
      [categoryId]
    );
    pSingleUnit = prod4.insertId;

    // =========================================================================
    // TRƯỜNG HỢP 1: COD đủ hàng -> Tạo đơn thành công, tự động chuyển PROCESSING, UNPAID, trừ kho đúng
    // =========================================================================
    await t.test('1. COD đủ hàng: tạo đơn thành công, tự động chuyển PROCESSING, UNPAID, trừ kho đúng', async () => {
      const [[stockBefore]] = await pool.query('SELECT stock FROM products WHERE id=?', [pInStock1]);
      assert.equal(Number(stockBefore.stock), 10);

      // Khách A thêm sản phẩm 1 (số lượng 2) vào giỏ
      await api('/cart/items', {
        method: 'POST',
        auth: tokenA,
        body: { productId: String(pInStock1), quantity: 2 },
        expectStatus: 201,
      });

      // Đặt hàng COD
      const orderRes = await api('/orders', {
        method: 'POST',
        auth: tokenA,
        body: { addressId: addressAId, paymentMethod: 'COD', shippingMethod: 'STANDARD' },
        expectStatus: 201,
      });

      assert.equal(orderRes.data.status, 'PROCESSING');
      assert.equal(orderRes.data.paymentMethod, 'COD');
      const orderId = orderRes.data.orderId;

      // Kiểm tra trong DB
      const [[orderDb]] = await pool.query('SELECT * FROM orders WHERE id=?', [orderId]);
      assert.equal(orderDb.status, 'PROCESSING');
      assert.equal(orderDb.payment_status, 'UNPAID');
      assert.equal(orderDb.payment_method, 'COD');

      // Tồn kho bị trừ chính xác 2 đơn vị
      const [[stockAfter]] = await pool.query('SELECT stock FROM products WHERE id=?', [pInStock1]);
      assert.equal(Number(stockAfter.stock), 8);

      // Kiểm tra inventory_movements
      const [movements] = await pool.query('SELECT * FROM inventory_movements WHERE order_id=?', [orderId]);
      assert.equal(movements.length, 1);
      assert.equal(Number(movements[0].quantity_delta), -2);
      assert.equal(movements[0].reason, 'Đơn hàng của khách');

      // Kiểm tra order_status_history: có 2 bước: CONFIRMED (Khách đặt hàng) -> PROCESSING (Kho còn hàng)
      const [history] = await pool.query('SELECT * FROM order_status_history WHERE order_id=? ORDER BY id ASC', [orderId]);
      assert.equal(history.length, 2);
      assert.equal(history[0].to_status, 'CONFIRMED');
      assert.equal(history[0].note, 'Khách đặt hàng');
      assert.equal(history[1].from_status, 'CONFIRMED');
      assert.equal(history[1].to_status, 'PROCESSING');
      assert.equal(history[1].note, 'Đã giữ hàng, tự động chuyển sang chuẩn bị hàng');

      // Giỏ hàng món đã chọn bị xóa
      const [cartItems] = await pool.query('SELECT * FROM cart_items WHERE user_id=?', [userAId]);
      assert.equal(cartItems.length, 0);
    });

    // =========================================================================
    // TRƯỜNG HỢP 2: COD thiếu hàng -> Từ chối, không tạo đơn, không trừ kho
    // =========================================================================
    await t.test('2. COD thiếu hàng: từ chối, không tạo đơn, không trừ kho', async () => {
      // Thêm sản phẩm vào giỏ khi còn 1 chiếc
      await pool.query('UPDATE products SET stock=1 WHERE id=?', [pOutOfStock]);
      await api('/cart/items', {
        method: 'POST',
        auth: tokenA,
        body: { productId: String(pOutOfStock), quantity: 1 },
        expectStatus: 201,
      });

      // Giả lập kho bị người khác mua hết trước khi khách A nhấn Đặt hàng
      await pool.query('UPDATE products SET stock=0 WHERE id=?', [pOutOfStock]);

      // Khách A nhấn Đặt hàng COD
      const failRes = await api('/orders', {
        method: 'POST',
        auth: tokenA,
        body: { addressId: addressAId, paymentMethod: 'COD', shippingMethod: 'STANDARD' },
        expectStatus: 409,
      });

      assert.match(failRes.message, /trong kho/i);

      // Không có đơn hàng nào được tạo
      const [orders] = await pool.query(
        'SELECT o.* FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE oi.product_id=?',
        [pOutOfStock]
      );
      assert.equal(orders.length, 0);

      // Tồn kho giữ nguyên 0
      const [[stockAfter]] = await pool.query('SELECT stock FROM products WHERE id=?', [pOutOfStock]);
      assert.equal(Number(stockAfter.stock), 0);

      // Dọn giỏ
      await pool.query('DELETE FROM cart_items WHERE user_id=?', [userAId]);
    });

    // =========================================================================
    // TRƯỜNG HỢP 3: Nhiều sản phẩm, một sản phẩm thiếu hàng -> Toàn bộ đơn thất bại
    // =========================================================================
    await t.test('3. Nhiều sản phẩm, một sản phẩm thiếu hàng: toàn bộ đơn thất bại', async () => {
      const [[stockP2Before]] = await pool.query('SELECT stock FROM products WHERE id=?', [pInStock2]);
      assert.equal(Number(stockP2Before.stock), 5);

      // Thêm Product 2 (còn 5)
      await api('/cart/items', {
        method: 'POST',
        auth: tokenA,
        body: { productId: String(pInStock2), quantity: 1 },
        expectStatus: 201,
      });

      // Thêm Product 3 khi tạm có 1 chiếc
      await pool.query('UPDATE products SET stock=1 WHERE id=?', [pOutOfStock]);
      await api('/cart/items', {
        method: 'POST',
        auth: tokenA,
        body: { productId: String(pOutOfStock), quantity: 1 },
        expectStatus: 201,
      });

      // Đột ngột Product 3 hết hàng (stock = 0)
      await pool.query('UPDATE products SET stock=0 WHERE id=?', [pOutOfStock]);

      const failRes = await api('/orders', {
        method: 'POST',
        auth: tokenA,
        body: { addressId: addressAId, paymentMethod: 'COD', shippingMethod: 'STANDARD' },
        expectStatus: 409,
      });
      assert.match(failRes.message, /trong kho/i);

      // Rollback nguyên vẹn: Product 2 không bị trừ một phần (vẫn giữ nguyên 5)!
      const [[stockP2After]] = await pool.query('SELECT stock FROM products WHERE id=?', [pInStock2]);
      assert.equal(Number(stockP2After.stock), 5);

      // Dọn giỏ
      await pool.query('DELETE FROM cart_items WHERE user_id=?', [userAId]);
    });

    // =========================================================================
    // TRƯỜNG HỢP 4: Hai khách đồng thời mua sản phẩm chỉ còn 1 đơn vị -> Chỉ 1 đơn thành công
    // =========================================================================
    await t.test('4. Hai khách đồng thời mua sản phẩm chỉ còn một đơn vị: chỉ một đơn thành công', async () => {
      const [[stockBefore]] = await pool.query('SELECT stock FROM products WHERE id=?', [pSingleUnit]);
      assert.equal(Number(stockBefore.stock), 1);

      // Khách A thêm Product 4
      await api('/cart/items', {
        method: 'POST',
        auth: tokenA,
        body: { productId: String(pSingleUnit), quantity: 1 },
        expectStatus: 201,
      });

      // Khách B thêm Product 4
      await api('/cart/items', {
        method: 'POST',
        auth: tokenB,
        body: { productId: String(pSingleUnit), quantity: 1 },
        expectStatus: 201,
      });

      // Gửi đồng thời hai request đặt hàng
      const [resA, resB] = await Promise.all([
        api('/orders', {
          method: 'POST',
          auth: tokenA,
          body: { addressId: addressAId, paymentMethod: 'COD', shippingMethod: 'STANDARD' },
        }),
        api('/orders', {
          method: 'POST',
          auth: tokenB,
          body: { addressId: addressBId, paymentMethod: 'COD', shippingMethod: 'STANDARD' },
        }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      assert.deepEqual(statuses, [201, 409], 'Đúng 1 đơn thành công (201) và đúng 1 đơn bị từ chối (409)');

      // Tồn kho còn đúng 0, KHÔNG bao giờ bị âm
      const [[stockAfter]] = await pool.query('SELECT stock FROM products WHERE id=?', [pSingleUnit]);
      assert.equal(Number(stockAfter.stock), 0);

      // Đúng 1 bản ghi biến động kho
      const [movements] = await pool.query('SELECT * FROM inventory_movements WHERE product_id=?', [pSingleUnit]);
      assert.equal(movements.length, 1);
      assert.equal(Number(movements[0].quantity_delta), -1);

      // Dọn giỏ
      await pool.query('DELETE FROM cart_items WHERE user_id IN (?, ?)', [userAId, userBId]);
    });

    // =========================================================================
    // TRƯỜNG HỢP 5: Khách hủy PENDING -> Thành công và hoàn kho
    // =========================================================================
    await t.test('5. Khách hủy PENDING: thành công và hoàn kho', async () => {
      // Đặt đơn VNPAY (khởi tạo ở trạng thái PENDING, UNPAID)
      await api('/cart/items', {
        method: 'POST',
        auth: tokenA,
        body: { productId: String(pInStock2), quantity: 1 },
        expectStatus: 201,
      });
      const pendingOrderRes = await api('/orders', {
        method: 'POST',
        auth: tokenA,
        body: { addressId: addressAId, paymentMethod: 'VNPAY', shippingMethod: 'STANDARD' },
        expectStatus: 201,
      });
      assert.equal(pendingOrderRes.data.status, 'PENDING');
      const pendingOrderId = pendingOrderRes.data.orderId;

      const [[stockAfterOrder]] = await pool.query('SELECT stock FROM products WHERE id=?', [pInStock2]);
      assert.equal(Number(stockAfterOrder.stock), 4); // 5 - 1 = 4

      // Khách A hủy đơn PENDING
      const cancelRes = await api(`/orders/${pendingOrderId}/cancel`, {
        method: 'POST',
        auth: tokenA,
        expectStatus: 200,
      });
      assert.equal(cancelRes.body.success, true);

      // Trạng thái đơn đổi thành CANCELLED
      const [[orderDb]] = await pool.query('SELECT status FROM orders WHERE id=?', [pendingOrderId]);
      assert.equal(orderDb.status, 'CANCELLED');

      // Tồn kho được hoàn lại đầy đủ: 4 + 1 = 5
      const [[stockAfterCancel]] = await pool.query('SELECT stock FROM products WHERE id=?', [pInStock2]);
      assert.equal(Number(stockAfterCancel.stock), 5);

      // Lịch sử biến động kho ghi nhận hoàn kho
      const [cancelMovements] = await pool.query(
        'SELECT * FROM inventory_movements WHERE order_id=? AND reason=\'Hủy đơn; hoàn tồn kho\'',
        [pendingOrderId]
      );
      assert.equal(cancelMovements.length, 1);
      assert.equal(Number(cancelMovements[0].quantity_delta), 1);
    });

    // =========================================================================
    // TRƯỜNG HỢP 6: Khách hủy CONFIRMED, UNPAID (đơn COD) -> Thành công và hoàn kho
    // =========================================================================
    await t.test('6. Khách hủy CONFIRMED, UNPAID: thành công và hoàn kho', async () => {
      await api('/cart/items', {
        method: 'POST',
        auth: tokenA,
        body: { productId: String(pInStock2), quantity: 2 },
        expectStatus: 201,
      });
      const codRes = await api('/orders', {
        method: 'POST',
        auth: tokenA,
        body: { addressId: addressAId, paymentMethod: 'COD', shippingMethod: 'STANDARD' },
        expectStatus: 201,
      });
      assert.equal(codRes.data.status, 'PROCESSING');
      codOrderIdForCancel = codRes.data.orderId;

      // Kho: 5 - 2 = 3
      const [[stockAfterOrder]] = await pool.query('SELECT stock FROM products WHERE id=?', [pInStock2]);
      assert.equal(Number(stockAfterOrder.stock), 3);

      // Khách A hủy đơn COD (PROCESSING + UNPAID, chưa bàn giao shipper)
      const cancelRes = await api(`/orders/${codOrderIdForCancel}/cancel`, {
        method: 'POST',
        auth: tokenA,
        expectStatus: 200,
      });
      assert.equal(cancelRes.body.success, true);

      // Trạng thái đơn thành CANCELLED
      const [[orderDb]] = await pool.query('SELECT status FROM orders WHERE id=?', [codOrderIdForCancel]);
      assert.equal(orderDb.status, 'CANCELLED');

      // Tồn kho được hoàn lại: 3 + 2 = 5
      const [[stockAfterCancel]] = await pool.query('SELECT stock FROM products WHERE id=?', [pInStock2]);
      assert.equal(Number(stockAfterCancel.stock), 5);

      // Lịch sử trạng thái ghi 'Khách hủy đơn'
      const [hist] = await pool.query(
        'SELECT * FROM order_status_history WHERE order_id=? AND to_status=\'CANCELLED\'',
        [codOrderIdForCancel]
      );
      assert.equal(hist.length, 1);
      assert.equal(hist[0].from_status, 'PROCESSING');
      assert.equal(hist[0].note, 'Khách hủy đơn');
    });

    // =========================================================================
    // TRƯỜNG HỢP 7: Khách hủy đơn đã bàn giao vận chuyển (SHIPPED) -> Bị từ chối
    // =========================================================================
    await t.test('7. Khách hủy đơn đã bàn giao vận chuyển: bị từ chối', async () => {
      await api('/cart/items', {
        method: 'POST',
        auth: tokenA,
        body: { productId: String(pInStock2), quantity: 1 },
        expectStatus: 201,
      });
      const orderRes = await api('/orders', {
        method: 'POST',
        auth: tokenA,
        body: { addressId: addressAId, paymentMethod: 'COD', shippingMethod: 'STANDARD' },
        expectStatus: 201,
      });
      const shippedOrderId = orderRes.data.orderId;

      // GHN webhook hợp lệ cập nhật trạng thái đã bàn giao vận chuyển.
      await sendGhnEvent(shippedOrderId, 'delivering');

      // Khách cố gắng hủy đơn đã bàn giao shipper
      const failCancel = await api(`/orders/${shippedOrderId}/cancel`, {
        method: 'POST',
        auth: tokenA,
        expectStatus: 409,
      });
      assert.match(failCancel.message, /cancelled by the customer|đơn vị vận chuyển/i);

      // Đơn hàng vẫn giữ nguyên SHIPPED
      const [[orderDb]] = await pool.query('SELECT status FROM orders WHERE id=?', [shippedOrderId]);
      assert.equal(orderDb.status, 'SHIPPED');
    });

    // =========================================================================
    // TRƯỜNG HỢP 8: Khách hủy đơn của người khác -> Bị từ chối 404
    // =========================================================================
    await t.test('8. Khách hủy đơn của người khác: bị từ chối', async () => {
      // Tạo đơn cho Khách A
      await api('/cart/items', {
        method: 'POST',
        auth: tokenA,
        body: { productId: String(pInStock2), quantity: 1 },
        expectStatus: 201,
      });
      const orderRes = await api('/orders', {
        method: 'POST',
        auth: tokenA,
        body: { addressId: addressAId, paymentMethod: 'COD', shippingMethod: 'STANDARD' },
        expectStatus: 201,
      });
      const userAOrderId = orderRes.data.orderId;

      // Khách B cố tình hủy đơn của Khách A
      await api(`/orders/${userAOrderId}/cancel`, {
        method: 'POST',
        auth: tokenB,
        expectStatus: 404,
      });

      // Trạng thái đơn của Khách A không đổi
      const [[orderDb]] = await pool.query('SELECT status FROM orders WHERE id=?', [userAOrderId]);
      assert.equal(orderDb.status, 'PROCESSING');
    });

    // =========================================================================
    // TRƯỜNG HỢP 9: Gửi API hủy 2 lần tuần tự -> Chỉ hoàn kho đúng 1 lần
    // =========================================================================
    await t.test('9. Gửi API hủy hai lần: chỉ hoàn kho một lần', async () => {
      // Lấy đơn của TRƯỜNG HỢP 6 đã bị hủy
      const stockBeforeSecondCancel = (await pool.query('SELECT stock FROM products WHERE id=?', [pInStock2]))[0][0].stock;

      // Gửi request hủy lần 2 cho đơn đã hủy
      const secondCancel = await api(`/orders/${codOrderIdForCancel}/cancel`, {
        method: 'POST',
        auth: tokenA,
        expectStatus: 409,
      });
      assert.match(secondCancel.message, /cancelled by the customer/i);

      // Tồn kho không bị tăng lần 2!
      const stockAfterSecondCancel = (await pool.query('SELECT stock FROM products WHERE id=?', [pInStock2]))[0][0].stock;
      assert.equal(Number(stockAfterSecondCancel), Number(stockBeforeSecondCancel));

      // Đúng 1 lần hoàn kho trong inventory_movements
      const [cancelMovements] = await pool.query(
        'SELECT * FROM inventory_movements WHERE order_id=? AND reason=\'Hủy đơn; hoàn tồn kho\'',
        [codOrderIdForCancel]
      );
      assert.equal(cancelMovements.length, 1);
    });

    // =========================================================================
    // TRƯỜNG HỢP 10: Hai request hủy đồng thời -> Chỉ xử lý hoàn kho 1 lần
    // =========================================================================
    await t.test('10. Hai request hủy đồng thời: chỉ xử lý hoàn kho một lần', async () => {
      await api('/cart/items', {
        method: 'POST',
        auth: tokenA,
        body: { productId: String(pInStock1), quantity: 1 },
        expectStatus: 201,
      });
      const orderRes = await api('/orders', {
        method: 'POST',
        auth: tokenA,
        body: { addressId: addressAId, paymentMethod: 'COD', shippingMethod: 'STANDARD' },
        expectStatus: 201,
      });
      const raceOrderId = orderRes.data.orderId;

      const [[stockBeforeCancel]] = await pool.query('SELECT stock FROM products WHERE id=?', [pInStock1]);

      // Gửi 2 request hủy cùng lúc
      const [res1, res2] = await Promise.all([
        api(`/orders/${raceOrderId}/cancel`, { method: 'POST', auth: tokenA }),
        api(`/orders/${raceOrderId}/cancel`, { method: 'POST', auth: tokenA }),
      ]);

      const cancelStatuses = [res1.status, res2.status].sort();
      assert.deepEqual(cancelStatuses, [200, 409], 'Đúng 1 request hủy thành công (200) và 1 request thất bại (409)');

      // Tồn kho chỉ được cộng đúng 1 lần
      const [[stockAfterCancel]] = await pool.query('SELECT stock FROM products WHERE id=?', [pInStock1]);
      assert.equal(Number(stockAfterCancel.stock), Number(stockBeforeCancel.stock) + 1);

      // Chỉ có đúng 1 dòng hoàn kho
      const [movements] = await pool.query(
        'SELECT * FROM inventory_movements WHERE order_id=? AND reason=\'Hủy đơn; hoàn tồn kho\'',
        [raceOrderId]
      );
      assert.equal(movements.length, 1);
    });

    // =========================================================================
    // TRƯỜNG HỢP 11: Tự động chuyển CONFIRMED sang PROCESSING khi kho còn hàng
    // =========================================================================
    await t.test('11. Tự động chuyển CONFIRMED sang PROCESSING khi kho còn hàng', async () => {
      await api('/cart/items', {
        method: 'POST',
        auth: tokenA,
        body: { productId: String(pInStock1), quantity: 1 },
        expectStatus: 201,
      });
      const orderRes = await api('/orders', {
        method: 'POST',
        auth: tokenA,
        body: { addressId: addressAId, paymentMethod: 'COD', shippingMethod: 'STANDARD' },
        expectStatus: 201,
      });
      orderForFulfillmentId = orderRes.data.orderId;

      assert.equal(orderRes.data.status, 'PROCESSING');

      const [[orderDb]] = await pool.query('SELECT status FROM orders WHERE id=?', [orderForFulfillmentId]);
      assert.equal(orderDb.status, 'PROCESSING');

      // Kiểm tra order_status_history
      const [hist] = await pool.query(
        'SELECT * FROM order_status_history WHERE order_id=? AND to_status=\'PROCESSING\'',
        [orderForFulfillmentId]
      );
      assert.equal(hist.length, 1);
      assert.equal(hist[0].from_status, 'CONFIRMED');
      assert.equal(hist[0].note, 'Đã giữ hàng, tự động chuyển sang chuẩn bị hàng');
    });

    // =========================================================================
    // TRƯỜNG HỢP 12: Quy trình chuyển tiếp đến SHIPPED và DELIVERED
    // =========================================================================
    await t.test('12. Quy trình chuyển tiếp đến SHIPPED và DELIVERED', async () => {
      // PROCESSING -> SHIPPED do webhook GHN báo đang phát.
      await sendGhnEvent(orderForFulfillmentId, 'delivering');
      const shippedRes = await api(`/orders/${orderForFulfillmentId}`, { auth: tokenA, expectStatus: 200 });
      assert.equal(shippedRes.data.status, 'SHIPPED');

      // SHIPPED -> DELIVERED từ webhook GHN; COD được ghi nhận PAID khi giao thành công.
      await sendGhnEvent(orderForFulfillmentId, 'delivered');
      const deliveredRes = await api(`/orders/${orderForFulfillmentId}`, { auth: tokenA, expectStatus: 200 });
      assert.equal(deliveredRes.data.status, 'DELIVERED');
      assert.equal(deliveredRes.data.paymentStatus, 'PAID');

      // Xác minh trong DB: status = DELIVERED, payment_status = PAID
      const [[finalOrderDb]] = await pool.query('SELECT status, payment_status FROM orders WHERE id=?', [
        orderForFulfillmentId,
      ]);
      assert.equal(finalOrderDb.status, 'DELIVERED');
      assert.equal(finalOrderDb.payment_status, 'PAID');

      // Kiểm tra không được chuyển ngược trái quy tắc: DELIVERED -> SHIPPED bị từ chối 409
      await api(`/admin/orders/${orderForFulfillmentId}/status`, {
        method: 'PATCH',
        auth: adminToken,
        body: { status: 'SHIPPED' },
        expectStatus: 409,
      });

      // Kiểm tra đơn DELIVERED không thể hủy: DELIVERED -> CANCELLED bị từ chối 409
      await api(`/admin/orders/${orderForFulfillmentId}/status`, {
        method: 'PATCH',
        auth: adminToken,
        body: { status: 'CANCELLED' },
        expectStatus: 409,
      });
    });

    // Kết thúc thành công toàn bộ 12 ca kiểm thử
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    try {
      await pool.end();
      delete require.cache[require.resolve('../../config/db')];
    } catch {
      // Bỏ qua lỗi đóng pool
    }
  }
});
