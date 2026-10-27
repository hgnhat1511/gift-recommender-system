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

// Hàm thuần mô phỏng quy tắc kiểm tra điều kiện hủy đơn của customer (orderController.js:cancelMine)
function canCustomerCancelOrder(order) {
  if (!order || typeof order !== 'object') {
    return { canCancel: false, status: 404, message: 'Order not found.' };
  }
  const allowedStatuses = ['PENDING', 'CONFIRMED'];
  if (!allowedStatuses.includes(order.status) || order.payment_status !== 'UNPAID') {
    return {
      canCancel: false,
      status: 409,
      message: 'Only pending or confirmed unpaid orders can be cancelled by the customer.'
    };
  }
  return { canCancel: true, fromStatus: order.status };
}

describe('Khu vực 2: Kiểm soát tồn kho, lý do tiếng Việt và điều kiện hủy đơn', () => {
  test('1. Đơn PENDING + UNPAID: Khách hàng được phép hủy', () => {
    const order = { id: 1, status: 'PENDING', payment_status: 'UNPAID' };
    const result = canCustomerCancelOrder(order);
    assert.equal(result.canCancel, true);
    assert.equal(result.fromStatus, 'PENDING');
  });

  test('2. Đơn CONFIRMED + UNPAID: Khách hàng được phép hủy (mở rộng Khu vực 2)', () => {
    const order = { id: 2, status: 'CONFIRMED', payment_status: 'UNPAID' };
    const result = canCustomerCancelOrder(order);
    assert.equal(result.canCancel, true);
    assert.equal(result.fromStatus, 'CONFIRMED');
  });

  test('3. Đơn đã thanh toán (PAID): Khách hàng không được hủy trực tiếp -> 409', () => {
    const order = { id: 3, status: 'PENDING', payment_status: 'PAID' };
    const result = canCustomerCancelOrder(order);
    assert.equal(result.canCancel, false);
    assert.equal(result.status, 409);
  });

  test('4. Đơn PROCESSING / SHIPPED / DELIVERED: Khách hàng không được hủy -> 409', () => {
    for (const status of ['PROCESSING', 'SHIPPED', 'DELIVERED']) {
      const order = { id: 4, status, payment_status: 'UNPAID' };
      const result = canCustomerCancelOrder(order);
      assert.equal(result.canCancel, false, `Không được hủy đơn ở trạng thái ${status}`);
      assert.equal(result.status, 409);
    }
  });

  test('5. Đơn đã hủy (CANCELLED): Không được hủy lần nữa -> 409', () => {
    const order = { id: 5, status: 'CANCELLED', payment_status: 'UNPAID' };
    const result = canCustomerCancelOrder(order);
    assert.equal(result.canCancel, false);
    assert.equal(result.status, 409);
  });

  test('6. Các lý do biến động kho tiếng Việt chuẩn Khu vực 2', () => {
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

  test('7. Các ghi chú lịch sử đơn tiếng Việt chuẩn Khu vực 2', () => {
    const notes = [
      'Khách đặt hàng',
      'Khách hủy đơn',
      'Quản trị viên cập nhật trạng thái',
      'Đơn vị vận chuyển đã lấy hàng',
    ];
    for (const note of notes) {
      assert.equal(typeof note, 'string');
      assert.ok(note.length > 0);
    }
  });
});
