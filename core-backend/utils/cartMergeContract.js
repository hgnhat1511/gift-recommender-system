/**
 * cartMergeContract.js
 * Hàm thuần tách từ cartController để tái sử dụng và kiểm thử độc lập.
 *
 * Hợp đồng chuẩn: body phải chứa field `mergeKey` (khớp cột cart_merge_requests.merge_key).
 * Fallback: chấp nhận cả `key` làm dự phòng cho các phiên gộp dở còn lưu trong
 * localStorage của trình duyệt từ các bản build trước v1d, tránh làm mất giỏ khách khi user đăng nhập.
 */
'use strict';

/** @param {number|string|undefined} v */
function quantity(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : 0;
}

/**
 * Phân tích và validate body của POST /cart/merge.
 *
 * @param {object} body - req.body từ Express
 * @returns {{ ok: true, mergeKey: string, items: Array, requested: Map } | { ok: false, status: number, message: string }}
 */
function parseMergeBody(body) {
  const raw = body || {};
  // Ưu tiên `mergeKey`; chấp nhận `key` làm fallback dự phòng cho localStorage cũ
  const mergeKey = typeof raw.mergeKey === 'string' ? raw.mergeKey
    : typeof raw.key === 'string' ? raw.key
    : undefined;

  const items = raw.items;

  if (typeof mergeKey !== 'string' || !/^[A-Za-z0-9:_-]{8,80}$/.test(mergeKey) ||
      !Array.isArray(items) || items.length < 1 || items.length > 50) {
    return { ok: false, status: 400, message: 'Invalid guest cart merge request.' };
  }

  const requested = new Map();
  const parsedItems = [];
  for (const item of items) {
    const productId = String(item?.productId || '');
    const qty = quantity(item?.quantity);
    if (!/^\d{1,20}$/.test(productId) || !qty || typeof item?.selected !== 'boolean' || requested.has(productId)) {
      return { ok: false, status: 400, message: 'Guest cart contains an invalid or duplicate item.' };
    }
    requested.set(productId, { quantity: qty, selected: item.selected });
    parsedItems.push({ productId, quantity: qty, selected: item.selected });
  }

  return { ok: true, mergeKey, requested, items: parsedItems };
}

module.exports = { parseMergeBody, quantity };
