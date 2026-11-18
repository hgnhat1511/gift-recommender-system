/**
 * order-contract.test.js
 * Unit/Contract tests thuần cho hợp đồng dữ liệu đơn hàng (POST /orders):
 * - orderContract.js (parseCreateOrderBody, SUPPORTED_SHIPPING_METHODS, SUPPORTED_PAYMENT_METHODS)
 *
 * Kiểm tra cấu trúc payload gửi lên backend, các ràng buộc dữ liệu đầu vào và Idempotency-Key.
 * Chạy độc lập 100% không cần database (Code thật hai phía).
 */
'use strict';

const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCreateOrderBody,
  SUPPORTED_SHIPPING_METHODS,
  SUPPORTED_PAYMENT_METHODS
} = require('../utils/orderContract');

let frontend;

describe('Contract: Order Checkout Endpoint (POST /orders)', () => {
  before(async () => {
    frontend = await import('../../core-frontend/src/lib/cartPayloads.js');
  });

  test('1. Payload hợp lệ tạo từ buildCreateOrderPayload (CommercePages.jsx)', () => {
    const payload = frontend.buildCreateOrderPayload({
      addressId: 3,
      shippingMethod: 'STANDARD',
      paymentMethod: 'COD',
      couponCode: 'TET2026',
      note: 'Giao trong giờ hành chính'
    });
    const parsed = parseCreateOrderBody(payload, 'req-key-12345678');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.addressId, '3');
    assert.equal(parsed.shippingMethod, 'STANDARD');
    assert.equal(parsed.paymentMethod, 'COD');
    assert.equal(parsed.couponCode, 'TET2026');
    assert.equal(parsed.note, 'Giao trong giờ hành chính');
    assert.equal(parsed.idempotencyKey, 'req-key-12345678');
  });

  test('2. Hỗ trợ phương thức thanh toán và vận chuyển đúng hợp đồng', () => {
    assert.deepEqual(SUPPORTED_SHIPPING_METHODS, ['STANDARD', 'EXPRESS']);
    assert.deepEqual(SUPPORTED_PAYMENT_METHODS, ['COD', 'VNPAY', 'MOMO']);

    const expressOrder = parseCreateOrderBody({ addressId: 1, shippingMethod: 'EXPRESS', paymentMethod: 'VNPAY' });
    assert.equal(expressOrder.ok, true);
    assert.equal(expressOrder.shippingMethod, 'EXPRESS');
    assert.equal(expressOrder.paymentMethod, 'VNPAY');
  });

  test('3. Từ chối addressId rỗng hoặc không phải số', () => {
    assert.equal(parseCreateOrderBody({ addressId: '', paymentMethod: 'COD' }).ok, false);
    assert.equal(parseCreateOrderBody({ addressId: 'abc', paymentMethod: 'COD' }).ok, false);
    assert.equal(parseCreateOrderBody({ paymentMethod: 'COD' }).ok, false);
  });

  test('4. Từ chối couponCode quá 40 ký tự hoặc note quá 1000 ký tự', () => {
    const longCoupon = 'A'.repeat(41);
    assert.equal(parseCreateOrderBody({ addressId: 1, couponCode: longCoupon }).ok, false);

    const longNote = 'B'.repeat(1001);
    assert.equal(parseCreateOrderBody({ addressId: 1, note: longNote }).ok, false);
  });

  test('5. Từ chối shippingMethod hoặc paymentMethod không nằm trong whitelist', () => {
    assert.equal(parseCreateOrderBody({ addressId: 1, shippingMethod: 'DRONE' }).ok, false);
    assert.equal(parseCreateOrderBody({ addressId: 1, paymentMethod: 'CRYPTO' }).ok, false);
  });

  test('6. Kiểm tra Idempotency-Key hợp lệ (8-100 ký tự Alphanumeric/dash/underscore)', () => {
    assert.equal(parseCreateOrderBody({ addressId: 1 }, 'short').ok, false);
    assert.equal(parseCreateOrderBody({ addressId: 1 }, 'valid-key-8chars').ok, true);
    assert.equal(parseCreateOrderBody({ addressId: 1 }, 'invalid key with spaces').ok, false);
  });
});
