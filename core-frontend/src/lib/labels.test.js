import test from 'node:test';
import assert from 'node:assert/strict';
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
} from './labels.js';

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

  assert.equal(INVENTORY_REASON['Customer order'], 'Đơn hàng của khách');
  assert.equal(getInventoryReasonLabel('Customer order'), 'Đơn hàng của khách');
  assert.equal(getInventoryReasonLabel('Order cancelled; stock restored'), 'Hủy đơn; hoàn tồn kho');
});

test('Unknown values return raw string without crashing', () => {
  assert.equal(getOrderStatusLabel('UNKNOWN_STATUS'), 'UNKNOWN_STATUS');
  assert.equal(getPaymentStatusLabel('UNKNOWN_PAYMENT'), 'UNKNOWN_PAYMENT');
  assert.equal(getOrderStatusLabel(''), '');
  assert.equal(getOrderStatusLabel(null), '');
});

