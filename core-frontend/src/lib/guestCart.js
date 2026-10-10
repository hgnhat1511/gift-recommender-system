const STORAGE_KEY = 'giftly.guest-cart';
const CART_EVENT = 'giftly:guest-cart-change';

function createId() {
  return globalThis.crypto?.randomUUID?.() || `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readState() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!value || typeof value !== 'object' || !Array.isArray(value.items)) {
      return { id: createId(), items: [], pendingMerge: null };
    }
    const unique = new Map();
    for (const item of value.items.slice(0, 50)) {
      const productId = String(item?.productId || '');
      const quantity = Number(item?.quantity);
      if (!/^\d{1,20}$/.test(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) continue;
      const previous = unique.get(productId);
      if (!previous) unique.set(productId, { productId, quantity, selected: item.selected !== false });
      else previous.quantity = Math.min(99, previous.quantity + quantity);
    }
    return {
      id: typeof value.id === 'string' ? value.id : createId(),
      items: [...unique.values()],
      pendingMerge: value.pendingMerge && typeof value.pendingMerge.key === 'string' && Array.isArray(value.pendingMerge.items)
        ? value.pendingMerge
        : null,
    };
  } catch {
    return { id: createId(), items: [], pendingMerge: null };
  }
}

function writeState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new Event(CART_EVENT));
  } catch {
    // The cart stays usable in memory for the current page even if storage is unavailable.
  }
}

export function getGuestCart() {
  return readState().items;
}

export function getPendingGuestCartMerge() {
  return readState().pendingMerge;
}

export function getGuestCartCount() {
  return getGuestCart().reduce((total, item) => total + item.quantity, 0);
}

export function subscribeToGuestCart(callback) {
  window.addEventListener(CART_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CART_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function addGuestCartItem(productId, stock) {
  const state = readState();
  if (state.pendingMerge) return { ok: false, reason: 'pending' };
  const id = String(productId || '');
  const maxStock = Number(stock);
  if (!/^\d{1,20}$/.test(id) || !Number.isInteger(maxStock) || maxStock < 1) return { ok: false, reason: 'unavailable' };
  const existing = state.items.find((item) => item.productId === id);
  if ((existing?.quantity || 0) >= Math.min(maxStock, 99)) return { ok: false, reason: 'stock' };
  if (!existing && state.items.length >= 50) return { ok: false, reason: 'limit' };
  if (existing) existing.quantity += 1;
  else state.items.push({ productId: id, quantity: 1, selected: true });
  writeState(state);
  return { ok: true };
}

export function updateGuestCartItem(productId, changes) {
  const state = readState();
  if (state.pendingMerge) return false;
  const item = state.items.find((entry) => entry.productId === String(productId));
  if (!item) return false;
  if (Number.isInteger(changes.quantity) && changes.quantity >= 1 && changes.quantity <= 99) item.quantity = changes.quantity;
  if (typeof changes.selected === 'boolean') item.selected = changes.selected;
  writeState(state);
  return true;
}

export function removeGuestCartItem(productId) {
  const state = readState();
  if (state.pendingMerge) return false;
  state.items = state.items.filter((item) => item.productId !== String(productId));
  writeState(state);
  return true;
}

export function beginGuestCartMerge() {
  const state = readState();
  if (state.pendingMerge) return state.pendingMerge;
  if (!state.items.length) return null;
  const pendingMerge = {
    key: createId(),
    items: state.items.map(({ productId, quantity, selected }) => ({ productId, quantity, selected })),
  };
  writeState({ ...state, pendingMerge });
  return pendingMerge;
}

export function clearGuestCartMergePending() {
  const state = readState();
  if (!state.pendingMerge) return;
  writeState({ ...state, pendingMerge: null });
}

export function completeGuestCartMerge(key) {
  const state = readState();
  if (state.pendingMerge?.key !== key) return false;
  writeState({ id: createId(), items: [], pendingMerge: null });
  return true;
}

export function clearGuestCart() {
  writeState({ id: createId(), items: [], pendingMerge: null });
}
