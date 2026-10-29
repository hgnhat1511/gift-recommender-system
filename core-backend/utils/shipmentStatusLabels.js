'use strict';

/**
 * shipmentStatusLabels.js
 * Bảng nhãn tiếng Việt nội bộ backend cho các trạng thái vận đơn GHN.
 * Đồng bộ 1-1 với SHIPMENT_STATUS trong core-frontend/src/lib/labels.js.
 */

const SHIPMENT_STATUS_LABELS = Object.freeze({
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

function getShipmentStatusLabel(status) {
  if (status == null || status === '') return '';
  const key = String(status).trim();
  return SHIPMENT_STATUS_LABELS[key] || key;
}

module.exports = {
  SHIPMENT_STATUS_LABELS,
  getShipmentStatusLabel,
};
