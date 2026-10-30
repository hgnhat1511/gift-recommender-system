/**
 * orderContract.js
 * Hàm parser thuần kiểm tra hợp đồng dữ liệu cho endpoint đặt hàng:
 * - POST /orders
 */
'use strict';

const SUPPORTED_SHIPPING_METHODS = ['STANDARD', 'EXPRESS'];
const SUPPORTED_PAYMENT_METHODS = ['COD', 'VNPAY'];

/**
 * Validate và parse body + Idempotency-Key header cho POST /orders
 * @param {object} body
 * @param {string|undefined} rawIdempotencyKey
 * @returns {{ ok: true, addressId: string, couponCode: string|null, note: string|null, shippingMethod: string, paymentMethod: string, idempotencyKey: string|null } | { ok: false, status: number, message: string }}
 */
function parseCreateOrderBody(body, rawIdempotencyKey) {
  const raw = body || {};
  const paymentMethod = raw.paymentMethod || 'COD';
  const shippingMethod = raw.shippingMethod || 'STANDARD';
  const addressId = String(raw.addressId || '');

  if (!/^\d+$/.test(addressId) ||
      (raw.couponCode != null && (typeof raw.couponCode !== 'string' || raw.couponCode.length > 40)) ||
      (raw.note != null && (typeof raw.note !== 'string' || raw.note.length > 1000)) ||
      !SUPPORTED_SHIPPING_METHODS.includes(shippingMethod) ||
      !SUPPORTED_PAYMENT_METHODS.includes(paymentMethod)) {
    return {
      ok: false,
      status: 400,
      message: 'Invalid checkout information. Choose a supported delivery and payment method.'
    };
  }

  const idempotencyKey = typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey.trim() : null;
  if (idempotencyKey && !/^[A-Za-z0-9:_-]{8,100}$/.test(idempotencyKey)) {
    return {
      ok: false,
      status: 400,
      message: 'Invalid Idempotency-Key.'
    };
  }

  return {
    ok: true,
    addressId,
    couponCode: raw.couponCode ? raw.couponCode.trim() : null,
    note: raw.note ? raw.note.trim() : null,
    shippingMethod,
    paymentMethod,
    idempotencyKey: idempotencyKey || null
  };
}

const CANCELABLE_CUSTOMER_STATUSES = ['PENDING', 'CONFIRMED'];

/**
 * Kiểm tra xem khách hàng có được phép tự hủy đơn hay không (Khu vực 2a).
 * Nghiệp vụ: Khách được tự hủy khi đơn ở trạng thái PENDING hoặc CONFIRMED và UNPAID.
 * Các trường hợp khác (PAID, PROCESSING, SHIPPED, DELIVERED, CANCELLED) đều bị từ chối 409.
 *
 * @param {object} order
 * @returns {{ canCancel: true, fromStatus: string } | { canCancel: false, status: number, message: string }}
 */
function canCustomerCancel(order) {
  if (!order || typeof order !== 'object') {
    return { canCancel: false, status: 404, message: 'Order not found.' };
  }
  if (!CANCELABLE_CUSTOMER_STATUSES.includes(order.status) || order.payment_status !== 'UNPAID') {
    return {
      canCancel: false,
      status: 409,
      message: 'Only pending unpaid or confirmed unpaid orders can be cancelled by the customer.'
    };
  }
  return { canCancel: true, fromStatus: order.status };
}

module.exports = {
  SUPPORTED_SHIPPING_METHODS,
  SUPPORTED_PAYMENT_METHODS,
  CANCELABLE_CUSTOMER_STATUSES,
  parseCreateOrderBody,
  canCustomerCancel
};

