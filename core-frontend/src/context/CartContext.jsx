/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { getAuth } from '../lib/api.js';
import { getGuestCartCount, subscribeToGuestCart } from '../lib/guestCart.js';

const CartContext = createContext({
  cartCount: 0,
  refreshCartCount: () => {},
});

export const CART_CHANGE_EVENT = 'giftly:cart-change';

export function emitCartChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CART_CHANGE_EVENT));
  }
}

export function CartProvider({ children }) {
  const [cartCount, setCartCount] = useState(() => {
    const auth = getAuth();
    return !auth?.token ? getGuestCartCount() : 0;
  });

  const refreshCartCount = useCallback(() => {
    const auth = getAuth();
    if (!auth?.token) {
      setCartCount(getGuestCartCount());
      return;
    }
    api.get('/cart')
      .then(({ data }) => {
        if (data?.data?.itemCount !== undefined) {
          setCartCount(Number(data.data.itemCount) || 0);
        }
      })
      .catch(() => {
        // Giữ nguyên trạng thái trước đó nếu lỗi mạng, không báo thành công giả
      });
  }, []);

  useEffect(() => {
    let alive = true;
    const auth = getAuth();
    if (auth?.token) {
      api.get('/cart')
        .then(({ data }) => {
          if (alive && data?.data?.itemCount !== undefined) {
            setCartCount(Number(data.data.itemCount) || 0);
          }
        })
        .catch(() => {});
    }

    const handleSync = () => {
      refreshCartCount();
    };

    const unsubscribeGuest = subscribeToGuestCart(handleSync);
    window.addEventListener(CART_CHANGE_EVENT, handleSync);
    window.addEventListener('giftly:auth-change', handleSync);

    return () => {
      alive = false;
      unsubscribeGuest();
      window.removeEventListener(CART_CHANGE_EVENT, handleSync);
      window.removeEventListener('giftly:auth-change', handleSync);
    };
  }, [refreshCartCount]);

  return (
    <CartContext.Provider value={{ cartCount, refreshCartCount }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
