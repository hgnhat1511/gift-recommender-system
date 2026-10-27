/**
 * cart-items-contract.test.js
 * Unit/Contract tests thuần cho hợp đồng dữ liệu giữa Frontend và Backend:
 * - cartItemContract.js (POST /cart/items, PATCH /cart/items/:id, PATCH /cart/selection)
 * - orderContract.js (POST /orders)
 *
 * Kiểm tra cả hai chiều: payload thật từ frontend gửi lên và parser thật của backend.
 * Chạy độc lập hoàn toàn với database (100% code thật hai phía).
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAddCartItemBody,
  parseUpdateCartItemBody,
  parseUpdateSelectionBody,
  parseUpdateAllSelectionBody
} = require('../utils/cartItemContract');

const {
  parseCreateOrderBody,
  SUPPORTED_SHIPPING_METHODS,
  SUPPORTED_PAYMENT_METHODS
} = require('../utils/orderContract');

describe('Contract: Cart Endpoints (POST /cart/items, PATCH /cart/items/:id, PATCH /cart/selection)', () => {
  describe('POST /cart/items - Thêm món vào giỏ', () => {
    test('1. Payload hợp lệ từ CatalogPages (productId dạng số hoặc chuỗi số, quantity nguyên 1-99)', () => {
      const payload1 = { productId: 12, quantity: 2 };
      const parsed1 = parseAddCartItemBody(payload1);
      assert.equal(parsed1.ok, true);
      assert.equal(parsed1.productId, '12');
      assert.equal(parsed1.quantity, 2);

      const payload2 = { productId: '45' }; // quantity mặc định là 1
      const parsed2 = parseAddCartItemBody(payload2);
      assert.equal(parsed2.ok, true);
      assert.equal(parsed2.productId, '45');
      assert.equal(parsed2.quantity, 1);
    });

    test('2. Từ chối productId không phải số (rỗng, chữ, ký tự đặc biệt, âm)', () => {
      assert.equal(parseAddCartItemBody({ productId: '', quantity: 1 }).ok, false);
      assert.equal(parseAddCartItemBody({ productId: 'abc', quantity: 1 }).ok, false);
      assert.equal(parseAddCartItemBody({ productId: -5, quantity: 1 }).ok, false);
      assert.equal(parseAddCartItemBody({ productId: '12; DROP TABLE', quantity: 1 }).ok, false);
    });

    test('3. Từ chối quantity không hợp lệ (0, âm, > 99, thập phân)', () => {
      assert.equal(parseAddCartItemBody({ productId: 1, quantity: 0 }).ok, false);
      assert.equal(parseAddCartItemBody({ productId: 1, quantity: -1 }).ok, false);
      assert.equal(parseAddCartItemBody({ productId: 1, quantity: 100 }).ok, false);
      assert.equal(parseAddCartItemBody({ productId: 1, quantity: 2.5 }).ok, false);
    });
  });

  describe('PATCH /cart/items/:itemId - Cập nhật số lượng', () => {
    test('1. Params và body hợp lệ từ CommercePages', () => {
      const parsed = parseUpdateCartItemBody({ itemId: '8' }, { quantity: 5 });
      assert.equal(parsed.ok, true);
      assert.equal(parsed.itemId, '8');
      assert.equal(parsed.quantity, 5);
    });

    test('2. Từ chối itemId hoặc quantity sai chuẩn', () => {
      assert.equal(parseUpdateCartItemBody({ itemId: 'abc' }, { quantity: 2 }).ok, false);
      assert.equal(parseUpdateCartItemBody({ itemId: '8' }, { quantity: 0 }).ok, false);
      assert.equal(parseUpdateCartItemBody({ itemId: '8' }, { quantity: 150 }).ok, false);
      assert.equal(parseUpdateCartItemBody({ itemId: '8' }, {}).ok, false);
    });
  });

  describe('PATCH /cart/items/:itemId/selection - Chọn từng món', () => {
    test('1. Payload hợp lệ với isSelected kiểu boolean', () => {
      const parsedTrue = parseUpdateSelectionBody({ itemId: '10' }, { isSelected: true });
      assert.equal(parsedTrue.ok, true);
      assert.equal(parsedTrue.itemId, '10');
      assert.equal(parsedTrue.isSelected, true);

      const parsedFalse = parseUpdateSelectionBody({ itemId: '10' }, { isSelected: false });
      assert.equal(parsedFalse.ok, true);
      assert.equal(parsedFalse.isSelected, false);
    });

    test('2. Từ chối isSelected không phải boolean', () => {
      assert.equal(parseUpdateSelectionBody({ itemId: '10' }, { isSelected: 'true' }).ok, false);
      assert.equal(parseUpdateSelectionBody({ itemId: '10' }, { isSelected: 1 }).ok, false);
      assert.equal(parseUpdateSelectionBody({ itemId: '10' }, {}).ok, false);
      assert.equal(parseUpdateSelectionBody({ itemId: 'invalid' }, { isSelected: true }).ok, false);
    });
  });

  describe('PATCH /cart/selection - Chọn/bỏ chọn tất cả', () => {
    test('1. Payload hợp lệ với isSelected kiểu boolean', () => {
      assert.equal(parseUpdateAllSelectionBody({ isSelected: true }).ok, true);
      assert.equal(parseUpdateAllSelectionBody({ isSelected: false }).ok, true);
    });

    test('2. Từ chối isSelected không phải boolean', () => {
      assert.equal(parseUpdateAllSelectionBody({ isSelected: 'false' }).ok, false);
      assert.equal(parseUpdateAllSelectionBody({}).ok, false);
    });
  });
});

describe('Contract: Order Checkout Endpoint (POST /orders)', () => {
  test('1. Payload hợp lệ từ Checkout form (CommercePages.jsx)', () => {
    const payload = {
      addressId: 3,
      shippingMethod: 'STANDARD',
      paymentMethod: 'COD',
      couponCode: 'TET2026',
      note: 'Giao trong giờ hành chính'
    };
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
    assert.deepEqual(SUPPORTED_PAYMENT_METHODS, ['COD', 'VNPAY']);

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
