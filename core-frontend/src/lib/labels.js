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

export const ORDER_RECEIPT_LABEL = Object.freeze({
  TITLE: 'Xác nhận nhận hàng',
  CONFIRMED: 'Bạn đã xác nhận nhận hàng',
  AUTOMATIC: 'Hệ thống tự xác nhận sau thời hạn',
  ACTION: 'Đã nhận hàng',
  WAITING: 'Đang chờ xác nhận nhận hàng.',
  WINDOW_CLOSED: 'Cửa sổ yêu cầu đổi trả đã đóng.',
  RETURN_DEADLINE: 'Hạn gửi yêu cầu đổi trả',
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
  INACTIVE: 'Ngừng hoạt động',
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
  SUCCESS: 'Thành công',
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
  PROMOTION: 'Khuyến mãi',
  SYSTEM: 'Hệ thống',
});

export const INVENTORY_REASON = Object.freeze({
  // Chuỗi cũ tiếng Anh từ git baseline (cfdfdb6 & a310d78)
  'Customer order': 'Đơn hàng của khách',
  'Order cancelled; stock restored': 'Hủy đơn; hoàn tồn kho',
  'Return completed; stock restocked': 'Đổi trả; nhập lại kho',
  'Initial product stock': 'Tồn kho ban đầu',
  'Admin stock adjustment': 'Quản trị viên điều chỉnh',
  // Biến thể rút gọn dự phòng
  'Return approved; restocked': 'Đổi trả; nhập lại kho',
  'Customer return; stock restored': 'Đổi trả; nhập lại kho',
  'Initial stock': 'Tồn kho ban đầu',
  'Admin adjustment': 'Quản trị viên điều chỉnh',
  PURCHASE: 'Nhập hàng',
  SALE: 'Bán hàng',
  RETURN: 'Đổi trả hàng',
  ADJUSTMENT: 'Kiểm kê điều chỉnh',

  // Chuỗi tiếng Việt chuẩn từ Khu vực 2 (HEAD)
  'Đơn hàng của khách': 'Đơn hàng của khách',
  'Hủy đơn; hoàn tồn kho': 'Hủy đơn; hoàn tồn kho',
  'Đổi trả; nhập lại kho': 'Đổi trả; nhập lại kho',
  'Tồn kho ban đầu': 'Tồn kho ban đầu',
  'Quản trị viên điều chỉnh': 'Quản trị viên điều chỉnh',
});

export const ORDER_HISTORY_NOTES = Object.freeze({
  // Chuỗi tiếng Anh từ git baseline (cfdfdb6 & a310d78)
  'Order placed by customer': 'Khách đặt hàng',
  'Cancelled by customer': 'Khách hủy đơn',
  'Status updated by admin': 'Quản trị viên cập nhật trạng thái',
  'Shipment collected by carrier': 'Đơn vị vận chuyển đã lấy hàng',

  // Biến thể rút gọn dự phòng
  'Order placed': 'Khách đặt hàng',
  'Admin updated status': 'Quản trị viên cập nhật trạng thái',
  'Carrier picked up': 'Đơn vị vận chuyển đã lấy hàng',

  // Ghi chú tự động chuyển trạng thái
  'Kho còn hàng, tự động chuẩn bị hàng': 'Kho còn hàng, tự động chuẩn bị hàng',
  'Đã giữ hàng, tự động chuyển sang chuẩn bị hàng': 'Đã giữ hàng, tự động chuyển sang chuẩn bị hàng',
  'Thanh toán thành công, tự động chuẩn bị hàng': 'Thanh toán thành công, tự động chuẩn bị hàng',
});

export function getOrderHistoryNoteLabel(note) {
  if (!note) return '';
  if (ORDER_HISTORY_NOTES[note]) return ORDER_HISTORY_NOTES[note];
  if (typeof note === 'string') {
    // Xử lý ghi chú webhook GHN (cả tiền tố cũ và mới)
    if (note.startsWith('GHN shipment update: ')) {
      const rawStatus = note.slice('GHN shipment update: '.length).trim();
      return `Cập nhật vận đơn GHN: ${getShipmentStatusLabel(rawStatus)}`;
    }
    if (note.startsWith('Cập nhật vận đơn GHN: ')) {
      const rawStatus = note.slice('Cập nhật vận đơn GHN: '.length).trim();
      return `Cập nhật vận đơn GHN: ${getShipmentStatusLabel(rawStatus)}`;
    }
  }
  return note;
}

export const REVIEW_APPROVAL_STATUS = Object.freeze({
  0: 'Chờ duyệt',
  1: 'Đã duyệt',
  false: 'Chờ duyệt',
  true: 'Đã duyệt',
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
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

const GHN_STATUS_MAP = Object.freeze({
  READY_TO_PICK: 'READY_FOR_PICKUP',
  DELIVERING: 'OUT_FOR_DELIVERY',
  DELIVERY_FAIL: 'DELIVERY_FAILED',
  RETURN: 'RETURNING',
  RETURNED: 'RETURNED',
  CANCEL: 'CANCELLED',
  EXCEPTION: 'ISSUE',
});

export function getShipmentStatusLabel(status) {
  if (!status) return '';
  const key = String(status).trim().toUpperCase();
  const normalizedKey = GHN_STATUS_MAP[key] || key;
  return lookup(SHIPMENT_STATUS, normalizedKey, 'shipment_status');
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

export function getReviewApprovalLabel(isApproved) {
  return lookup(REVIEW_APPROVAL_STATUS, isApproved, 'review_approval_status');
}

export function getNotificationBodyLabel(body) {
  if (typeof body !== 'string' || !body) return '';

  // 1. Mẫu trạng thái đơn hàng cũ: "Trạng thái đơn hàng: <STATUS>."
  // Nguồn lịch sử: cfdfdb6:core-backend/controllers/adminController.js:304
  const orderMatch = body.match(/^Trạng thái đơn hàng:\s*([A-Za-z0-9_]+)\.?$/);
  if (orderMatch) {
    const rawStatus = orderMatch[1];
    const label = getOrderStatusLabel(rawStatus);
    if (label && label !== rawStatus) {
      return `Trạng thái đơn hàng: ${label}.`;
    }
  }

  // 2. Mẫu vận chuyển GHN cũ: "Đơn vận chuyển GHN: <STATUS>."
  // Nguồn lịch sử: a310d78:core-backend/controllers/shipmentController.js:113
  const shipmentMatch = body.match(/^Đơn vận chuyển GHN:\s*([A-Za-z0-9_]+)\.?$/);
  if (shipmentMatch) {
    const rawStatus = shipmentMatch[1];
    const label = getShipmentStatusLabel(rawStatus);
    if (label && label !== rawStatus) {
      return `Đơn vận chuyển GHN: ${label}.`;
    }
  }

  // 3. Mẫu đổi trả cũ: "Yêu cầu đổi trả: <STATUS>."
  // Nguồn lịch sử: cfdfdb6:core-backend/controllers/adminController.js:485
  const returnMatch = body.match(/^Yêu cầu đổi trả:\s*([A-Za-z0-9_]+)\.?$/);
  if (returnMatch) {
    const rawStatus = returnMatch[1];
    const label = getReturnStatusLabel(rawStatus);
    if (label && label !== rawStatus) {
      return `Yêu cầu đổi trả: ${label}.`;
    }
  }

  // Mẫu mới / chuỗi tiếng Việt đã dịch / chuỗi khác: giữ nguyên
  return body;
}

