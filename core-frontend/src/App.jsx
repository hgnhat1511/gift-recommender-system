import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search,
  ShoppingBag,
  UserRound,
  Heart,
  Gift,
  Sparkles,
  ArrowRight,
  Truck,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  Menu,
  X,
  Cake,
  Flower2,
  Coffee,
  Package,
  Home,
  GraduationCap,
  Briefcase,
  Phone,
  MessageCircle,
  Tag,
  Percent,
  Clock,
  Sparkle,
} from 'lucide-react';
import './App.css';
import api, { getAuth, getApiError } from './lib/api.js';
import { ProductCard } from './pages/store/CatalogPages.jsx';
import { useCart } from './context/CartContext.jsx';
import { FloatingSocialDock } from './components/FloatingSocialDock.jsx';

function FacebookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  );
}

function TwitterXIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  );
}

function ZaloIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" fill="currentColor" aria-hidden="true">
      <path d="M24 4C13 4 4 12.1 4 22c0 5.6 3 10.7 7.7 14.1-.3 2.1-1.4 5.3-3.2 7.3 0 0 4.7-.6 8.5-3.3 2.2.6 4.6.9 7 .9 11 0 20-8.1 20-18S35 4 24 4zm8.6 24.5h-9.8c-.8 0-1.4-.6-1.4-1.4 0-.4.2-.8.5-1.1l7.1-8.2h-6.2c-.8 0-1.4-.6-1.4-1.4s.6-1.4 1.4-1.4h9.8c.8 0 1.4.6 1.4 1.4 0 .4-.2.8-.5 1.1l-7.1 8.2h6.2c.8 0 1.4.6 1.4 1.4s-.6 1.4-1.4 1.4z"/>
    </svg>
  );
}

const categoryIcons = [Cake, Heart, Flower2, Gift, Coffee, Sparkles];
const categoryColors = ['pink', 'rose', 'green', 'purple', 'orange', 'blue'];

const festiveOccasions = [
  { id: 'birthday', name: 'Sinh nhật & Kỷ niệm', icon: Cake, path: '/products?occasion=birthday', badge: 'Hot' },
  { id: 'valentines', name: 'Lễ tình nhân (Valentine)', icon: Heart, path: '/products?occasion=valentines', badge: 'Lãng mạn' },
  { id: 'women', name: 'Quốc tế Phụ nữ (8/3 - 20/10)', icon: Flower2, path: '/products?occasion=anniversary', badge: 'Ý nghĩa' },
  { id: 'holiday', name: 'Giáng sinh & Năm mới (Tết)', icon: Sparkles, path: '/products?occasion=thank-you', badge: 'Mùa lễ' },
  { id: 'housewarming', name: 'Tân gia & Khai trương', icon: Home, path: '/products?occasion=housewarming' },
  { id: 'graduation', name: 'Tốt nghiệp & Thăng chức', icon: GraduationCap, path: '/products?occasion=graduation' },
  { id: 'corporate', name: 'Quà doanh nghiệp & Tri ân', icon: Briefcase, path: '/products?occasion=thank-you' },
  { id: 'all', name: 'Tất cả bộ sưu tập quà', icon: Gift, path: '/products' },
];

const recipientGroups = [
  { id: 'partner', name: 'Người yêu / Bạn đời', path: '/products?recipient=partner' },
  { id: 'mother', name: 'Mẹ & Phụ nữ yêu thương', path: '/products?recipient=mother' },
  { id: 'father', name: 'Bố & Nam giới tinh tế', path: '/products?recipient=father' },
  { id: 'friend', name: 'Bạn bè & Bạn thân', path: '/products?recipient=friend' },
  { id: 'colleague', name: 'Sếp & Đồng nghiệp', path: '/products?recipient=colleague' },
  { id: 'teacher', name: 'Thầy cô giáo kính yêu', path: '/products?recipient=teacher' },
];

const giftTypeGroups = [
  { id: 'box', name: 'Hộp quà & Set quà cao cấp', path: '/products?category=1' },
  { id: 'flowers', name: 'Hoa tươi & Hoa sáp nghệ thuật', path: '/products?category=2' },
  { id: 'scents', name: 'Nến thơm & Tinh dầu thư giãn', path: '/products?category=3' },
  { id: 'treats', name: 'Trà, Cà phê & Bánh ngọt', path: '/products?category=4' },
  { id: 'plants', name: 'Cây cảnh để bàn phong thủy', path: '/products?category=5' },
  { id: 'handmade', name: 'Quà lưu niệm & Thủ công', path: '/products?category=6' },
];

const budgetGroups = [
  { id: 'under-300', name: 'Dưới 300.000₫', path: '/products?maxPrice=300000' },
  { id: '300-600', name: '300.000₫ – 600.000₫', path: '/products?minPrice=300000&maxPrice=600000' },
  { id: '600-1200', name: '600.000₫ – 1.200.000₫', path: '/products?minPrice=600000&maxPrice=1200000' },
  { id: 'above-1200', name: 'Trên 1.200.000₫ (Cao cấp)', path: '/products?minPrice=1200000' },
];

const defaultFestiveSlides = [
  {
    id: 'default-1',
    tag: 'MÙA LỄ HỘI · TRAO GỬI YÊU THƯƠNG',
    title: 'Quà Tặng Mùa Lễ Hội · Đong Đầy Hạnh Phúc',
    subtitle: 'Tuyển tập hộp quà thiết kế sang trọng, nến thơm và phụ kiện tinh tế dành tặng người thân yêu.',
    buttonText: 'Khám phá ngay',
    targetUrl: '/products',
    secondaryButtonText: 'Tư vấn chọn quà',
    secondaryTargetUrl: '/gift-finder',
    imageUrl: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?auto=format&fit=crop&w=1200&q=80',
    highlightBadge: 'Ưu đãi mùa lễ hội',
  },
  {
    id: 'default-2',
    tag: 'SINH NHẬT & KỶ NIỆM',
    title: 'Món Quà Sinh Nhật · Chạm Đến Trái Tim',
    subtitle: 'Gợi ý quà tặng chuẩn gu theo sở thích, độ tuổi và ngân sách với tính năng Gift Finder thông minh.',
    buttonText: 'Xem quà sinh nhật',
    targetUrl: '/products?occasion=birthday',
    secondaryButtonText: 'Dùng Gift Finder',
    secondaryTargetUrl: '/gift-finder',
    imageUrl: 'https://images.unsplash.com/photo-1513885535751-8b9238bd345a?auto=format&fit=crop&w=1200&q=80',
    highlightBadge: 'Hộp quà thiết kế riêng',
  },
  {
    id: 'default-3',
    tag: 'QUÀ TẶNG NGƯỜI THƯƠNG',
    title: 'Ngọt Ngào Từng Khoảnh Khắc · Dành Cho Người Ấy',
    subtitle: 'Bộ sưu tập hoa sáp, trang sức và thiệp viết tay chân thành giúp bạn tỏ bày tâm ý trọn vẹn.',
    buttonText: 'Xem quà lãng mạn',
    targetUrl: '/products?occasion=valentines',
    secondaryButtonText: 'Khám phá tất cả',
    secondaryTargetUrl: '/products',
    imageUrl: 'https://images.unsplash.com/photo-1513201099705-a9746e1e201f?auto=format&fit=crop&w=1200&q=80',
    highlightBadge: 'Tặng thiệp chúc mừng',
  },
];

function App() {
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [newProducts, setNewProducts] = useState([]);
  const [popularProducts, setPopularProducts] = useState([]);
  const [recommendations, setRecommendations] = useState({ method: '', items: [] });
  const [banners, setBanners] = useState([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [sliderPaused, setSliderPaused] = useState(false);
  const [productCount, setProductCount] = useState(0);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const { cartCount } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const navigate = useNavigate();

  const activeSlides = banners.length > 0
    ? banners.map((b, i) => ({
        id: b.id || `banner-${i}`,
        tag: 'NỘI DUNG NỔI BẬT · GIFTLY',
        title: b.title,
        subtitle: b.subtitle || 'Khám phá bộ sưu tập quà tặng ý nghĩa dành riêng cho bạn.',
        buttonText: b.buttonText || 'Khám phá ngay',
        targetUrl: b.targetUrl || '/products',
        secondaryButtonText: 'Tư vấn chọn quà',
        secondaryTargetUrl: '/gift-finder',
        imageUrl: b.imageUrl,
        highlightBadge: 'Sản phẩm nổi bật',
      }))
    : defaultFestiveSlides;

  useEffect(() => {
    if (sliderPaused || activeSlides.length <= 1) return;
    const timer = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % activeSlides.length);
    }, 5500);
    return () => clearInterval(timer);
  }, [sliderPaused, activeSlides.length]);

  useEffect(() => {
    api.get('/products/banners').then(({ data }) => { setBanners(data.data || []); setActiveSlide(0); }).catch(() => {});
    api.get('/products/recommendations', { params: { limit: 6 } })
      .then(({ data }) => setRecommendations(data.data || { method: '', items: [] }))
      .catch(() => {});
    Promise.all([
      api.get('/products/categories'),
      api.get('/products', { params: { limit: 6, featured: true, sort: 'popular' } }),
      api.get('/products', { params: { limit: 6, sort: 'newest' } }),
      api.get('/products', { params: { limit: 6, sort: 'popular' } }),
    ])
      .then(([categoryResponse, productResponse, newestResponse, popularResponse]) => {
        setCategories(categoryResponse.data.data);
        setProducts(productResponse.data.data.items);
        setNewProducts(newestResponse.data.data.items);
        setPopularProducts(popularResponse.data.data.items);
        setProductCount(newestResponse.data.data.pagination.total);
      })
      .catch((error) => setProductsError(getApiError(error, 'Không tải được danh mục sản phẩm.')))
      .finally(() => setProductsLoading(false));
  }, []);

  const submitSearch = (event) => {
    event.preventDefault();
    if (search.trim()) {
      navigate(`/products?q=${encodeURIComponent(search.trim())}`);
    }
  };

  return (
    <div className="app">
      {/* =========================================================================
          1. HEADER TO HƠN 2.5 LẦN (Grand Festive E-Commerce Header)
          - Tầng 1: Announcement Top Bar
          - Tầng 2: Main Header (Logo lớn + Search bar trung tâm + Tiện ích khách hàng)
          - Tầng 3: Secondary Sub-navigation Bar
          ========================================================================= */}
      <header className="header grand-header">
        {/* Tầng 1: Announcement Bar */}
        <div className="announcement">
          <div className="announcement-inner">
            <div className="announcement-promo">
              <Sparkles size={15} />
              <span>Thanh toán COD toàn quốc · Miễn phí giao hàng cho đơn từ 500K · Đổi trả thuận tiện</span>
            </div>
            <div className="announcement-contact">
              <Phone size={13} />
              <span>Hotline: <strong>1900 6868</strong> (8:00 – 21:30)</span>
            </div>
          </div>
        </div>

        {/* Tầng 2: Main Large Header */}
        <div className="header-main">
          <div className="header-main-inner">
            {/* Logo Thương hiệu to hơn */}
            <Link className="brand grand-brand" to="/" aria-label="Giftly trang chủ">
              <span className="brand-icon grand-brand-icon">
                <Gift size={32} strokeWidth={2.2} />
              </span>
              <span className="brand-name grand-brand-name">
                giftly<span>.</span>
                <small>Gửi quà, gửi yêu thương</small>
              </span>
            </Link>

            {/* Thanh Tìm Kiếm Lớn ở Giữa (giống Chus / E-Commerce chuẩn) */}
            <form className="header-search-form" onSubmit={submitSearch} role="search">
              <div className="header-search-box">
                <Search size={20} className="search-input-icon" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm món quà bạn đang nghĩ đến (sinh nhật, nến thơm, hoa sáp, hộp quà cao cấp...)..."
                  aria-label="Tìm kiếm quà tặng"
                />
                {search && (
                  <button type="button" className="search-clear-btn" onClick={() => setSearch('')} aria-label="Xóa">
                    <X size={16} />
                  </button>
                )}
                <button type="submit" className="search-submit-btn">
                  <Search size={18} />
                  <span>Tìm quà</span>
                </button>
              </div>
            </form>

            {/* Các Nút Hành Động Phía Phải (Đơn hàng, Yêu thích, Giỏ hàng, Tài khoản) */}
            <div className="header-actions grand-actions">
              <Link to="/orders" className="header-action-item" title="Tra cứu đơn hàng">
                <Truck size={22} />
                <span>Đơn hàng</span>
              </Link>

              <Link to="/favorites" className="header-action-item" title="Danh sách yêu thích">
                <Heart size={22} />
                <span>Yêu thích</span>
              </Link>

              <button
                type="button"
                className="header-action-item cart-action-item"
                onClick={() => navigate('/cart')}
                aria-label={`Giỏ hàng có ${cartCount} sản phẩm`}
              >
                <div className="cart-icon-wrapper">
                  <ShoppingBag size={23} />
                  {cartCount > 0 && <span className="cart-badge-count">{cartCount}</span>}
                </div>
                <span>Giỏ hàng</span>
              </button>

              <Link
                to={getAuth()?.token ? '/account' : '/login'}
                className="header-action-item account-action-item"
                title="Tài khoản cá nhân"
              >
                <UserRound size={22} />
                <span>{getAuth()?.token ? 'Tài khoản' : 'Đăng nhập'}</span>
              </Link>

              {/* Mobile menu trigger */}
              <button
                className="icon-button mobile-menu"
                aria-label="Mở menu"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                {menuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>

        {/* Tầng 3: Secondary Navigation Bar */}
        <nav className={`header-subnav ${menuOpen ? 'subnav-open' : ''}`}>
          <div className="subnav-inner">
            <Link to="/" className="subnav-link is-active" onClick={() => setMenuOpen(false)}>
              Trang chủ
            </Link>
            <Link to="/products" className="subnav-link" onClick={() => setMenuOpen(false)}>
              Danh mục quà
            </Link>
            <Link to="/products" className="subnav-link" onClick={() => setMenuOpen(false)}>
              Tất cả sản phẩm
            </Link>
            <Link to="/gift-finder" className="subnav-link highlight-link" onClick={() => setMenuOpen(false)}>
              <Sparkles size={16} /> Gift Finder (Trợ lý AI)
            </Link>
            <Link to="/products?sort=popular" className="subnav-link" onClick={() => setMenuOpen(false)}>
              Bán chạy nhất
            </Link>
            <Link to="/products?occasion=holiday" className="subnav-link" onClick={() => setMenuOpen(false)}>
              Ưu đãi mùa lễ hội
            </Link>
            <Link to="/products?occasion=thank-you" className="subnav-link" onClick={() => setMenuOpen(false)}>
              Quà doanh nghiệp
            </Link>
          </div>
        </nav>
      </header>

      {/* =========================================================================
          2. BỐ CỤC 3 CỘT (PORTAL LAYOUT) TRANG CHỦ
          - CỘT TRÁI: Menu danh mục các dịp lễ, quà kéo dài suốt trang (như Reddit)
          - CỘT GIỮA: Nội dung trang chủ (Hero carousel + Sản phẩm CĂN GIỮA)
          - CỘT PHẢI: Quảng cáo mùa lễ hội + Kênh icon liên hệ X, Facebook LUÔN NẰM TRONG MÀN HÌNH
          ========================================================================= */}
      <div className="home-portal-wrapper">
        {/* -------------------------------------------------------------
            CỘT TRÁI: Menu Danh mục các dịp lễ, loại quà kéo dài suốt trang
            ------------------------------------------------------------- */}
        <aside className="home-sidebar-left" aria-label="Menu danh mục dịp lễ và quà">
          {/* Nhóm 1: Các dịp lễ & kỷ niệm */}
          <div className="sidebar-group">
            <div className="sidebar-group-title">
              <Sparkles size={16} />
              <span>Dịp Lễ & Kỷ Niệm</span>
            </div>
            <ul className="sidebar-group-list">
              {festiveOccasions.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <Link to={item.path} className="sidebar-item-link">
                      <span className="sidebar-icon-wrap"><Icon size={16} /></span>
                      <span className="sidebar-item-name">{item.name}</span>
                      {(item.id === 'all' ? (productCount > 0 ? `${productCount}` : null) : item.badge) && (
                        <span className="sidebar-badge">
                          {item.id === 'all' ? `${productCount}` : item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Nhóm 2: Danh mục loại quà */}
          <div className="sidebar-group">
            <div className="sidebar-group-title">
              <Gift size={16} />
              <span>Danh Mục Loại Quà</span>
            </div>
            <ul className="sidebar-group-list">
              {giftTypeGroups.map((item) => (
                <li key={item.id}>
                  <Link to={item.path} className="sidebar-item-link">
                    <span className="sidebar-bullet">•</span>
                    <span className="sidebar-item-name">{item.name}</span>
                    <ChevronRight size={14} className="sidebar-arrow" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Nhóm 3: Quà theo người nhận */}
          <div className="sidebar-group">
            <div className="sidebar-group-title">
              <UserRound size={16} />
              <span>Theo Người Nhận</span>
            </div>
            <ul className="sidebar-group-list">
              {recipientGroups.map((item) => (
                <li key={item.id}>
                  <Link to={item.path} className="sidebar-item-link">
                    <span className="sidebar-bullet">•</span>
                    <span className="sidebar-item-name">{item.name}</span>
                    <ChevronRight size={14} className="sidebar-arrow" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Nhóm 4: Mức ngân sách */}
          <div className="sidebar-group">
            <div className="sidebar-group-title">
              <Tag size={16} />
              <span>Mức Ngân Sách</span>
            </div>
            <ul className="sidebar-group-list">
              {budgetGroups.map((item) => (
                <li key={item.id}>
                  <Link to={item.path} className="sidebar-item-link">
                    <span className="sidebar-bullet">•</span>
                    <span className="sidebar-item-name">{item.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Nhóm 5: Banner Trợ Lý Gift Finder */}
          <div className="sidebar-finder-promo">
            <div className="finder-promo-icon">
              <Sparkles size={24} />
            </div>
            <strong>Chưa biết chọn gì?</strong>
            <p>Để Trợ lý Gift Finder gợi ý món quà phù hợp theo người nhận và ngân sách.</p>
            <Link to="/gift-finder" className="sidebar-finder-btn">
              Khám phá ngay <ArrowRight size={14} />
            </Link>
          </div>
        </aside>

        {/* -------------------------------------------------------------
            CỘT GIỮA: Nội dung chính trang chủ (SẢN PHẨM CĂN GIỮA CHUẨN XÁC)
            ------------------------------------------------------------- */}
        <main className="home-center-content">
          {/* Banner Carousel Mùa Lễ Hội */}
          <section
            className="hero-festive-carousel"
            onMouseEnter={() => setSliderPaused(true)}
            onMouseLeave={() => setSliderPaused(false)}
            aria-label="Quảng cáo mùa lễ hội"
          >
            <div className="hero-festive-slides">
              {activeSlides.map((slide, index) => {
                const isActive = index === activeSlide;
                return (
                  <div
                    key={slide.id || index}
                    className={`hero-festive-slide ${isActive ? 'is-active' : ''}`}
                    aria-hidden={!isActive}
                  >
                    <div className="festive-slide-backdrop">
                      <img src={slide.imageUrl} alt={slide.title} loading={index === 0 ? 'eager' : 'lazy'} />
                      <div className="festive-slide-overlay" />
                    </div>

                    <div className="festive-slide-content">
                      {slide.highlightBadge && (
                        <div className="festive-badge">
                          <Sparkles size={14} />
                          <span>{slide.highlightBadge}</span>
                        </div>
                      )}

                      <span className="festive-kicker">{slide.tag}</span>

                      <h1 className="festive-title">{slide.title}</h1>

                      {slide.subtitle && <p className="festive-subtitle">{slide.subtitle}</p>}

                      <div className="festive-actions">
                        <Link to={slide.targetUrl || '/products'} className="primary-button festive-btn-primary">
                          {slide.buttonText || 'Khám phá ngay'} <ArrowRight size={17} />
                        </Link>
                        {slide.secondaryButtonText && (
                          <Link to={slide.secondaryTargetUrl || '/gift-finder'} className="secondary-button festive-btn-secondary">
                            <Sparkles size={16} /> {slide.secondaryButtonText}
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Điều khiển Slide: Nút Prev / Next & Chấm tròn */}
            {activeSlides.length > 1 && (
              <>
                <button
                  type="button"
                  className="hero-slide-nav hero-slide-prev"
                  onClick={() => setActiveSlide((prev) => (prev - 1 + activeSlides.length) % activeSlides.length)}
                  aria-label="Banner trước"
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  type="button"
                  className="hero-slide-nav hero-slide-next"
                  onClick={() => setActiveSlide((prev) => (prev + 1) % activeSlides.length)}
                  aria-label="Banner kế tiếp"
                >
                  <ChevronRight size={22} />
                </button>

                <div className="hero-slide-dots">
                  {activeSlides.map((slide, index) => (
                    <button
                      key={slide.id || index}
                      type="button"
                      className={`hero-slide-dot ${index === activeSlide ? 'is-active' : ''}`}
                      onClick={() => setActiveSlide(index)}
                      aria-label={`Chuyển đến banner ${index + 1}`}
                      aria-pressed={index === activeSlide}
                    />
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Quick Categories Bar tròn (Giống Chus.vn ở ảnh 4) */}
          <div className="quick-category-row">
            <Link to="/products?sort=popular" className="quick-cat-item">
              <div className="quick-cat-circle"><Cake size={22} /></div>
              <span>Sinh Nhật</span>
            </Link>
            <Link to="/products?occasion=valentines" className="quick-cat-item">
              <div className="quick-cat-circle"><Heart size={22} /></div>
              <span>Người Thương</span>
            </Link>
            <Link to="/products?category=1" className="quick-cat-item">
              <div className="quick-cat-circle"><Gift size={22} /></div>
              <span>Hộp Quà Cao Cấp</span>
            </Link>
            <Link to="/products?category=3" className="quick-cat-item">
              <div className="quick-cat-circle"><Coffee size={22} /></div>
              <span>Nến Thơm & Trà</span>
            </Link>
            <Link to="/products?category=2" className="quick-cat-item">
              <div className="quick-cat-circle"><Flower2 size={22} /></div>
              <span>Hoa Tươi & Sáp</span>
            </Link>
            <Link to="/gift-finder" className="quick-cat-item highlight-quick-cat">
              <div className="quick-cat-circle"><Sparkles size={22} /></div>
              <span>Gift Finder</span>
            </Link>
          </div>

          {/* Khối Gợi Ý Từ Giftly (Recommendations) - CĂN GIỮA */}
          {recommendations.items?.length > 0 && (
            <section className="section portal-section products-section" id="recommendations">
              <div className="section-heading center-section-heading">
                <div>
                  <span className="section-kicker">GỢI Ý TỪ GIFTLY</span>
                  <h2>{recommendations.method === 'personalized_activity' ? <>Gợi ý riêng cho <span>bạn</span></> : <>Món quà đang được yêu thích</>}</h2>
                  <p>{recommendations.method === 'personalized_activity'
                    ? 'Phân tích lượt xem, sở thích và tương tác gần đây của bạn.'
                    : 'Tuyển chọn những món quà ý nghĩa nhất được ưa chuộng.'}</p>
                </div>
                <Link to="/products" className="text-link">Xem tất cả <ArrowRight size={17} /></Link>
              </div>
              <div className="commerce-product-grid home-catalog-grid">
                {recommendations.items.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    recommendationSource="home"
                    onChange={setNotice}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Khối 4 Cam Kết Dịch Vụ */}
          <section className="benefits">
            <div className="benefit-item">
              <span className="benefit-icon"><Truck size={23} /></span>
              <div><strong>Giao hàng hỏa tốc</strong><small>Trao quà đúng hẹn</small></div>
            </div>
            <div className="benefit-item">
              <span className="benefit-icon"><ShieldCheck size={23} /></span>
              <div><strong>Thanh toán COD</strong><small>Kiểm tra trước khi nhận</small></div>
            </div>
            <div className="benefit-item">
              <span className="benefit-icon"><Sparkles size={23} /></span>
              <div><strong>Gift Finder AI</strong><small>So khớp quà chuẩn gu</small></div>
            </div>
            <div className="benefit-item">
              <span className="benefit-icon"><Package size={23} /></span>
              <div><strong>Đóng gói tinh tế</strong><small>Kèm thiệp viết tay</small></div>
            </div>
          </section>

          {/* Khối Quà Tặng Nổi Bật (Featured Products) - CĂN GIỮA HOÀN HẢO */}
          <section className="section portal-section products-section" id="products">
            <div className="section-heading center-section-heading">
              <div>
                <span className="section-kicker">ĐƯỢC YÊU THÍCH</span>
                <h2>Quà tặng <span>nổi bật</span></h2>
                <p>Những lựa chọn xinh xắn và ý nghĩa nhất để bạn bắt đầu trao yêu thương.</p>
              </div>
              <Link to="/products" className="text-link">Khám phá thêm <ArrowRight size={17} /></Link>
            </div>

            {productsLoading ? (
              <div className="empty-search">Đang tải sản phẩm từ cửa hàng…</div>
            ) : productsError ? (
              <div className="empty-search">{productsError}</div>
            ) : products.length > 0 ? (
              <div className="commerce-product-grid home-catalog-grid">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} onChange={setNotice} />
                ))}
              </div>
            ) : (
              <div className="empty-search">
                <Package size={35} />
                <h3>Chưa tìm thấy món quà phù hợp</h3>
                <p>Thử tìm bằng một từ khóa hoặc danh mục khác nhé.</p>
              </div>
            )}

            <div className="center-action">
              <Link className="outline-button" to="/products">
                Xem tất cả sản phẩm <ArrowRight size={17} />
              </Link>
            </div>
          </section>

          {/* Khối Sản Phẩm Mới Nhất - CĂN GIỮA */}
          {newProducts.length > 0 && (
            <section className="section portal-section products-section" id="new-products">
              <div className="section-heading center-section-heading">
                <div>
                  <span className="section-kicker">DANH MỤC GIFTLY</span>
                  <h2>Sản phẩm <span>mới nhất</span></h2>
                  <p>Các thiết kế hộp quà và hoa tươi mới được cập nhật trong cửa hàng.</p>
                </div>
                <Link to="/products?sort=newest" className="text-link">Xem tất cả <ArrowRight size={17} /></Link>
              </div>
              <div className="commerce-product-grid home-catalog-grid">
                {newProducts.map((product) => (
                  <ProductCard key={product.id} product={product} onChange={setNotice} />
                ))}
              </div>
            </section>
          )}

          {/* Khối Sản Phẩm Bán Chạy - CĂN GIỮA */}
          {popularProducts.length > 0 && (
            <section className="section portal-section products-section" id="popular-products">
              <div className="section-heading center-section-heading">
                <div>
                  <span className="section-kicker">XU HƯỚNG TẶNG QUÀ</span>
                  <h2>Được chọn <span>nhiều nhất</span></h2>
                  <p>Những món quà được đặt mua và đánh giá cao nhất thời gian gần đây.</p>
                </div>
                <Link to="/products?sort=popular" className="text-link">Khám phá thêm <ArrowRight size={17} /></Link>
              </div>
              <div className="commerce-product-grid home-catalog-grid">
                {popularProducts.map((product) => (
                  <ProductCard key={product.id} product={product} onChange={setNotice} />
                ))}
              </div>
            </section>
          )}

          {/* Khối Teaser Gift Finder */}
          <section className="ai-section" id="ai">
            <div className="ai-image">
              <img
                src="https://images.unsplash.com/photo-1512909006721-3d6018887383?auto=format&fit=crop&w=900&q=85"
                alt="Hộp quà và hoa trang trí"
                loading="lazy"
              />
              <div className="ai-image-note">
                <Sparkles size={18} />
                <span>Một món quà, ngàn lời yêu thương</span>
              </div>
            </div>
            <div className="ai-content">
              <span className="section-kicker">GIFT FINDER</span>
              <h2>Chưa biết tặng gì? <span>Để Giftly gợi ý!</span></h2>
              <p>
                Chỉ cần cho biết bạn muốn tặng ai, nhân dịp nào và ngân sách bao
                nhiêu. Hệ thống thông minh sẽ giúp bạn tìm ra những lựa chọn hoàn hảo nhất.
              </p>
              <ul className="ai-check-list">
                <li><span>✓</span> Chọn theo đối tượng và sở thích cá nhân</li>
                <li><span>✓</span> Tùy biến theo ngân sách từ tiết kiệm đến cao cấp</li>
                <li><span>✓</span> Miễn phí thiệp chúc mừng thiết kế riêng</li>
              </ul>
              <button
                className="primary-button"
                onClick={() => navigate('/gift-finder')}
              >
                Mở Gift Finder <Sparkles size={17} />
              </button>
            </div>
          </section>

          {/* Khối Closing Banner */}
          <section className="closing-banner">
            <div className="closing-icon"><Gift size={32} /></div>
            <div>
              <h2>Món quà ý nghĩa bắt đầu từ sự quan tâm chân thành.</h2>
              <p>Hãy để mỗi dịp đặc biệt trở thành kỷ niệm khó quên cùng Giftly.</p>
            </div>
            <button className="closing-button" onClick={() => navigate('/products')}>
              Chọn quà ngay <ArrowRight size={17} />
            </button>
          </section>
        </main>

        {/* -------------------------------------------------------------
            CỘT PHẢI: Quảng cáo mùa lễ & Kênh icon liên hệ X, Facebook
            LUÔN NẰM TRONG MÀN HÌNH (Sticky bám theo màn hình khi cuộn)
            ------------------------------------------------------------- */}
        <aside className="home-sidebar-right" aria-label="Quảng cáo mùa lễ hội và kênh hỗ trợ">
          <div className="sidebar-right-sticky">
            {/* Quảng cáo Mùa Lễ Hội 1: Ưu đãi voucher */}
            <div className="festive-promo-card">
              <div className="promo-card-badge">
                <Sparkles size={13} /> Ưu đãi mùa lễ hội
              </div>
              <h3 className="promo-card-title">Món Quà Tinh Tế · Trọn Vẹn Yêu Thương</h3>
              <p className="promo-card-desc">
                Giảm ngay <strong>15%</strong> cho combo set quà từ 500K. Tặng kèm thiệp chúc viết tay và hoa sáp cao cấp.
              </p>
              <div className="promo-code-box">
                <span className="promo-code-label">MÃ GIẢM GIÁ:</span>
                <code className="promo-code-val">GIFTLY15</code>
              </div>
              <Link to="/products" className="promo-card-btn">
                Sử dụng mã ngay <ArrowRight size={15} />
              </Link>
            </div>

            {/* Quảng cáo Mùa Lễ Hội 2: Giao quà tốc hành */}
            <div className="festive-promo-card promo-card-secondary">
              <div className="promo-card-badge promo-badge-secondary">
                <Truck size={13} /> Giao hàng hỏa tốc
              </div>
              <h3 className="promo-card-title">Trao Tận Tay Đúng Hẹn</h3>
              <p className="promo-card-desc">
                Dịch vụ chuyển phát quà nhanh 2H nội thành. Đảm bảo món quà nguyên vẹn và bất ngờ cho người nhận.
              </p>
              <Link to="/gift-finder" className="promo-card-btn promo-btn-outline">
                Tư vấn chọn quà <ChevronRight size={15} />
              </Link>
            </div>

            {/* Khối Kênh Liên Hệ Mạng Xã Hội X, Facebook, Zalo (LUÔN NẰM TRONG MÀN HÌNH) */}
            <div className="sidebar-social-card">
              <div className="social-card-head">
                <Phone size={18} className="social-head-icon" />
                <div>
                  <strong>Kênh Kết Nối & Hỗ Trợ</strong>
                  <small>Tư vấn quà tặng 24/7</small>
                </div>
              </div>

              <p className="social-card-text">
                Cần tư vấn chọn quà riêng hoặc đặt số lượng lớn cho công ty? Kết nối với chúng tôi qua:
              </p>

              <div className="social-btn-list">
                {/* Facebook icon & link */}
                <a
                  href="https://facebook.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-btn-item social-btn-facebook"
                  aria-label="Liên hệ Facebook Giftly"
                >
                  <FacebookIcon />
                  <div className="social-btn-text">
                    <strong>Facebook</strong>
                    <small>Giftly - Quà Tặng Yêu Thương</small>
                  </div>
                </a>

                {/* X (Twitter) icon & link */}
                <a
                  href="https://x.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-btn-item social-btn-x"
                  aria-label="Theo dõi Giftly trên X"
                >
                  <TwitterXIcon />
                  <div className="social-btn-text">
                    <strong>X (Twitter)</strong>
                    <small>@GiftlyStore</small>
                  </div>
                </a>

                {/* Zalo chat & link */}
                <a
                  href="https://zalo.me"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-btn-item social-btn-zalo"
                  aria-label="Chat Zalo Giftly"
                >
                  <ZaloIcon />
                  <div className="social-btn-text">
                    <strong>Zalo Chat</strong>
                    <small>Tư vấn trực tuyến 1:1</small>
                  </div>
                </a>
              </div>

              {/* Hotline trực tiếp */}
              <div className="social-hotline-box">
                <div className="hotline-icon">
                  <Phone size={18} />
                </div>
                <div className="hotline-info">
                  <span>Hotline hỗ trợ miễn phí:</span>
                  <a href="tel:19006868" className="hotline-link">1900 6868</a>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Footer */}
      <footer className="footer" id="account">
        <div className="footer-main">
          <div className="footer-brand">
            <a className="brand footer-brand-link" href="#home">
              <span className="brand-icon"><Gift size={24} /></span>
              <span className="brand-name">giftly<span>.</span><small>Gửi quà, gửi yêu thương</small></span>
            </a>
            <p>
              Nơi giúp bạn tìm món quà phù hợp và gửi gắm tình cảm đến những
              người quan trọng trong mọi khoảnh khắc đáng nhớ.
            </p>
          </div>
          <div className="footer-column">
            <h4>Khám phá</h4>
            <Link to="/products">Danh mục quà</Link>
            <Link to="/products?sort=popular">Sản phẩm nổi bật</Link>
            <Link to="/gift-finder">Gift Finder</Link>
          </div>
          <div className="footer-column">
            <h4>Hỗ trợ</h4>
            <Link to="/orders">Theo dõi đơn hàng</Link>
            <Link to="/account#addresses">Quản lý địa chỉ</Link>
            <Link to="/products">Xem danh mục</Link>
          </div>
          <div className="footer-column">
            <h4>Luôn có điều bất ngờ</h4>
            <p className="newsletter-copy">Chọn dịp, người nhận và ngân sách để xem các món quà phù hợp.</p>
            <Link className="newsletter-button" to="/gift-finder">Tìm quà phù hợp <ArrowRight size={16} /></Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Giftly. Đồ án hệ thống kinh doanh và gợi ý quà tặng.</span>
          <span>Được tạo nên từ sự quan tâm <Heart size={14} fill="currentColor" /></span>
        </div>
      </footer>

      {/* Cụm icon mạng xã hội FB, Zalo, IG, X, Tele cố định góc trái dưới */}
      <FloatingSocialDock />

      {/* Thông báo Toast */}
      {notice && (
        <div className="toast" role="status">
          <span className="toast-check">✓</span>
          {notice}
          <button onClick={() => setNotice('')} aria-label="Đóng thông báo">
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
