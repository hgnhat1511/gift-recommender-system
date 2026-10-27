/**
 * cart-merge-contract.test.js
 *
 * Kiểm thử hợp đồng giữa frontend (beginGuestCartMerge trong guestCart.js thật)
 * và backend (parseMergeBody tách từ cartController).
 *
 * Dùng Node.js built-in test runner.
 * Chạy: node --test test/cart-merge-contract.test.js
 */
'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Giả lập localStorage và window cho frontend guestCart.js
const mockStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
  clear() { this.store = {}; }
};

globalThis.localStorage = mockStorage;
globalThis.window = {
  dispatchEvent() {},
  addEventListener() {},
  removeEventListener() {}
};
globalThis.Event = class Event {};

const { parseMergeBody } = require('../utils/cartMergeContract');

let guestCartModule;

describe('Hợp đồng POST /cart/merge giữa frontend thật và backend thật', () => {
  before(async () => {
    // Import đúng module frontend thật
    const guestCartPath = path.resolve(__dirname, '../../core-frontend/src/lib/guestCart.js');
    guestCartModule = await import(`file://${guestCartPath.replace(/\\/g, '/')}`);
  });

  test('1. Payload sinh ra từ beginGuestCartMerge() thật được backend parseMergeBody chấp nhận (XANH)', () => {
    mockStorage.clear();

    // Thêm món vào giỏ khách bằng hàm thật
    guestCartModule.addGuestCartItem('1', 10);
    guestCartModule.addGuestCartItem('2', 5);

    // Gọi hàm tạo payload merge thật của frontend
    const payload = guestCartModule.beginGuestCartMerge();
    assert.ok(payload, 'beginGuestCartMerge() phải trả về payload khi có hàng');

    // Đưa kết quả vào hàm kiểm tra thật của backend
    const parsed = parseMergeBody(payload);

    assert.equal(
      parsed.ok,
      true,
      `Backend parseMergeBody phải chấp nhận payload từ beginGuestCartMerge(). Nhận được: ok=${parsed.ok}, message=${parsed.message}`
    );
    assert.equal(typeof parsed.mergeKey, 'string', 'mergeKey phải là string');
    assert.equal(parsed.items.length, 2, 'items phải có 2 phần tử');
    assert.equal(parsed.items[0].productId, '1');
    assert.equal(parsed.items[0].quantity, 1);
    assert.equal(parsed.items[0].selected, true);
  });

  test('2. Backend vẫn chấp nhận payload cũ chứa `key` (fallback tương thích ngược cho localStorage cũ)', () => {
    const legacyPayload = {
      key: 'legacy-guest-id-12345678',
      items: [
        { productId: '10', quantity: 3, selected: true }
      ]
    };
    const parsed = parseMergeBody(legacyPayload);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mergeKey, 'legacy-guest-id-12345678');
    assert.equal(parsed.items.length, 1);
  });

  test('3. mergeKey được lưu bền và dùng lại khi thử lại (không sinh mới mỗi lần gọi)', () => {
    mockStorage.clear();
    guestCartModule.addGuestCartItem('5', 20);

    const first = guestCartModule.beginGuestCartMerge();
    const second = guestCartModule.beginGuestCartMerge();

    assert.equal(
      first.mergeKey,
      second.mergeKey,
      'mergeKey không được sinh mới khi phiên gộp trước đó chưa hoàn tất hoặc chưa hủy'
    );
  });

  test('4. completeGuestCartMerge xóa giỏ khách sau khi gộp thành công', () => {
    mockStorage.clear();
    guestCartModule.addGuestCartItem('8', 15);
    const pending = guestCartModule.beginGuestCartMerge();
    assert.ok(pending);

    // Giả lập backend phản hồi thành công (hoặc alreadyMerged: true)
    const success = guestCartModule.completeGuestCartMerge(pending.mergeKey);
    assert.equal(success, true, 'completeGuestCartMerge phải thành công với mergeKey hợp lệ');

    // Sau khi complete, giỏ khách phải rỗng
    assert.equal(guestCartModule.getGuestCart().length, 0, 'Giỏ khách phải rỗng sau khi merge hoàn tất');
    assert.equal(guestCartModule.getPendingGuestCartMerge(), null, 'pendingMerge phải là null');
  });

  test('5. Backend parseMergeBody kiểm tra nghiêm ngặt tính hợp lệ của items', () => {
    const invalidBody = {
      mergeKey: 'valid-merge-key-12345',
      items: [
        { productId: 'abc', quantity: 1, selected: true } // productId không phải số
      ]
    };
    const parsed = parseMergeBody(invalidBody);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.status, 400);
  });
});
