'use strict';

/**
 * returnStatusLabels.js
 * Bảng nhãn tiếng Việt nội bộ backend cho các trạng thái yêu cầu đổi trả.
 * Đồng bộ 1-1 với RETURN_STATUS trong core-frontend/src/lib/labels.js.
 */

const RETURN_STATUS_LABELS = Object.freeze({
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Đã từ chối',
  COMPLETED: 'Hoàn tất',
});

function getReturnStatusLabel(status) {
  if (status == null || status === '') return '';
  const key = String(status).trim();
  return RETURN_STATUS_LABELS[key] || key;
}

module.exports = {
  RETURN_STATUS_LABELS,
  getReturnStatusLabel,
};
