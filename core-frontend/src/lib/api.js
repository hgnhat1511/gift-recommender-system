import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
  headers: { 'Content-Type': 'application/json' },
});

export function saveAuth({ token, user }, remember = false) {
  clearAuth();
  (remember ? localStorage : sessionStorage).setItem('giftly.auth', JSON.stringify({ token, user }));
  window.dispatchEvent(new Event('giftly:auth-change'));
}

export function clearAuth() {
  localStorage.removeItem('giftly.auth');
  sessionStorage.removeItem('giftly.auth');
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('giftly:auth-change'));
}

export function getAuth() {
  try {
    return JSON.parse(localStorage.getItem('giftly.auth') || sessionStorage.getItem('giftly.auth') || 'null');
  } catch {
    clearAuth();
    return null;
  }
}

api.interceptors.request.use((config) => {
  const auth = getAuth();
  if (auth?.token) config.headers.Authorization = `Bearer ${auth.token}`;
  return config;
});

export function getApiError(error, fallback) {
  return error.response?.data?.message || fallback;
}

export default api;
