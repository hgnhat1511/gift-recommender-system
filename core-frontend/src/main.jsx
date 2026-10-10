
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import App from "./App.jsx";
import LoginPage from "./pages/auth/LoginPage.jsx";
import RegisterPage from "./pages/auth/RegisterPage.jsx";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage.jsx";
import { ProductsPage, ProductDetailPage, GiftFinderPage } from './pages/store/CatalogPages.jsx';
import { CartPage, CheckoutPage, OrdersPage, OrderDetailPage } from './pages/store/CommercePages.jsx';
import { AccountPage, FavoritesPage } from './pages/account/AccountPages.jsx';
import { AdminLayout, AdminDashboard, AdminProducts, AdminInventory, AdminCategories, AdminBanners, AdminOrders, AdminCustomers, AdminDeletionRequests, AdminReturns, AdminReviews } from './pages/admin/AdminPages.jsx';
import CouponAdminPage from './pages/admin/CouponAdminPage.jsx';
import { StoreLayout, RequireUser, RequireAdmin } from './layouts/StoreLayout.jsx';

import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
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
    </BrowserRouter>
  </React.StrictMode>
);
