/**
 * cartItemContract.js
 * Các hàm parser thuần kiểm tra hợp đồng dữ liệu cho các endpoint giỏ hàng:
 * - POST /cart/items
 * - PATCH /cart/items/:itemId
 * - PATCH /cart/items/:itemId/selection
 * - PATCH /cart/selection
 */
'use strict';

const { validateQuantity } = require('./cartHelper');

/**
 * Validate và parse body cho POST /cart/items
 * @param {object} body { productId, quantity }
 * @returns {{ ok: true, productId: string, quantity: number } | { ok: false, status: number, message: string }}
 */
function parseAddCartItemBody(body) {
  const raw = body || {};
  const qty = validateQuantity(raw.quantity ?? 1);
  const productId = String(raw.productId || '');
  if (!/^\d+$/.test(productId) || !qty) {
    return { ok: false, status: 400, message: 'Invalid product or quantity.' };
  }
  return { ok: true, productId, quantity: qty };
}

/**
 * Validate và parse params + body cho PATCH /cart/items/:itemId
 * @param {object} params { itemId }
 * @param {object} body { quantity }
 * @returns {{ ok: true, itemId: string, quantity: number } | { ok: false, status: number, message: string }}
 */
function parseUpdateCartItemBody(params, body) {
  const itemId = String(params?.itemId || '');
  const qty = validateQuantity(body?.quantity);
  if (!qty || !/^\d+$/.test(itemId)) {
    return { ok: false, status: 400, message: 'Invalid quantity.' };
  }
  return { ok: true, itemId, quantity: qty };
}

/**
 * Validate và parse params + body cho PATCH /cart/items/:itemId/selection
 * @param {object} params { itemId }
 * @param {object} body { isSelected }
 * @returns {{ ok: true, itemId: string, isSelected: boolean } | { ok: false, status: number, message: string }}
 */
function parseUpdateSelectionBody(params, body) {
  const itemId = String(params?.itemId || '');
  if (!/^\d+$/.test(itemId) || typeof body?.isSelected !== 'boolean') {
    return { ok: false, status: 400, message: 'isSelected must be a boolean.' };
  }
  return { ok: true, itemId, isSelected: body.isSelected };
}

/**
 * Validate và parse body cho PATCH /cart/selection (chọn/bỏ chọn tất cả)
 * @param {object} body { isSelected }
 * @returns {{ ok: true, isSelected: boolean } | { ok: false, status: number, message: string }}
 */
function parseUpdateAllSelectionBody(body) {
  if (typeof body?.isSelected !== 'boolean') {
    return { ok: false, status: 400, message: 'isSelected must be a boolean.' };
  }
  return { ok: true, isSelected: body.isSelected };
}

module.exports = {
  parseAddCartItemBody,
  parseUpdateCartItemBody,
  parseUpdateSelectionBody,
  parseUpdateAllSelectionBody
};
