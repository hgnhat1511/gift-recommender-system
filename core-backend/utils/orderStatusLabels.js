'use strict';

/**
 * orderStatusLabels.js
 * Bảng nhãn tiếng Việt nội bộ backend cho 6 trạng thái đơn hàng:
 * PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED.
 * Dùng khi sinh thông báo và audit log gửi cho khách hàng / quản trị viên.
 * Được đồng bộ 1-1 với ORDER_STATUS trong core-frontend/src/lib/labels.js.
 */

const ORDER_STATUS_LABELS = Object.freeze({
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  PROCESSING: 'Đang chuẩn bị hàng',
  SHIPPED: 'Đang giao hàng',
  DELIVERED: 'Đã giao hàng',
  CANCELLED: 'Đã hủy',
});

function getOrderStatusLabel(status) {
  if (status == null || status === '') return '';
  const key = String(status).trim();
  return ORDER_STATUS_LABELS[key] || key;
}

module.exports = {
  ORDER_STATUS_LABELS,
  getOrderStatusLabel,
};
