import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  RETURN_STATUS,
  SHIPPING_METHOD,
  SHIPMENT_STATUS,
  CUSTOMER_STATUS,
  USER_ROLE,
  PRODUCT_STATUS,
  DELETION_STATUS,
  COUPON_DISCOUNT_TYPE,
  PAYMENT_ATTEMPT_STATUS,
  NOTIFICATION_TYPE,
  INVENTORY_REASON,
  REVIEW_APPROVAL_STATUS,
  getOrderStatusLabel,
  getPaymentStatusLabel,
  getPaymentMethodLabel,
  getReturnStatusLabel,
  getShippingMethodLabel,
  getShipmentStatusLabel,
  getCustomerStatusLabel,
  getUserRoleLabel,
  getProductStatusLabel,
  getDeletionStatusLabel,
  getCouponDiscountTypeLabel,
  getPaymentAttemptStatusLabel,
  getNotificationTypeLabel,
  getInventoryReasonLabel,
  getReviewApprovalLabel,
  getOrderHistoryNoteLabel,
} from './labels.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('ORDER_STATUS contains all required real enum keys with proper Vietnamese labels', () => {
  assert.equal(ORDER_STATUS.PENDING, 'Chờ xác nhận');
  assert.equal(ORDER_STATUS.CONFIRMED, 'Đã xác nhận');
  assert.equal(ORDER_STATUS.PROCESSING, 'Đang chuẩn bị hàng');
  assert.equal(ORDER_STATUS.SHIPPED, 'Đang giao hàng');
  assert.equal(ORDER_STATUS.DELIVERED, 'Đã giao hàng');
  assert.equal(ORDER_STATUS.CANCELLED, 'Đã hủy');
  // Không có "Hoàn tất" cho DELIVERED
  assert.notEqual(ORDER_STATUS.DELIVERED, 'Hoàn tất');
});

test('getOrderStatusLabel handles standard orders and online payment exception', () => {
  // COD PENDING -> Chờ xác nhận
  assert.equal(getOrderStatusLabel('PENDING', { paymentMethod: 'COD', paymentStatus: 'UNPAID' }), 'Chờ xác nhận');
  assert.equal(getOrderStatusLabel({ status: 'PENDING', paymentMethod: 'COD', paymentStatus: 'UNPAID' }), 'Chờ xác nhận');

  // VNPAY PENDING + UNPAID -> Chờ thanh toán
  assert.equal(getOrderStatusLabel('PENDING', { paymentMethod: 'VNPAY', paymentStatus: 'UNPAID' }), 'Chờ thanh toán');
  assert.equal(getOrderStatusLabel({ status: 'PENDING', paymentMethod: 'VNPAY', paymentStatus: 'UNPAID' }), 'Chờ thanh toán');

  // VNPAY PENDING + PAID -> Chờ xác nhận (hoặc CONFIRMED sau này)
  assert.equal(getOrderStatusLabel({ status: 'PENDING', paymentMethod: 'VNPAY', paymentStatus: 'PAID' }), 'Chờ xác nhận');

  // Các trạng thái khác
  assert.equal(getOrderStatusLabel('CONFIRMED'), 'Đã xác nhận');
  assert.equal(getOrderStatusLabel('PROCESSING'), 'Đang chuẩn bị hàng');
  assert.equal(getOrderStatusLabel('SHIPPED'), 'Đang giao hàng');
  assert.equal(getOrderStatusLabel('DELIVERED'), 'Đã giao hàng');
  assert.equal(getOrderStatusLabel('CANCELLED'), 'Đã hủy');
});

test('PAYMENT_STATUS labels match real DB enum', () => {
  assert.equal(PAYMENT_STATUS.UNPAID, 'Chưa thanh toán');
  assert.equal(PAYMENT_STATUS.PAID, 'Đã thanh toán');
  assert.equal(getPaymentStatusLabel('UNPAID'), 'Chưa thanh toán');
  assert.equal(getPaymentStatusLabel('PAID'), 'Đã thanh toán');
  assert.equal(getPaymentStatusLabel('REVIEW'), 'Cần đối soát');
  assert.equal(getPaymentStatusLabel('REFUNDED'), 'Đã hoàn tiền');
});

test('PAYMENT_METHOD and SHIPPING_METHOD labels match real enum', () => {
  assert.equal(PAYMENT_METHOD.COD, 'Thanh toán khi nhận hàng');
  assert.equal(PAYMENT_METHOD.VNPAY, 'VNPAY');
  assert.equal(SHIPPING_METHOD.STANDARD, 'Tiêu chuẩn');
  assert.equal(SHIPPING_METHOD.EXPRESS, 'Giao nhanh');
  assert.equal(getPaymentMethodLabel('COD'), 'Thanh toán khi nhận hàng');
  assert.equal(getPaymentMethodLabel('VNPAY'), 'VNPAY');
  assert.equal(getShippingMethodLabel('STANDARD'), 'Tiêu chuẩn');
  assert.equal(getShippingMethodLabel('EXPRESS'), 'Giao nhanh');
});

test('RETURN_STATUS labels match real enum', () => {
  assert.equal(RETURN_STATUS.PENDING, 'Chờ duyệt');
  assert.equal(RETURN_STATUS.COMPLETED, 'Hoàn tất');
  assert.equal(getReturnStatusLabel('PENDING'), 'Chờ duyệt');
  assert.equal(getReturnStatusLabel('APPROVED'), 'Đã duyệt');
  assert.equal(getReturnStatusLabel('REJECTED'), 'Đã từ chối');
  assert.equal(getReturnStatusLabel('COMPLETED'), 'Hoàn tất');
});

test('SHIPMENT_STATUS labels match normalized GHN provider statuses', () => {
  assert.equal(SHIPMENT_STATUS.READY_FOR_PICKUP, 'Chờ lấy hàng');
  assert.equal(SHIPMENT_STATUS.DELIVERED, 'Giao thành công');
  assert.equal(getShipmentStatusLabel('READY_FOR_PICKUP'), 'Chờ lấy hàng');
  assert.equal(getShipmentStatusLabel('PICKING'), 'Đang lấy hàng');
  assert.equal(getShipmentStatusLabel('PICKED_UP'), 'Đã lấy hàng');
  assert.equal(getShipmentStatusLabel('IN_TRANSIT'), 'Đang trung chuyển');
  assert.equal(getShipmentStatusLabel('OUT_FOR_DELIVERY'), 'Đang phát hàng');
  assert.equal(getShipmentStatusLabel('DELIVERED'), 'Giao thành công');
  assert.equal(getShipmentStatusLabel('DELIVERY_FAILED'), 'Giao thất bại');
  assert.equal(getShipmentStatusLabel('RETURNING'), 'Đang chuyển hoàn');
  assert.equal(getShipmentStatusLabel('RETURNED'), 'Đã chuyển hoàn');
  assert.equal(getShipmentStatusLabel('RETURN_FAILED'), 'Chuyển hoàn thất bại');
  assert.equal(getShipmentStatusLabel('CANCELLED'), 'Đã hủy vận chuyển');
  assert.equal(getShipmentStatusLabel('ISSUE'), 'Sự cố vận chuyển');
  assert.equal(getShipmentStatusLabel('ready_to_pick'), 'Chờ lấy hàng');
  assert.equal(getShipmentStatusLabel('CREATING'), 'Đang tạo vận đơn');
  assert.equal(getShipmentStatusLabel('CREATED'), 'Đã tạo vận đơn');
  assert.equal(getShipmentStatusLabel('FAILED'), 'Tạo vận đơn thất bại');
});

test('Other administrative labels (customer, role, product, deletion)', () => {
  assert.equal(CUSTOMER_STATUS.ACTIVE, 'Hoạt động');
  assert.equal(USER_ROLE.ADMIN, 'Quản trị viên');
  assert.equal(PRODUCT_STATUS.ACTIVE, 'Đang bán');
  assert.equal(DELETION_STATUS.PENDING, 'Đang chờ xem xét');

  assert.equal(getCustomerStatusLabel('ACTIVE'), 'Hoạt động');
  assert.equal(getCustomerStatusLabel('LOCKED'), 'Đã khóa');

  assert.equal(getUserRoleLabel('ADMIN'), 'Quản trị viên');
  assert.equal(getUserRoleLabel('USER'), 'Khách hàng');

  assert.equal(getProductStatusLabel('ACTIVE'), 'Đang bán');
  assert.equal(getProductStatusLabel('INACTIVE'), 'Ngừng bán');

  assert.equal(getDeletionStatusLabel('PENDING'), 'Đang chờ xem xét');
  assert.equal(getDeletionStatusLabel('REVIEWED'), 'Đã được xem xét');
  assert.equal(getDeletionStatusLabel('REJECTED'), 'Bị từ chối');
});

test('Additional domain labels (coupon discount type, payment attempts, notifications, inventory reasons)', () => {
  assert.equal(COUPON_DISCOUNT_TYPE.PERCENT, 'Phần trăm (%)');
  assert.equal(COUPON_DISCOUNT_TYPE.FIXED, 'Số tiền cố định (₫)');
  assert.equal(getCouponDiscountTypeLabel('PERCENT'), 'Phần trăm (%)');
  assert.equal(getCouponDiscountTypeLabel('FIXED'), 'Số tiền cố định (₫)');

  assert.equal(PAYMENT_ATTEMPT_STATUS.SUCCEEDED, 'Thành công');
  assert.equal(getPaymentAttemptStatusLabel('SUCCEEDED'), 'Thành công');
  assert.equal(getPaymentAttemptStatusLabel('EXPIRED'), 'Hết hạn');

  assert.equal(NOTIFICATION_TYPE.ORDER, 'Đơn hàng');
  assert.equal(getNotificationTypeLabel('ORDER'), 'Đơn hàng');
  assert.equal(getNotificationTypeLabel('SHIPPING'), 'Vận chuyển');

  // Fixture chuỗi lấy trực tiếp từ git baseline (cfdfdb6 & a310d78) qua git grep
  const BASELINE_INVENTORY_REASONS = [
    { raw: 'Customer order', expected: 'Đơn hàng của khách', source: 'orderController.js:114 (a310d78)' },
    { raw: 'Order cancelled; stock restored', expected: 'Hủy đơn; hoàn tồn kho', source: 'orderController.js:229 (a310d78)' },
    { raw: 'Return completed; stock restocked', expected: 'Đổi trả; nhập lại kho', source: 'adminController.js:483 (a310d78)' },
    { raw: 'Initial product stock', expected: 'Tồn kho ban đầu', source: 'adminController.js:182 (a310d78)' },
    { raw: 'Admin stock adjustment', expected: 'Quản trị viên điều chỉnh', source: 'adminController.js:204 (a310d78)' },
  ];
  assert.ok(Object.keys(INVENTORY_REASON).length > 0);
  for (const item of BASELINE_INVENTORY_REASONS) {
    assert.equal(getInventoryReasonLabel(item.raw), item.expected, `Lý do kho "${item.raw}" từ ${item.source} phải dịch đúng`);
  }

  // Chuỗi mới tiếng Việt từ Khu vực 2 (HEAD)
  assert.equal(getInventoryReasonLabel('Đơn hàng của khách'), 'Đơn hàng của khách');
  assert.equal(getInventoryReasonLabel('Hủy đơn; hoàn tồn kho'), 'Hủy đơn; hoàn tồn kho');
  assert.equal(getInventoryReasonLabel('Tồn kho ban đầu'), 'Tồn kho ban đầu');
  assert.equal(getInventoryReasonLabel('Quản trị viên điều chỉnh'), 'Quản trị viên điều chỉnh');
  assert.equal(getInventoryReasonLabel('Đổi trả; nhập lại kho'), 'Đổi trả; nhập lại kho');

  // Ghi chú lịch sử đơn hàng lấy từ git baseline (cfdfdb6 & a310d78)
  const BASELINE_ORDER_NOTES = [
    { raw: 'Order placed by customer', expected: 'Khách đặt hàng', source: 'orderController.js:108 (a310d78)' },
    { raw: 'Cancelled by customer', expected: 'Khách hủy đơn', source: 'orderController.js:220 (a310d78)' },
    { raw: 'Status updated by admin', expected: 'Quản trị viên cập nhật trạng thái', source: 'adminController.js:304 (a310d78)' },
    { raw: 'Shipment collected by carrier', expected: 'Đơn vị vận chuyển đã lấy hàng', source: 'shipmentController.js:110 (a310d78)' },
    { raw: 'GHN shipment update: ready_to_pick', expected: 'Cập nhật vận đơn GHN: Chờ lấy hàng', source: 'shipmentController.js:112 (a310d78)' },
    { raw: 'GHN shipment update: delivering', expected: 'Cập nhật vận đơn GHN: Đang phát hàng', source: 'shipmentController.js:112 (a310d78)' },
    { raw: 'GHN shipment update: IN_TRANSIT', expected: 'Cập nhật vận đơn GHN: Đang trung chuyển', source: 'shipmentController.js:112 (legacy prefix)' },
    { raw: 'Cập nhật vận đơn GHN: IN_TRANSIT', expected: 'Cập nhật vận đơn GHN: Đang trung chuyển', source: 'shipmentController.js:112 (vietnamese prefix)' },
    { raw: 'Cập nhật vận đơn GHN: DELIVERED', expected: 'Cập nhật vận đơn GHN: Giao thành công', source: 'shipmentController.js:112 (vietnamese prefix)' },
  ];
  for (const item of BASELINE_ORDER_NOTES) {
    assert.equal(getOrderHistoryNoteLabel(item.raw), item.expected, `Ghi chú lịch sử "${item.raw}" từ ${item.source} phải dịch đúng`);
  }

  // Chuỗi mới tiếng Việt và fallback
  assert.equal(getOrderHistoryNoteLabel('Khách đặt hàng'), 'Khách đặt hàng');
  assert.equal(getOrderHistoryNoteLabel(''), '');
});

test('Unknown values return raw string without crashing', () => {
  assert.equal(getOrderStatusLabel('UNKNOWN_STATUS'), 'UNKNOWN_STATUS');
  assert.equal(getPaymentStatusLabel('UNKNOWN_PAYMENT'), 'UNKNOWN_PAYMENT');
  assert.equal(getOrderStatusLabel(''), '');
  assert.equal(getOrderStatusLabel(null), '');
});

test('All enum values in enums.snapshot.json must have non-empty Vietnamese labels in labels.js', () => {
  const snapshotRaw = fs.readFileSync(path.join(__dirname, 'enums.snapshot.json'), 'utf8');
  const snapshot = JSON.parse(snapshotRaw);

  const getterMap = {
    'orders.status': getOrderStatusLabel,
    'orders.payment_status': getPaymentStatusLabel,
    'orders.payment_method': getPaymentMethodLabel,
    'orders.shipping_method': getShippingMethodLabel,
    'return_requests.status': getReturnStatusLabel,
    'users.role': getUserRoleLabel,
    'users.status': getCustomerStatusLabel,
    'products.status': getProductStatusLabel,
    'account_deletion_requests.status': getDeletionStatusLabel,
    'coupons.discount_type': getCouponDiscountTypeLabel,
    'payment_attempts.status': getPaymentAttemptStatusLabel,
  };

  assert.ok(REVIEW_APPROVAL_STATUS[1]);
  assert.equal(getReviewApprovalLabel(1), 'Đã duyệt');
  assert.equal(getReviewApprovalLabel(0), 'Chờ duyệt');

  for (const col of snapshot.columns) {
    const key = `${col.table}.${col.column}`;
    const getter = getterMap[key];
    if (!getter) continue;
    for (const val of col.values) {
      const label = getter(val);
      assert.ok(label, `Enum value ${key}="${val}" must have a label`);
      // Ngoại lệ: VNPAY giữ nguyên tên thương hiệu
      if (val !== 'VNPAY') {
        assert.notEqual(label, val, `Enum value ${key}="${val}" must not equal raw key`);
      }
    }
  }
});

