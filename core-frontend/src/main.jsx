import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { CartProvider } from './context/CartContext.jsx';
import { StoreLayout, RequireAdmin, RequireShipper, RequireUser } from './layouts/StoreLayout.jsx';
import {
  AccountPage,
  AdminBanners,
  AdminCategories,
  AdminCustomers,
  AdminDashboard,
  AdminDeletionRequests,
  AdminInventory,
  AdminLayout,
  AdminOrders,
  AdminProducts,
  AdminReturns,
  AdminReviews,
  App,
  CartPage,
  CheckoutPage,
  CouponAdminPage,
  FavoritesPage,
  ForgotPasswordPage,
  GiftFinderPage,
  LoginPage,
  OrderDetailPage,
  OrdersPage,
  ProductDetailPage,
  ProductsPage,
  RegisterPage,
  RouteLoading,
  ShipperPage,
} from './routePages.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <CartProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/" element={<App />} />
            <Route element={<StoreLayout />}>
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/products/:id" element={<ProductDetailPage />} />
              <Route path="/gift-finder" element={<GiftFinderPage />} />
              <Route path="/cart" element={<CartPage />} />
              <Route element={<RequireUser />}>
                <Route path="/checkout" element={<CheckoutPage />} />
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/orders/:id" element={<OrderDetailPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/favorites" element={<FavoritesPage />} />
              </Route>
            </Route>
            <Route element={<StoreLayout />}>
              <Route element={<RequireShipper />}>
                <Route path="/shipper" element={<ShipperPage />} />
              </Route>
            </Route>
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="products" element={<AdminProducts />} />
                <Route path="inventory" element={<AdminInventory />} />
                <Route path="categories" element={<AdminCategories />} />
                <Route path="banners" element={<AdminBanners />} />
                <Route path="orders" element={<AdminOrders />} />
                <Route path="customers" element={<AdminCustomers />} />
                <Route path="deletion-requests" element={<AdminDeletionRequests />} />
                <Route path="coupons" element={<CouponAdminPage />} />
                <Route path="returns" element={<AdminReturns />} />
                <Route path="reviews" element={<AdminReviews />} />
              </Route>
            </Route>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="*" element={<main className="commerce-page commerce-empty"><h1>Không tìm thấy trang</h1><a href="/">Về trang chủ</a></main>} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </CartProvider>
  </React.StrictMode>,
);
