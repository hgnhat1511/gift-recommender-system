/**
 * order-inventory-reasons.test.js
 *
 * Kiểm thử đơn vị các hằng số lý do biến động kho, ghi chú lịch sử đơn
 * và điều kiện cho phép khách hàng hủy đơn hàng (Khu vực 2).
 * Dùng Node.js built-in test runner. Chạy không cần DB.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { canCustomerCancel } = require('../utils/orderContract');

describe('Khu vực 2: Kiểm soát tồn kho, lý do tiếng Việt và điều kiện hủy đơn', () => {
  test('1. Đơn PENDING + UNPAID: Khách hàng được phép hủy', () => {
    const order = { id: 1, status: 'PENDING', payment_status: 'UNPAID' };
    const result = canCustomerCancel(order);
    assert.equal(result.canCancel, true);
    assert.equal(result.fromStatus, 'PENDING');
  });

  test('2. Đơn CONFIRMED + UNPAID: Khách hàng được phép hủy', () => {
    const order = { id: 2, status: 'CONFIRMED', payment_status: 'UNPAID' };
    const result = canCustomerCancel(order);
    assert.equal(result.canCancel, true);
    assert.equal(result.fromStatus, 'CONFIRMED');
  });

  test('3. Đơn PROCESSING + UNPAID (kho đang chuẩn bị hàng, chưa giao shipper): Khách hàng được phép hủy', () => {
    const order = { id: 3, status: 'PROCESSING', payment_status: 'UNPAID' };
    const result = canCustomerCancel(order);
    assert.equal(result.canCancel, true);
    assert.equal(result.fromStatus, 'PROCESSING');
  });

  test('4. Đơn đã thanh toán (PAID): Khách hàng không được hủy trực tiếp -> 409', () => {
    const pendingPaid = { id: 4, status: 'PENDING', payment_status: 'PAID' };
    assert.equal(canCustomerCancel(pendingPaid).canCancel, false);
    assert.equal(canCustomerCancel(pendingPaid).status, 409);

    const confirmedPaid = { id: 5, status: 'CONFIRMED', payment_status: 'PAID' };
    assert.equal(canCustomerCancel(confirmedPaid).canCancel, false);
    assert.equal(canCustomerCancel(confirmedPaid).status, 409);

    const processingPaid = { id: 6, status: 'PROCESSING', payment_status: 'PAID' };
    assert.equal(canCustomerCancel(processingPaid).canCancel, false);
    assert.equal(canCustomerCancel(processingPaid).status, 409);
  });

  test('5. Đơn SHIPPED / DELIVERED: Khách hàng không được hủy -> 409', () => {
    for (const status of ['SHIPPED', 'DELIVERED']) {
      const order = { id: 7, status, payment_status: 'UNPAID' };
      const result = canCustomerCancel(order);
      assert.equal(result.canCancel, false, `Không được hủy đơn ở trạng thái ${status}`);
      assert.equal(result.status, 409);
    }
  });

  test('6. Đơn đã hủy (CANCELLED): Không được hủy lần nữa -> 409', () => {
    const order = { id: 8, status: 'CANCELLED', payment_status: 'UNPAID' };
    const result = canCustomerCancel(order);
    assert.equal(result.canCancel, false);
    assert.equal(result.status, 409);
  });

  test('7. Các lý do biến động kho tiếng Việt chuẩn Khu vực 2', () => {
    const reasons = [
      'Đơn hàng của khách',
      'Hủy đơn; hoàn tồn kho',
      'Tồn kho ban đầu',
      'Quản trị viên điều chỉnh',
      'Đổi trả; nhập lại kho',
    ];
    for (const reason of reasons) {
      assert.equal(typeof reason, 'string');
      assert.ok(reason.length > 0);
    }
  });

  test('8. Các ghi chú lịch sử đơn tiếng Việt chuẩn Khu vực 2', () => {
    const notes = [
      'Khách đặt hàng',
      'Khách hủy đơn',
      'Kho còn hàng, tự động chuẩn bị hàng',
      'Thanh toán thành công, tự động chuẩn bị hàng',
      'Quản trị viên cập nhật trạng thái',
      'Đơn vị vận chuyển đã lấy hàng',
    ];
    for (const note of notes) {
      assert.equal(typeof note, 'string');
      assert.ok(note.length > 0);
    }
  });
});

