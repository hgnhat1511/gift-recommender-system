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

const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAddCartItemBody,
  parseUpdateCartItemBody,
  parseUpdateSelectionBody,
  parseUpdateAllSelectionBody
} = require('../utils/cartItemContract');
const cartController = require('../controllers/cartController');

function createMockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}

let frontend;

describe('Contract: Cart Endpoints (POST /cart/items, PATCH /cart/items/:id, PATCH /cart/selection)', () => {
  before(async () => {
    frontend = await import('../../core-frontend/src/lib/cartPayloads.js');
  });

  describe('POST /cart/items - Thêm món vào giỏ', () => {
    test('1. Payload hợp lệ từ frontend (buildAddCartItemPayload trong CatalogPages)', () => {
      const payload1 = frontend.buildAddCartItemPayload(12, 2);
      const parsed1 = parseAddCartItemBody(payload1);
      assert.equal(parsed1.ok, true);
      assert.equal(parsed1.productId, '12');
      assert.equal(parsed1.quantity, 2);

      const payload2 = frontend.buildAddCartItemPayload('45'); // quantity mặc định là 1
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
    test('1. Params và body hợp lệ từ frontend (buildUpdateCartItemPayload trong CommercePages)', () => {
      const payload = frontend.buildUpdateCartItemPayload(5);
      const parsed = parseUpdateCartItemBody({ itemId: '8' }, payload);
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
    test('1. Payload hợp lệ từ frontend (buildUpdateSelectionPayload trong CommercePages)', () => {
      const payloadTrue = frontend.buildUpdateSelectionPayload(true);
      const parsedTrue = parseUpdateSelectionBody({ itemId: '10' }, payloadTrue);
      assert.equal(parsedTrue.ok, true);
      assert.equal(parsedTrue.itemId, '10');
      assert.equal(parsedTrue.isSelected, true);

      const payloadFalse = frontend.buildUpdateSelectionPayload(false);
      const parsedFalse = parseUpdateSelectionBody({ itemId: '10' }, payloadFalse);
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
    test('1. Payload hợp lệ từ frontend (buildUpdateAllSelectionPayload trong CommercePages)', () => {
      assert.equal(parseUpdateAllSelectionBody(frontend.buildUpdateAllSelectionPayload(true)).ok, true);
      assert.equal(parseUpdateAllSelectionBody(frontend.buildUpdateAllSelectionPayload(false)).ok, true);
    });

    test('2. Từ chối isSelected không phải boolean', () => {
      assert.equal(parseUpdateAllSelectionBody({ isSelected: 'false' }).ok, false);
      assert.equal(parseUpdateAllSelectionBody({}).ok, false);
    });
  });

  describe('In-memory Handlers: cartController (add, update, updateSelection, updateAllSelection)', () => {
    test('1. cartController.add từ chối productId không phải số', async () => {
      const res = createMockRes();
      await cartController.add({ body: { productId: 'invalid', quantity: 1 } }, res);
      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { success: false, message: 'Invalid product or quantity.' });
    });

    test('2. cartController.add từ chối quantity <= 0 hoặc > 99', async () => {
      const res = createMockRes();
      await cartController.add({ body: { productId: '10', quantity: 0 } }, res);
      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { success: false, message: 'Invalid product or quantity.' });
    });

    test('3. cartController.update từ chối itemId không phải số hoặc quantity sai chuẩn', async () => {
      const res = createMockRes();
      await cartController.update({ params: { itemId: 'abc' }, body: { quantity: 1 } }, res);
      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { success: false, message: 'Invalid quantity.' });
    });

    test('4. cartController.updateSelection từ chối isSelected không phải boolean', async () => {
      const res = createMockRes();
      await cartController.updateSelection({ params: { itemId: '1' }, body: { isSelected: 'not-bool' } }, res);
      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { success: false, message: 'isSelected must be a boolean.' });
    });

    test('5. cartController.updateAllSelection từ chối isSelected không phải boolean', async () => {
      const res = createMockRes();
      await cartController.updateAllSelection({ body: { isSelected: 'yes' } }, res);
      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { success: false, message: 'isSelected must be a boolean.' });
    });
  });
});


