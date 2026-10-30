import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Gift,
  Search,
  Truck,
  Heart,
  ShoppingBag,
  UserRound,
  Sparkles,
  Menu,
  X,
  Phone,
  ShieldCheck,
} from 'lucide-react';
import { useCart } from '../context/CartContext.jsx';
import { getAuth, clearAuth } from '../lib/api.js';
import { siteInfo } from '../config/siteInfo.js';
import './SiteHeader.css';

export function SiteHeader() {
  const [search, setSearch] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { cartCount } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = getAuth();
  const isAdmin = auth?.user?.role === 'ADMIN';

  const handleSearch = (e) => {
    e.preventDefault();
    if (search.trim()) {
      navigate(`/products?q=${encodeURIComponent(search.trim())}`);
      setMobileMenuOpen(false);
    }
  };

  const handleLogout = () => {
    clearAuth();
    navigate('/');
    setMobileMenuOpen(false);
  };

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <header className="site-grand-header" role="banner">
      {/* Tầng 1: Announcement Bar (Cuộn mất khi lướt trang, KHÔNG sticky) */}
      <div className="site-announcement">
        <div className="site-announcement-inner">
          <div className="site-announcement-promo">
            <Sparkles size={14} aria-hidden="true" />
            <span>
              Miễn phí giao hàng tiêu chuẩn cho đơn từ {new Intl.NumberFormat('vi-VN').format(siteInfo.freeShippingMinimum)}₫ · Thanh toán COD an toàn
            </span>
          </div>
          <div className="site-announcement-info">
            {siteInfo.hotline ? (
              <span className="site-announcement-hotline">
                <Phone size={13} aria-hidden="true" />
                Hotline: <strong>{siteInfo.hotline}</strong>
              </span>
            ) : (
              <span>Giftly — Gửi quà, gửi yêu thương</span>
            )}
          </div>
        </div>
      </div>

      {/* Tầng 2 & 3: Sticky Container (Gồm Main Header và Sub-navigation) */}
      <div className="site-sticky-wrapper">
        {/* Tầng 2: Main Large Header (~98px) */}
        <div className="site-header-main">
          <div className="site-header-main-inner">
            {/* Logo Thương Hiệu Lớn */}
            <Link className="site-brand" to="/" aria-label="Giftly trang chủ">
              <span className="site-brand-icon">
                <Gift size={30} strokeWidth={2.2} aria-hidden="true" />
              </span>
              <span className="site-brand-name">
                giftly<span>.</span>
                <small>Gửi quà, gửi yêu thương</small>
              </span>
            </Link>

            {/* Thanh Tìm Kiếm Trung Tâm Lớn */}
            <form className="site-search-form" onSubmit={handleSearch} role="search">
              <div className="site-search-box">
                <Search size={19} className="site-search-icon" aria-hidden="true" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm món quà bạn đang nghĩ đến (sinh nhật, nến thơm, hoa sáp, thiệp...)..."
                  aria-label="Tìm kiếm quà tặng"
                />
                {search && (
                  <button
                    type="button"
                    className="site-search-clear"
                    onClick={() => setSearch('')}
                    aria-label="Xóa từ khóa tìm kiếm"
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                )}
                <button type="submit" className="site-search-submit" aria-label="Tìm quà">
                  <Search size={16} aria-hidden="true" />
                  <span>Tìm quà</span>
                </button>
              </div>
            </form>

            {/* Cụm Tiện Ích Khách Hàng */}
            <div className="site-header-actions">
              <Link to="/orders" className="site-action-item" title="Đơn hàng">
                <Truck size={21} aria-hidden="true" />
                <span>Đơn hàng</span>
              </Link>

              <Link to="/favorites" className="site-action-item" title="Yêu thích">
                <Heart size={21} aria-hidden="true" />
                <span>Yêu thích</span>
              </Link>

              <button
                type="button"
                className="site-action-item site-cart-action"
                onClick={() => navigate('/cart')}
                aria-label={`Giỏ hàng có ${cartCount} sản phẩm`}
              >
                <div className="site-cart-wrapper">
                  <ShoppingBag size={22} aria-hidden="true" />
                  {cartCount > 0 && (
                    <span className="site-cart-badge">{cartCount}</span>
                  )}
                </div>
                <span>Giỏ hàng</span>
              </button>

              <Link
                to={auth?.token ? '/account' : '/login'}
                className="site-action-item"
                title={auth?.token ? 'Tài khoản' : 'Đăng nhập'}
              >
                <UserRound size={21} aria-hidden="true" />
                <span>{auth?.token ? 'Tài khoản' : 'Đăng nhập'}</span>
              </Link>

              {isAdmin && (
                <Link to="/admin" className="site-action-item site-admin-action" title="Quản trị">
                  <ShieldCheck size={21} aria-hidden="true" />
                  <span>Quản trị</span>
                </Link>
              )}

              {/* Nút Hamburger menu trên mobile */}
              <button
                type="button"
                className="site-mobile-toggle"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label={mobileMenuOpen ? 'Đóng menu' : 'Mở menu điều hướng'}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>

        {/* Tầng 3: Secondary Navigation Bar (~46px) */}
        <nav
          className={`site-header-subnav ${mobileMenuOpen ? 'is-mobile-open' : ''}`}
          aria-label="Điều hướng chính"
        >
          <div className="site-subnav-inner">
            <Link
              to="/"
              className={`site-subnav-link ${isActive('/') && location.pathname === '/' ? 'is-active' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              Trang chủ
            </Link>
            <Link
              to="/products"
              className={`site-subnav-link ${isActive('/products') ? 'is-active' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              Cửa hàng
            </Link>
            <Link
              to="/gift-finder"
              className={`site-subnav-link site-finder-link ${isActive('/gift-finder') ? 'is-active' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              <Sparkles size={15} aria-hidden="true" />
              <span>Gợi ý quà tặng</span>
            </Link>
            <Link
              to="/products?sort=popular"
              className="site-subnav-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              Bán chạy nhất
            </Link>
            <Link
              to="/products?category=1"
              className="site-subnav-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              Quà sinh nhật
            </Link>
            <Link
              to="/products?category=2"
              className="site-subnav-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              Quà tình yêu
            </Link>
            <Link
              to="/products?category=3"
              className="site-subnav-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              Quà handmade
            </Link>
            <Link
              to="/products?category=5"
              className="site-subnav-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              Hoa & cây cảnh
            </Link>

            {auth?.token && (
              <button
                type="button"
                className="site-subnav-logout"
                onClick={handleLogout}
              >
                Đăng xuất
              </button>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}

export default SiteHeader;
