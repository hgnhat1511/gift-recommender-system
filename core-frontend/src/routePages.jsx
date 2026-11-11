import { lazy } from 'react';
import { APP_LABEL } from './lib/labels.js';

const loadAdminPages = () => import('./pages/admin/AdminPages.jsx');

export function RouteLoading() {
  return <main className="commerce-page commerce-loading" role="status" aria-live="polite">{APP_LABEL.PAGE_LOADING}</main>;
}

export const App = lazy(() => import('./App.jsx'));
export const LoginPage = lazy(() => import('./pages/auth/LoginPage.jsx'));
export const RegisterPage = lazy(() => import('./pages/auth/RegisterPage.jsx'));
export const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage.jsx'));
export const ProductsPage = lazy(() => import('./pages/store/CatalogPages.jsx').then((pages) => ({ default: pages.ProductsPage })));
export const ProductDetailPage = lazy(() => import('./pages/store/CatalogPages.jsx').then((pages) => ({ default: pages.ProductDetailPage })));
export const GiftFinderPage = lazy(() => import('./pages/store/CatalogPages.jsx').then((pages) => ({ default: pages.GiftFinderPage })));
export const CartPage = lazy(() => import('./pages/store/CommercePages.jsx').then((pages) => ({ default: pages.CartPage })));
export const CheckoutPage = lazy(() => import('./pages/store/CommercePages.jsx').then((pages) => ({ default: pages.CheckoutPage })));
export const OrdersPage = lazy(() => import('./pages/store/CommercePages.jsx').then((pages) => ({ default: pages.OrdersPage })));
export const OrderDetailPage = lazy(() => import('./pages/store/CommercePages.jsx').then((pages) => ({ default: pages.OrderDetailPage })));
export const AccountPage = lazy(() => import('./pages/account/AccountPages.jsx').then((pages) => ({ default: pages.AccountPage })));
export const FavoritesPage = lazy(() => import('./pages/account/AccountPages.jsx').then((pages) => ({ default: pages.FavoritesPage })));
export const ShipperPage = lazy(() => import('./pages/shipper/ShipperPage.jsx'));
export const AdminLayout = lazy(() => loadAdminPages().then((pages) => ({ default: pages.AdminLayout })));
export const AdminDashboard = lazy(() => loadAdminPages().then((pages) => ({ default: pages.AdminDashboard })));
export const AdminProducts = lazy(() => loadAdminPages().then((pages) => ({ default: pages.AdminProducts })));
export const AdminInventory = lazy(() => loadAdminPages().then((pages) => ({ default: pages.AdminInventory })));
export const AdminCategories = lazy(() => loadAdminPages().then((pages) => ({ default: pages.AdminCategories })));
export const AdminBanners = lazy(() => loadAdminPages().then((pages) => ({ default: pages.AdminBanners })));
export const AdminOrders = lazy(() => loadAdminPages().then((pages) => ({ default: pages.AdminOrders })));
export const AdminCustomers = lazy(() => loadAdminPages().then((pages) => ({ default: pages.AdminCustomers })));
export const AdminDeletionRequests = lazy(() => loadAdminPages().then((pages) => ({ default: pages.AdminDeletionRequests })));
export const AdminReturns = lazy(() => loadAdminPages().then((pages) => ({ default: pages.AdminReturns })));
export const AdminReviews = lazy(() => loadAdminPages().then((pages) => ({ default: pages.AdminReviews })));
export const CouponAdminPage = lazy(() => import('./pages/admin/CouponAdminPage.jsx'));
