/**
 * cartPayloads.js
 * Các hàm thuần dựng payload gửi lên API backend cho giỏ hàng và đặt hàng.
 * Frontend sử dụng trực tiếp các hàm này, test runner import để kiểm thử hợp đồng code thật.
 */

export function buildAddCartItemPayload(productId, quantity = 1) {
  return { productId: Number(productId), quantity: Number(quantity) };
}

export function buildUpdateCartItemPayload(quantity) {
  return { quantity: Number(quantity) };
}

export function buildUpdateSelectionPayload(isSelected) {
  return { isSelected: Boolean(isSelected) };
}

export function buildUpdateAllSelectionPayload(isSelected) {
  return { isSelected: Boolean(isSelected) };
}

export function buildCreateOrderPayload({ addressId, shippingMethod = 'STANDARD', paymentMethod = 'COD', couponCode, note }) {
  return {
    addressId: Number(addressId),
    shippingMethod,
    paymentMethod,
    couponCode: couponCode ? String(couponCode).trim() : null,
    note: note ? String(note).trim() : null,
  };
}
