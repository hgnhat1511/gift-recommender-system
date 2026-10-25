const isProduction = Boolean(typeof import.meta !== 'undefined' && import.meta.env?.PROD) ||
  (typeof globalThis.process !== 'undefined' && globalThis.process.env?.NODE_ENV === 'production');

function lookup(dictionary, key, domain) {
  if (key == null || key === '') return '';
  const stringKey = String(key).trim();
  if (Object.prototype.hasOwnProperty.call(dictionary, stringKey)) {
    return dictionary[stringKey];
  }
  if (!isProduction && typeof console !== 'undefined' && console.warn) {
    console.warn(`[labels] Thiếu nhãn tiếng Việt cho "${domain}": "${stringKey}"`);
  }
  return stringKey;
}

export const ORDER_STATUS = Object.freeze({
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  PROCESSING: 'Đang chuẩn bị hàng',
  SHIPPED: 'Đang giao hàng',
  DELIVERED: 'Đã giao hàng',
  CANCELLED: 'Đã hủy',
});

export const PAYMENT_STATUS = Object.freeze({
  UNPAID: 'Chưa thanh toán',
  PAID: 'Đã thanh toán',
  REVIEW: 'Cần đối soát',
  REFUNDED: 'Đã hoàn tiền',
});

export const PAYMENT_METHOD = Object.freeze({
  COD: 'Thanh toán khi nhận hàng',
  VNPAY: 'VNPAY',
});

export const RETURN_STATUS = Object.freeze({
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Đã từ chối',
  COMPLETED: 'Hoàn tất',
});

export const SHIPPING_METHOD = Object.freeze({
  STANDARD: 'Tiêu chuẩn',
  EXPRESS: 'Giao nhanh',
});

export const SHIPMENT_STATUS = Object.freeze({
  READY_FOR_PICKUP: 'Chờ lấy hàng',
  PICKING: 'Đang lấy hàng',
  PICKED_UP: 'Đã lấy hàng',
  IN_TRANSIT: 'Đang trung chuyển',
  OUT_FOR_DELIVERY: 'Đang phát hàng',
  DELIVERED: 'Giao thành công',
  DELIVERY_FAILED: 'Giao thất bại',
  RETURNING: 'Đang chuyển hoàn',
  RETURNED: 'Đã chuyển hoàn',
  RETURN_FAILED: 'Chuyển hoàn thất bại',
  CANCELLED: 'Đã hủy vận chuyển',
  ISSUE: 'Sự cố vận chuyển',
  CREATING: 'Đang tạo vận đơn',
  CREATED: 'Đã tạo vận đơn',
  PENDING: 'Chờ xử lý',
  FAILED: 'Tạo vận đơn thất bại',
});

export const CUSTOMER_STATUS = Object.freeze({
  ACTIVE: 'Hoạt động',
  LOCKED: 'Đã khóa',
});

export const USER_ROLE = Object.freeze({
  USER: 'Khách hàng',
  CUSTOMER: 'Khách hàng',
  STAFF: 'Nhân viên',
  ADMIN: 'Quản trị viên',
});

export const PRODUCT_STATUS = Object.freeze({
  ACTIVE: 'Đang bán',
  INACTIVE: 'Ngừng bán',
});

export const DELETION_STATUS = Object.freeze({
  PENDING: 'Đang chờ xem xét',
  REVIEWED: 'Đã được xem xét',
  REJECTED: 'Bị từ chối',
});

export const COUPON_DISCOUNT_TYPE = Object.freeze({
  PERCENT: 'Phần trăm (%)',
  FIXED: 'Số tiền cố định (₫)',
});

export const PAYMENT_ATTEMPT_STATUS = Object.freeze({
  PENDING: 'Chờ thanh toán',
  SUCCEEDED: 'Thành công',
  FAILED: 'Thất bại',
  EXPIRED: 'Hết hạn',
  REVIEW: 'Cần đối soát',
});

export const NOTIFICATION_TYPE = Object.freeze({
  ORDER: 'Đơn hàng',
  SHIPPING: 'Vận chuyển',
  ACCOUNT: 'Tài khoản',
  RETURN: 'Đổi trả',
  PAYMENT: 'Thanh toán',
});

export const INVENTORY_REASON = Object.freeze({
  'Customer order': 'Đơn hàng của khách',
  'Order cancelled; stock restored': 'Hủy đơn; hoàn tồn kho',
  'Customer return; stock restored': 'Đổi trả; nhập lại kho',
  'Admin stock adjustment': 'Quản trị viên điều chỉnh',
});

/**
 * Lấy nhãn hiển thị cho trạng thái đơn hàng.
 * Ngoại lệ nghiệp vụ: Đơn PENDING + thanh toán online (VNPAY) + UNPAID = "Chờ thanh toán".
 * Đơn COD ở PENDING = "Chờ xác nhận".
 */
export function getOrderStatusLabel(orderOrStatus, options) {
  if (!orderOrStatus) return '';
  let status;
  let paymentMethod;
  let paymentStatus;

  if (typeof orderOrStatus === 'object') {
    status = orderOrStatus.status;
    paymentMethod = orderOrStatus.paymentMethod;
    paymentStatus = orderOrStatus.paymentStatus;
  } else {
    status = orderOrStatus;
    paymentMethod = options?.paymentMethod;
    paymentStatus = options?.paymentStatus;
  }

  if (status === 'PENDING' && paymentMethod === 'VNPAY' && paymentStatus === 'UNPAID') {
    return 'Chờ thanh toán';
  }

  return lookup(ORDER_STATUS, status, 'order_status');
}

export function getPaymentStatusLabel(status) {
  return lookup(PAYMENT_STATUS, status, 'payment_status');
}

export function getPaymentMethodLabel(method) {
  return lookup(PAYMENT_METHOD, method, 'payment_method');
}

export function getReturnStatusLabel(status) {
  return lookup(RETURN_STATUS, status, 'return_status');
}

export function getShippingMethodLabel(method) {
  return lookup(SHIPPING_METHOD, method, 'shipping_method');
}

export function getShipmentStatusLabel(status) {
  return lookup(SHIPMENT_STATUS, status, 'shipment_status');
}

export function getCustomerStatusLabel(status) {
  return lookup(CUSTOMER_STATUS, status, 'customer_status');
}

export function getUserRoleLabel(role) {
  return lookup(USER_ROLE, role, 'user_role');
}

export function getProductStatusLabel(status) {
  return lookup(PRODUCT_STATUS, status, 'product_status');
}

export function getDeletionStatusLabel(status) {
  return lookup(DELETION_STATUS, status, 'deletion_status');
}

export function getCouponDiscountTypeLabel(type) {
  return lookup(COUPON_DISCOUNT_TYPE, type, 'coupon_discount_type');
}

export function getPaymentAttemptStatusLabel(status) {
  return lookup(PAYMENT_ATTEMPT_STATUS, status, 'payment_attempt_status');
}

export function getNotificationTypeLabel(type) {
  return lookup(NOTIFICATION_TYPE, type, 'notification_type');
}

export function getInventoryReasonLabel(reason) {
  return lookup(INVENTORY_REASON, reason, 'inventory_reason');
}

