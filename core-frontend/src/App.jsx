import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Heart,
  Gift,
  Sparkles,
  ArrowRight,
  Truck,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  X,
  Cake,
  Flower2,
  Coffee,
  Package,
  Home,
  GraduationCap,
  Briefcase,
  Phone,
  Tag,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import './App.css';
import api, { getApiError } from './lib/api.js';
import { ProductCard } from './pages/store/CatalogPages.jsx';
import { SiteHeader } from './components/SiteHeader.jsx';
import { FloatingSocialDock } from './components/FloatingSocialDock.jsx';
import { siteInfo } from './config/siteInfo.js';

// Dịp lễ: Khớp chính xác với occasion_tags trong DB dev
const festiveOccasions = [
  { id: 'birthday', name: 'Sinh nhật & Kỷ niệm', icon: Cake, path: '/products?occasion=birthday', badge: 'Hot' },
  { id: 'valentines', name: 'Lễ tình nhân (Valentine)', icon: Heart, path: '/products?occasion=valentines', badge: 'Lãng mạn' },
  { id: 'anniversary', name: 'Kỷ niệm ngày cưới & tình yêu', icon: Flower2, path: '/products?occasion=anniversary', badge: 'Ý nghĩa' },
  { id: 'graduation', name: 'Tốt nghiệp & Thăng tiến', icon: GraduationCap, path: '/products?occasion=graduation' },
  { id: 'housewarming', name: 'Tân gia & Khai trương', icon: Home, path: '/products?occasion=housewarming' },
  { id: 'promotion', name: 'Thăng chức & Công việc', icon: Briefcase, path: '/products?occasion=promotion' },
  { id: 'thank-you', name: 'Cảm ơn & Tri ân', icon: Sparkles, path: '/products?occasion=thank-you' },
  { id: 'all', name: 'Tất cả sản phẩm quà tặng', icon: Gift, path: '/products' },
];

// Danh mục cửa hàng: Khớp chính xác với bảng categories (ID 1–5) trong MySQL dev
const storeCategoryGroups = [
  { id: 1, name: 'Quà sinh nhật', path: '/products?category=1' },
  { id: 2, name: 'Quà tình yêu', path: '/products?category=2' },
  { id: 3, name: 'Quà handmade', path: '/products?category=3' },
  { id: 4, name: 'Quà văn phòng', path: '/products?category=4' },
  { id: 5, name: 'Hoa & cây cảnh', path: '/products?category=5' },
];

// Loại quà: Khớp chính xác với cột gift_type trong DB dev
const giftTypeGroups = [
  { id: 'gift-box', name: 'Hộp quà & Set quà', path: '/products?giftType=gift-box' },
  { id: 'flowers', name: 'Hoa tươi & Hoa sáp', path: '/products?giftType=flowers' },
  { id: 'food', name: 'Bánh kẹo & Đồ ngọt', path: '/products?giftType=food' },
  { id: 'plant', name: 'Cây cảnh để bàn', path: '/products?giftType=plant' },
  { id: 'home', name: 'Đồ gia dụng & Trang trí', path: '/products?giftType=home' },
  { id: 'stationery', name: 'Văn phòng phẩm', path: '/products?giftType=stationery' },
];

// Người nhận: Khớp chính xác với recipient_tags trong DB dev
const recipientGroups = [
  { id: 'partner', name: 'Người yêu / Bạn đời', path: '/products?recipient=partner' },
  { id: 'mother', name: 'Mẹ', path: '/products?recipient=mother' },
  { id: 'friend', name: 'Bạn bè & Bạn thân', path: '/products?recipient=friend' },
  { id: 'colleague', name: 'Đồng nghiệp & Quản lý', path: '/products?recipient=colleague' },
  { id: 'teacher', name: 'Thầy cô', path: '/products?recipient=teacher' },
  { id: 'child', name: 'Trẻ em', path: '/products?recipient=child' },
];

// Ngân sách: Khớp với tham số minPrice và maxPrice của backend catalogController
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
    secondaryButtonText: 'Gợi ý chọn quà',
    secondaryTargetUrl: '/gift-finder',
    imageUrl: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?auto=format&fit=crop&w=1200&q=80',
    highlightBadge: 'Ưu đãi mùa lễ hội',
  },
  {
    id: 'default-2',
    tag: 'SINH NHẬT & KỶ NIỆM',
    title: 'Món Quà Sinh Nhật · Chạm Đến Trái Tim',
    subtitle: 'Gợi ý quà tặng chuẩn gu theo sở thích, độ tuổi và ngân sách với tính năng Gợi ý quà tặng thông minh.',
    buttonText: 'Xem quà sinh nhật',
    targetUrl: '/products?occasion=birthday',
    secondaryButtonText: 'Dùng Gợi ý quà tặng',
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
  const [products, setProducts] = useState([]);
  const [newProducts, setNewProducts] = useState([]);
  const [popularProducts, setPopularProducts] = useState([]);
  const [recommendations, setRecommendations] = useState({ method: '', source: '', items: [] });
  const [banners, setBanners] = useState([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [sliderPaused, setSliderPaused] = useState(false);
  const [productCount, setProductCount] = useState(0);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const [notice, setNotice] = useState('');
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const navigate = useNavigate();

  // Nguồn banner: Dùng dữ liệu từ homepage_banners nếu có, fallback sang defaultFestiveSlides
  const activeSlides = banners.length > 0
    ? banners.map((b, i) => ({
        id: b.id || `banner-${i}`,
        tag: 'NỘI DUNG NỔI BẬT · GIFTLY',
        title: b.title,
        subtitle: b.subtitle || 'Khám phá bộ sưu tập quà tặng ý nghĩa dành riêng cho bạn.',
        buttonText: b.buttonText || 'Khám phá ngay',
        targetUrl: b.targetUrl || '/products',
        secondaryButtonText: 'Gợi ý quà tặng',
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
    // 1. Banner từ DB dev (endpoint /products/banners)
    api.get('/products/banners')
      .then(({ data }) => {
        setBanners(data.data || []);
        setActiveSlide(0);
      })
      .catch(() => {});

    // 2. Gợi ý từ hệ thống
    api.get('/products/recommendations', { params: { limit: 6 } })
      .then(({ data }) => setRecommendations(data.data || { method: '', source: '', items: [] }))
      .catch(() => {});

    // 3. Sản phẩm
    Promise.all([
      api.get('/products', { params: { limit: 6, featured: true, sort: 'popular' } }),
      api.get('/products', { params: { limit: 6, sort: 'newest' } }),
      api.get('/products', { params: { limit: 6, sort: 'popular' } }),
    ])
      .then(([productResponse, newestResponse, popularResponse]) => {
        setProducts(productResponse.data.data.items);
        setNewProducts(newestResponse.data.data.items);
        setPopularProducts(popularResponse.data.data.items);
        setProductCount(newestResponse.data.data.pagination.total);
      })
      .catch((error) => setProductsError(getApiError(error, 'Không tải được danh mục sản phẩm.')))
      .finally(() => setProductsLoading(false));
  }, []);

  return (
    <div className="app">
      {/* 1. Header Dùng Chung (SiteHeader - 144px sticky, announcement 36px cuộn mất) */}
      <SiteHeader />

      {/* 2. Bố Cục 3 Cột (Portal Layout) Có Khả Năng Ẩn/Hiện Sidebar */}
      <div
        className={`home-portal-wrapper ${!showLeftSidebar ? 'no-left-sidebar' : ''} ${!showRightSidebar ? 'no-right-sidebar' : ''}`}
      >
        {/* Nút bật/tắt Drawer trên Mobile (<768px) */}
        <div className="mobile-drawer-trigger-bar">
          <button
            type="button"
            className="mobile-drawer-open-btn"
            onClick={() => setMobileDrawerOpen(true)}
            aria-label="Mở danh mục các dịp lễ và quà"
            aria-expanded={mobileDrawerOpen}
          >
            <Tag size={16} aria-hidden="true" />
            <span>Xem danh mục quà & dịp lễ</span>
          </button>
        </div>

        {/* -------------------------------------------------------------
            CỘT TRÁI: Menu Danh mục các dịp lễ & quà kéo dài suốt trang
            ------------------------------------------------------------- */}
        {showLeftSidebar && (
          <aside
            className={`home-sidebar-left ${mobileDrawerOpen ? 'is-drawer-open' : ''}`}
            aria-label="Menu danh mục dịp lễ và quà"
          >
            {/* Header của Drawer trên mobile */}
            <div className="drawer-mobile-header">
              <span className="drawer-title">Danh mục dịp lễ & quà</span>
              <button
                type="button"
                className="drawer-close-btn"
                onClick={() => setMobileDrawerOpen(false)}
                aria-label="Đóng danh mục"
              >
                <X size={20} />
              </button>
            </div>

            {/* Nhóm 1: Các dịp lễ & kỷ niệm (Real occasion_tags) */}
            <div className="sidebar-group">
              <div className="sidebar-group-title">
                <Sparkles size={16} aria-hidden="true" />
                <span>Dịp Lễ & Kỷ Niệm</span>
              </div>
              <ul className="sidebar-group-list">
                {festiveOccasions.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.id}>
                      <Link
                        to={item.path}
                        className="sidebar-item-link"
                        onClick={() => setMobileDrawerOpen(false)}
                      >
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

            {/* Nhóm 2: Danh mục cửa hàng (Real DB categories ID 1–5) */}
            <div className="sidebar-group">
              <div className="sidebar-group-title">
                <Gift size={16} aria-hidden="true" />
                <span>Danh Mục Cửa Hàng</span>
              </div>
              <ul className="sidebar-group-list">
                {storeCategoryGroups.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={item.path}
                      className="sidebar-item-link"
                      onClick={() => setMobileDrawerOpen(false)}
                    >
                      <span className="sidebar-bullet">•</span>
                      <span className="sidebar-item-name">{item.name}</span>
                      <ChevronRight size={14} className="sidebar-arrow" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Nhóm 3: Loại quà (Real DB gift_type) */}
            <div className="sidebar-group">
              <div className="sidebar-group-title">
                <Tag size={16} aria-hidden="true" />
                <span>Loại Quà Tặng</span>
              </div>
              <ul className="sidebar-group-list">
                {giftTypeGroups.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={item.path}
                      className="sidebar-item-link"
                      onClick={() => setMobileDrawerOpen(false)}
                    >
                      <span className="sidebar-bullet">•</span>
                      <span className="sidebar-item-name">{item.name}</span>
                      <ChevronRight size={14} className="sidebar-arrow" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Nhóm 4: Quà theo người nhận (Real DB recipient_tags) */}
            <div className="sidebar-group">
              <div className="sidebar-group-title">
                <Gift size={16} aria-hidden="true" />
                <span>Theo Người Nhận</span>
              </div>
              <ul className="sidebar-group-list">
                {recipientGroups.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={item.path}
                      className="sidebar-item-link"
                      onClick={() => setMobileDrawerOpen(false)}
                    >
                      <span className="sidebar-bullet">•</span>
                      <span className="sidebar-item-name">{item.name}</span>
                      <ChevronRight size={14} className="sidebar-arrow" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Nhóm 5: Mức ngân sách (Backend minPrice & maxPrice) */}
            <div className="sidebar-group">
              <div className="sidebar-group-title">
                <Tag size={16} aria-hidden="true" />
                <span>Mức Ngân Sách</span>
              </div>
              <ul className="sidebar-group-list">
                {budgetGroups.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={item.path}
                      className="sidebar-item-link"
                      onClick={() => setMobileDrawerOpen(false)}
                    >
                      <span className="sidebar-bullet">•</span>
                      <span className="sidebar-item-name">{item.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Thẻ Gợi Ý Quà Tặng */}
            <div className="sidebar-finder-promo">
              <div className="finder-promo-icon">
                <Sparkles size={24} aria-hidden="true" />
              </div>
              <strong>Chưa biết chọn gì?</strong>
              <p>Tính năng Gợi ý quà tặng giúp so khớp tiêu chí theo người nhận và ngân sách.</p>
              <Link
                to="/gift-finder"
                className="sidebar-finder-btn"
                onClick={() => setMobileDrawerOpen(false)}
              >
                Gợi ý quà tặng ngay <ArrowRight size={14} />
              </Link>
            </div>
          </aside>
        )}

        {/* Backdrop che khi mở drawer mobile */}
        {mobileDrawerOpen && (
          <div
            className="mobile-drawer-backdrop"
            onClick={() => setMobileDrawerOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* -------------------------------------------------------------
            CỘT GIỮA: Nội dung chính trang chủ (SẢN PHẨM CĂN GIỮA)
            ------------------------------------------------------------- */}
        <main className="home-center-content">
          {/* Thanh công cụ điều khiển Ẩn / Hiện Sidebar (Desktop / Tablet) */}
          <div className="portal-layout-toolbar" role="toolbar" aria-label="Điều khiển bố cục trang">
            <button
              type="button"
              className="portal-sidebar-toggle-btn"
              onClick={() => setShowLeftSidebar(!showLeftSidebar)}
              aria-label={showLeftSidebar ? 'Ẩn danh mục bên trái' : 'Hiện danh mục bên trái'}
              aria-expanded={showLeftSidebar}
            >
              {showLeftSidebar ? (
                <>
                  <PanelLeftClose size={16} aria-hidden="true" />
                  <span>Ẩn danh mục</span>
                </>
              ) : (
                <>
                  <PanelLeftOpen size={16} aria-hidden="true" />
                  <span>Hiện danh mục</span>
                </>
              )}
            </button>

            <button
              type="button"
              className="portal-sidebar-toggle-btn"
              onClick={() => setShowRightSidebar(!showRightSidebar)}
              aria-label={showRightSidebar ? 'Ẩn tiện ích bên phải' : 'Hiện tiện ích bên phải'}
              aria-expanded={showRightSidebar}
            >
              {showRightSidebar ? (
                <>
                  <PanelRightClose size={16} aria-hidden="true" />
                  <span>Ẩn tiện ích</span>
                </>
              ) : (
                <>
                  <PanelRightOpen size={16} aria-hidden="true" />
                  <span>Hiện tiện ích</span>
                </>
              )}
            </button>
          </div>

          {/* Banner Carousel Mùa Lễ Hội */}
          <section
            className="hero-festive-carousel"
            onMouseEnter={() => setSliderPaused(true)}
            onMouseLeave={() => setSliderPaused(false)}
            aria-label="Quảng cáo nổi bật"
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
                          <Sparkles size={14} aria-hidden="true" />
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
                            <Sparkles size={16} aria-hidden="true" /> {slide.secondaryButtonText}
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

          {/* Quick Categories Bar (Dẫn tới các danh mục và trang thật) */}
          <div className="quick-category-row" aria-label="Danh mục nổi bật">
            <Link to="/products?occasion=birthday" className="quick-cat-item">
              <div className="quick-cat-circle"><Cake size={22} /></div>
              <span>Sinh Nhật</span>
            </Link>
            <Link to="/products?occasion=valentines" className="quick-cat-item">
              <div className="quick-cat-circle"><Heart size={22} /></div>
              <span>Tình Yêu</span>
            </Link>
            <Link to="/products?category=3" className="quick-cat-item">
              <div className="quick-cat-circle"><Gift size={22} /></div>
              <span>Quà Handmade</span>
            </Link>
            <Link to="/products?category=4" className="quick-cat-item">
              <div className="quick-cat-circle"><Coffee size={22} /></div>
              <span>Văn Phòng</span>
            </Link>
            <Link to="/products?category=5" className="quick-cat-item">
              <div className="quick-cat-circle"><Flower2 size={22} /></div>
              <span>Hoa & Cây Cảnh</span>
            </Link>
            <Link to="/gift-finder" className="quick-cat-item highlight-quick-cat">
              <div className="quick-cat-circle"><Sparkles size={22} /></div>
              <span>Gợi Ý Quà Tặng</span>
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
                    isRanker={recommendations.source === 'ranker_lc1'}
                    onChange={setNotice}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Khối Cam Kết Dịch Vụ Chuẩn Xác */}
          <section className="benefits" aria-label="Cam kết dịch vụ">
            <div className="benefit-item">
              <span className="benefit-icon"><Truck size={23} /></span>
              <div>
                <strong>Giao hàng toàn quốc</strong>
                <small>Hỗ trợ chuyển phát tiêu chuẩn & hỏa tốc</small>
              </div>
            </div>
            <div className="benefit-item">
              <span className="benefit-icon"><ShieldCheck size={23} /></span>
              <div>
                <strong>Thanh toán COD & VNPAY</strong>
                <small>Nhận hàng kiểm tra hoặc thanh toán trực tuyến</small>
              </div>
            </div>
            <div className="benefit-item">
              <span className="benefit-icon"><Sparkles size={23} /></span>
              <div>
                <strong>Gợi ý quà tặng</strong>
                <small>So khớp tiêu chí người nhận và ngân sách</small>
              </div>
            </div>
            <div className="benefit-item">
              <span className="benefit-icon"><Package size={23} /></span>
              <div>
                <strong>Đóng gói cẩn thận</strong>
                <small>Bao gói quà tinh tế trao gửi người thương</small>
              </div>
            </div>
          </section>

          {/* Khối Quà Tặng Nổi Bật (Featured Products) - CĂN GIỮA */}
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

          {/* Khối Teaser Gợi Ý Quà Tặng */}
          <section className="ai-section" id="ai">
            <div className="ai-image">
              <img
                src="https://images.unsplash.com/photo-1512909006721-3d6018887383?auto=format&fit=crop&w=900&q=85"
                alt="Hộp quà và hoa trang trí"
                loading="lazy"
              />
              <div className="ai-image-note">
                <Sparkles size={18} aria-hidden="true" />
                <span>Một món quà, ngàn lời yêu thương</span>
              </div>
            </div>
            <div className="ai-content">
              <span className="section-kicker">GỢI Ý QUÀ TẶNG</span>
              <h2>Chưa biết tặng gì? <span>Để Giftly gợi ý!</span></h2>
              <p>
                Chỉ cần cho biết bạn muốn tặng ai, nhân dịp nào và ngân sách bao
                nhiêu. Hệ thống sẽ giúp bạn so khớp và tìm ra những lựa chọn phù hợp nhất từ danh mục.
              </p>
              <ul className="ai-check-list">
                <li><span>✓</span> Chọn theo người nhận và dịp tặng cụ thể</li>
                <li><span>✓</span> Lọc linh hoạt theo ngân sách từ tiết kiệm đến cao cấp</li>
                <li><span>✓</span> Giải thích lý do phù hợp theo thuộc tính sản phẩm</li>
              </ul>
              <button
                className="primary-button"
                onClick={() => navigate('/gift-finder')}
              >
                Mở Gợi ý quà tặng <Sparkles size={17} />
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
            CỘT PHẢI: Quảng Cáo & Thông Tin Hỗ Trợ
            ------------------------------------------------------------- */}
        {showRightSidebar && (
          <aside className="home-sidebar-right" aria-label="Thông tin hỗ trợ và chính sách">
            <div className="sidebar-right-sticky">
              {/* Thẻ Vận Chuyển Hỏa Tốc (Không bịa 2H) */}
              <div className="festive-promo-card">
                <div className="promo-card-badge">
                  <Truck size={13} aria-hidden="true" /> Giao hàng hỏa tốc
                </div>
                <h3 className="promo-card-title">Trao Tận Tay Đúng Hẹn</h3>
                <p className="promo-card-desc">
                  Hỗ trợ dịch vụ chuyển phát hỏa tốc nội thành theo yêu cầu đơn hàng. Đảm bảo món quà nguyên vẹn và đúng thời khắc ý nghĩa.
                </p>
                <Link to="/products" className="promo-card-btn">
                  Xem tất cả sản phẩm <ArrowRight size={15} />
                </Link>
              </div>

              {/* Thẻ Hỗ Trợ Khách Hàng */}
              <div className="sidebar-social-card">
                <div className="social-card-head">
                  <Phone size={18} className="social-head-icon" aria-hidden="true" />
                  <div>
                    <strong>Tư Vấn Chọn Quà</strong>
                    <small>Hỗ trợ theo từng đơn hàng</small>
                  </div>
                </div>

                <p className="social-card-text">
                  Bạn cần tìm món quà đặc biệt hoặc đặt số lượng lớn cho công ty? Bạn có thể sử dụng tính năng Gợi ý quà tặng hoặc quản lý đơn hàng trực tiếp trong tài khoản.
                </p>

                <div className="sidebar-guide-actions">
                  <Link to="/gift-finder" className="promo-card-btn promo-btn-outline">
                    Dùng Gợi ý quà tặng <ChevronRight size={15} />
                  </Link>
                </div>

                {siteInfo.hotline && (
                  <div className="social-hotline-box">
                    <div className="hotline-icon">
                      <Phone size={18} />
                    </div>
                    <div className="hotline-info">
                      <span>Hotline hỗ trợ:</span>
                      <a href={`tel:${siteInfo.hotline}`} className="hotline-link">{siteInfo.hotline}</a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Footer */}
      <footer className="footer" id="account">
        <div className="footer-main">
          <div className="footer-brand">
            <Link className="site-brand footer-brand-link" to="/">
              <span className="site-brand-icon"><Gift size={24} /></span>
              <span className="site-brand-name">giftly<span>.</span><small>Gửi quà, gửi yêu thương</small></span>
            </Link>
            <p>
              Nơi giúp bạn tìm món quà phù hợp và gửi gắm tình cảm đến những
              người quan trọng trong mọi khoảnh khắc đáng nhớ.
            </p>
          </div>
          <div className="footer-column">
            <h4>Khám phá</h4>
            <Link to="/products">Danh mục quà</Link>
            <Link to="/products?sort=popular">Sản phẩm nổi bật</Link>
            <Link to="/gift-finder">Gợi ý quà tặng</Link>
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

      {/* Cụm tiện ích nổi góc phải dưới */}
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
