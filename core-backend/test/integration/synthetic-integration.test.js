'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const testDatabase = (process.env.TEST_DB_NAME || 'giftly_e2e_test').trim();

test('Khu vực 2b: Xác minh tích hợp SQL thật cho quy tắc chặn sản phẩm synthetic (is_synthetic_display = TRUE)', {
  skip: testDatabase ? false : 'Set TEST_DB_NAME to giftly_e2e_test'
}, async (t) => {
  // 1. Kiểm tra an toàn: từ chối nếu NODE_ENV=production hoặc DB không hợp lệ
  if (process.env.NODE_ENV === 'production') {
    throw new Error('TỪ CHỐI CHẠY: Không thể chạy test ghi dữ liệu trên NODE_ENV=production');
  }
  if (!testDatabase.endsWith('_test') || testDatabase === 'gift_ecommerce' || testDatabase === 'giftly_verification_test') {
    throw new Error(`TỪ CHỐI CHẠY: Database "${testDatabase}" không hợp lệ. Bắt buộc kết thúc bằng "_test" và tuyệt đối không đụng vào gift_ecommerce hay giftly_verification_test!`);
  }
  assert.match(testDatabase, /^giftly_[a-z0-9_]*_test$/i, 'Test bắt buộc phải chạy trên database test chuyên biệt');

  // Khởi tạo lại database test sạch
  const { resetTestDatabase } = require('../../scripts/resetTestDb');
  await resetTestDatabase(testDatabase, { seed: true });

  process.env.TEST_DB_NAME = testDatabase;
  process.env.DB_NAME = testDatabase;
  process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('base64url');
  process.env.ML_SERVICE_URL = '';

  const pool = require('../../config/db');
  const { app } = require('../../server');

  let server;
  let normalUserId, normalToken, normalAddressId;
  let demoUserId, demoToken;
  let syntheticProductId, realProductId;

  try {
    const [[database]] = await pool.query('SELECT DATABASE() name');
    console.log(`[synthetic-integration.test.js] SELECT DATABASE(): ${database.name}`);
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
          `${method} ${path}: mong đợi HTTP ${expectStatus}, nhận ${response.status} (${json.message || ''})`
        );
      }
      return { status: response.status, data: json.data, message: json.message, body: json };
    };

    // Chuẩn bị người dùng bình thường (không có ml_user_id)
    const emailNormal = `normal-user-${crypto.randomUUID()}@example.invalid`;
    const regNormal = await api('/auth/register', {
      method: 'POST',
      body: { fullName: 'Khách Thường Test', email: emailNormal, password: 'Password-2026!' },
      expectStatus: 201,
    });
    normalUserId = regNormal.data.user.id;
    const loginNormal = await api('/auth/login', {
      method: 'POST',
      body: { email: emailNormal, password: 'Password-2026!' },
      expectStatus: 200,
    });
    normalToken = loginNormal.data.token;

    // Chuẩn bị người dùng demo (có ml_user_id)
    const emailDemo = `demo-user-${crypto.randomUUID()}@example.invalid`;
    const regDemo = await api('/auth/register', {
      method: 'POST',
      body: { fullName: 'Khách Demo REES', email: emailDemo, password: 'Password-2026!' },
      expectStatus: 201,
    });
    demoUserId = regDemo.data.user.id;
    await pool.execute('UPDATE users SET ml_user_id = 888888 WHERE id = ?', [demoUserId]);
    const loginDemo = await api('/auth/login', {
      method: 'POST',
      body: { email: emailDemo, password: 'Password-2026!' },
      expectStatus: 200,
    });
    demoToken = loginDemo.data.token;

    // Địa chỉ nhận hàng
    const addrRes = await api('/account/addresses', {
      method: 'POST',
      auth: normalToken,
      body: {
        recipientName: 'Khách Thường',
        phone: '0912345678',
        addressLine: '100 Nguyễn Huệ',
        ward: 'Bến Nghé',
        district: 'Quận 1',
        city: 'TP. Hồ Chí Minh',
      },
      expectStatus: 201,
    });
    normalAddressId = addrRes.data.id;

    // Lấy 1 category_id có sẵn
    const [cats] = await pool.query('SELECT id FROM categories LIMIT 1');
    const categoryId = cats[0].id;

    // Tạo 1 sản phẩm synthetic (is_synthetic_display = TRUE, stock = 20)
    const [pSynth] = await pool.query(`
      INSERT INTO products (name, category_id, price, stock, status, is_synthetic_display, style, gift_type)
      VALUES ('Tai nghe Bluetooth REES Demo', ?, 250000, 20, 'ACTIVE', TRUE, 'modern', 'tech')
    `, [categoryId]);
    syntheticProductId = pSynth.insertId;

    // Tạo 1 sản phẩm thật (is_synthetic_display = FALSE, stock = 15)
    const [pReal] = await pool.query(`
      INSERT INTO products (name, category_id, price, stock, status, is_synthetic_display, style, gift_type)
      VALUES ('Hộp quà sinh nhật thật', ?, 180000, 15, 'ACTIVE', FALSE, 'classic', 'gift-box')
    `, [categoryId]);
    realProductId = pReal.insertId;

    // -------------------------------------------------------------
    // SUBTEST 1: Tạo đơn có sản phẩm synthetic bị từ chối và KHÔNG trừ kho
    // -------------------------------------------------------------
    await t.test('1. Tạo đơn với sản phẩm synthetic bị từ chối và không trừ kho', async () => {
      // Đưa trực tiếp sản phẩm synthetic vào giỏ hàng
      await pool.query(
        'INSERT INTO cart_items (user_id, product_id, quantity, is_selected) VALUES (?, ?, 2, 1)',
        [normalUserId, syntheticProductId]
      );

      // Thử tạo đơn -> API từ chối 409 do quote validation phát hiện synthetic
      const orderRes = await api('/orders', {
        method: 'POST',
        auth: normalToken,
        body: {
          addressId: normalAddressId,
          paymentMethod: 'COD',
          shippingMethod: 'STANDARD'
        },
        expectStatus: 409
      });

      assert.equal(orderRes.status, 409);
      assert.match(orderRes.message, /mẫu thử nghiệm, không hỗ trợ đặt hàng/);

      // Xác minh DB: KHÔNG có đơn nào được tạo
      const [[orderCount]] = await pool.query('SELECT COUNT(*) total FROM orders WHERE user_id=?', [normalUserId]);
      assert.equal(orderCount.total, 0, 'Không được tạo bất kỳ đơn hàng nào');

      // Xác minh DB: Kho sản phẩm synthetic giữ nguyên 20 (không bị trừ 2)
      const [[synthProd]] = await pool.query('SELECT stock FROM products WHERE id=?', [syntheticProductId]);
      assert.equal(synthProd.stock, 20, 'Tồn kho sản phẩm synthetic phải giữ nguyên 20');
    });

    // -------------------------------------------------------------
    // SUBTEST 2: /orders/quote từ chối khi giỏ có sản phẩm synthetic
    // -------------------------------------------------------------
    await t.test('2. /orders/quote từ chối (400) khi giỏ chứa sản phẩm synthetic', async () => {
      const quoteRes = await api('/orders/quote', {
        method: 'POST',
        auth: normalToken,
        body: {
          addressId: normalAddressId,
          shippingMethod: 'STANDARD'
        },
        expectStatus: 400
      });

      assert.equal(quoteRes.status, 400);
      assert.match(quoteRes.message, /mẫu thử nghiệm, không hỗ trợ đặt hàng/);
      assert.equal(quoteRes.data.productId, syntheticProductId);
    });

    // -------------------------------------------------------------
    // SUBTEST 3: favorites từ chối với user thường, cho phép demo user
    // -------------------------------------------------------------
    await t.test('3. favorites từ chối (404) với khách thường, cho phép khách demo REES46', async () => {
      // Khách thường thử favorite sản phẩm synthetic -> Bị từ chối 404
      const favNormalRes = await api(`/account/favorites/${syntheticProductId}`, {
        method: 'PUT',
        auth: normalToken,
        expectStatus: 404
      });
      assert.equal(favNormalRes.status, 404);
      assert.match(favNormalRes.message, /Product not found/i);

      const [[favNormalCount]] = await pool.query('SELECT COUNT(*) total FROM favorites WHERE user_id=? AND product_id=?', [normalUserId, syntheticProductId]);
      assert.equal(favNormalCount.total, 0, 'Khách thường không được lưu synthetic vào favorites');

      // Khách demo REES46 favorite sản phẩm synthetic -> Thành công
      const favDemoRes = await api(`/account/favorites/${syntheticProductId}`, {
        method: 'PUT',
        auth: demoToken,
        expectStatus: 200
      });
      assert.equal(favDemoRes.status, 200);

      const [[favDemoCount]] = await pool.query('SELECT COUNT(*) total FROM favorites WHERE user_id=? AND product_id=?', [demoUserId, syntheticProductId]);
      assert.equal(favDemoCount.total, 1, 'Khách demo phải lưu được synthetic vào favorites');
    });

    // -------------------------------------------------------------
    // SUBTEST 4: /products/events từ chối với user thường, cho phép demo user
    // -------------------------------------------------------------
    await t.test('4. /products/events từ chối (404) với khách thường, cho phép khách demo REES46', async () => {
      // Khách thường gửi event cho sản phẩm synthetic -> Bị từ chối 404
      const evNormalRes = await api('/products/events', {
        method: 'POST',
        auth: normalToken,
        body: {
          eventType: 'RECOMMENDATION_CLICK',
          productId: syntheticProductId
        },
        expectStatus: 404
      });
      assert.equal(evNormalRes.status, 404);

      const [[evNormalCount]] = await pool.query('SELECT COUNT(*) total FROM product_events WHERE user_id=? AND product_id=?', [normalUserId, syntheticProductId]);
      assert.equal(evNormalCount.total, 0, 'Không được ghi nhận event của khách thường cho sản phẩm synthetic');

      // Khách demo gửi event cho sản phẩm synthetic -> Chấp nhận 202
      const evDemoRes = await api('/products/events', {
        method: 'POST',
        auth: demoToken,
        body: {
          eventType: 'RECOMMENDATION_CLICK',
          productId: syntheticProductId
        },
        expectStatus: 202
      });
      assert.equal(evDemoRes.status, 202);

      const [[evDemoCount]] = await pool.query("SELECT COUNT(*) total FROM product_events WHERE user_id=? AND product_id=? AND event_type='RECOMMENDATION_CLICK'", [demoUserId, syntheticProductId]);
      assert.equal(evDemoCount.total, 1, 'Khách demo phải ghi nhận được event cho sản phẩm synthetic');
    });

    // -------------------------------------------------------------
    // SUBTEST 5: Mua lại (reorder) bỏ qua sản phẩm synthetic và không trừ kho
    // -------------------------------------------------------------
    await t.test('5. Mua lại (reorder) bỏ qua sản phẩm synthetic và không trừ kho', async () => {
      // Tạo một đơn hàng lịch sử có 1 sản phẩm thật và 1 sản phẩm synthetic
      const shippingAddressJson = JSON.stringify({
        recipientName: 'Khách Thường',
        phone: '0912345678',
        addressLine: '100 Nguyễn Huệ',
        city: 'TP. Hồ Chí Minh'
      });
      const [orderResult] = await pool.query(`
        INSERT INTO orders (user_id, order_code, recipient_name, phone, shipping_address, status, payment_status, payment_method, shipping_method, subtotal, shipping_fee, discount_amount, total_amount)
        VALUES (?, 'GIFT-REORDER-TEST', 'Khách Thường', '0912345678', ?, 'DELIVERED', 'PAID', 'COD', 'STANDARD', 430000, 30000, 0, 460000)
      `, [normalUserId, shippingAddressJson]);
      const pastOrderId = orderResult.insertId;

      await pool.query(`
        INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
        VALUES
          (?, ?, 'Tai nghe Bluetooth REES Demo', 250000, 1, 250000),
          (?, ?, 'Hộp quà sinh nhật thật', 180000, 1, 180000)
      `, [pastOrderId, syntheticProductId, pastOrderId, realProductId]);

      // Dọn sạch giỏ hàng trước khi reorder
      await pool.query('DELETE FROM cart_items WHERE user_id=?', [normalUserId]);

      // Gửi yêu cầu mua lại
      const reorderRes = await api(`/orders/${pastOrderId}/reorder`, {
        method: 'POST',
        auth: normalToken,
        expectStatus: 200
      });

      assert.equal(reorderRes.status, 200);
      assert.equal(reorderRes.data.addedCount, 1, 'Chỉ 1 sản phẩm thật được thêm vào giỏ');
      assert.equal(reorderRes.data.skippedCount, 1, '1 sản phẩm synthetic bị bỏ qua');
      assert.equal(reorderRes.data.addedItems[0].productId, String(realProductId));
      assert.equal(reorderRes.data.skippedItems[0].productId, String(syntheticProductId));
      assert.match(reorderRes.data.skippedItems[0].reason, /mẫu thử nghiệm, không hỗ trợ mua lại/);

      // Kiểm tra giỏ hàng trong DB: chỉ chứa sản phẩm thật, KHÔNG chứa sản phẩm synthetic
      const [cartRows] = await pool.query('SELECT product_id, quantity FROM cart_items WHERE user_id=?', [normalUserId]);
      assert.equal(cartRows.length, 1);
      assert.equal(cartRows[0].product_id, realProductId);

      // Kiểm tra kho của sản phẩm synthetic: vẫn nguyên vẹn 20
      const [[synthStock]] = await pool.query('SELECT stock FROM products WHERE id=?', [syntheticProductId]);
      assert.equal(synthStock.stock, 20, 'Tồn kho sản phẩm synthetic không được suy giảm khi reorder');
    });

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      await pool.end();
      delete require.cache[require.resolve('../../config/db')];
    } catch {
      // ignore
    }
  }
});
