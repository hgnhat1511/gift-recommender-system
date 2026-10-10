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
  Menu,
  X,
  Star,
  Cake,
  Flower2,
  Coffee,
  Package,
} from 'lucide-react';
import './App.css';
import api, { getAuth, getApiError } from './lib/api.js';
import { ProductCard } from './pages/store/CatalogPages.jsx';
import { addGuestCartItem, getGuestCartCount, subscribeToGuestCart } from './lib/guestCart.js';

const categoryIcons = [Cake, Heart, Flower2, Gift, Coffee, Sparkles];
const categoryColors = ['pink', 'rose', 'green', 'purple', 'orange', 'blue'];

const formatPrice = (price) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
  }).format(price);

function App() {
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState([]);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [newProducts, setNewProducts] = useState([]);
  const [popularProducts, setPopularProducts] = useState([]);
  const [recommendations, setRecommendations] = useState({ method: '', items: [] });
  const [banners, setBanners] = useState([]);
  const [bannerIndex, setBannerIndex] = useState(0);
  const [productCount, setProductCount] = useState(0);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const [cartCount, setCartCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/products/banners').then(({data})=>{setBanners(data.data||[]);setBannerIndex(0)}).catch(()=>{});
    api.get('/products/recommendations', { params: { limit: 4 } })
      .then(({ data }) => setRecommendations(data.data || { method: '', items: [] }))
      .catch(() => {});
    Promise.all([
      api.get('/products/categories'),
      api.get('/products', { params: { limit: 4, featured: true, sort: 'popular' } }),
      api.get('/products', { params: { limit: 4, sort: 'newest' } }),
      api.get('/products', { params: { limit: 4, sort: 'popular' } }),
    ])
      .then(([categoryResponse, productResponse, newestResponse, popularResponse]) => {
        setCategories(categoryResponse.data.data);
        setProducts(productResponse.data.data.items);
        setNewProducts(newestResponse.data.data.items);
        setPopularProducts(popularResponse.data.data.items);
        setProductCount(newestResponse.data.data.pagination.total);
      })
      .catch((error) => setProductsError(getApiError(error, 'Không tải được catalog.')))
      .finally(() => setProductsLoading(false));
    if (getAuth()?.token) {
      api.get('/account/favorites').then(({ data }) => setFavorites(data.data.map((product) => product.id))).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const refreshCount = () => {
      if (!getAuth()?.token) { setCartCount(getGuestCartCount()); return; }
      api.get('/cart').then(({ data }) => setCartCount(data.data.itemCount)).catch(() => {});
    };
    refreshCount();
    const unsubscribe = subscribeToGuestCart(refreshCount);
    window.addEventListener('giftly:auth-change', refreshCount);
    return () => { unsubscribe(); window.removeEventListener('giftly:auth-change', refreshCount); };
  }, []);

  const toggleFavorite = async (id) => {
    if (!getAuth()?.token) return navigate('/login');
    try {
      const { data } = await api.put(`/account/favorites/${id}`);
      setFavorites((current) => data.data.favorite ? [...current, id] : current.filter((item) => item !== id));
      setNotice(data.data.favorite ? 'Đã thêm vào yêu thích.' : 'Đã bỏ khỏi yêu thích.');
    } catch (error) { setNotice(getApiError(error, 'Không thể cập nhật danh sách yêu thích.')); }
  };

  const handleAddToCart = async (product) => {
    if (!getAuth()?.token) {
      const result = addGuestCartItem(product.id, product.stock);
      setNotice(result.ok ? '\u0110\u00e3 th\u00eam s\u1ea3n ph\u1ea9m v\u00e0o gi\u1ecf h\u00e0ng.' : 'Kh\u00f4ng th\u1ec3 th\u00eam s\u1ea3n ph\u1ea9m v\u00e0o gi\u1ecf h\u00e0ng.');
      return;
    }
    try {
      await api.post('/cart/items', { productId: product.id, quantity: 1 });
      const { data } = await api.get('/cart');
      setCartCount(data.data.itemCount);
      setNotice(`Đã thêm “${product.name}” vào giỏ hàng.`);
    } catch (error) { setNotice(getApiError(error, 'Không thể thêm sản phẩm vào giỏ hàng.')); }
  };

  const submitSearch = (event) => { event.preventDefault(); navigate(`/products?q=${encodeURIComponent(search.trim())}`); };

  return (
    <div className="app">
      <div className="announcement">
        <Sparkles size={15} />
        <span>Thanh toán COD · Phí giao hàng được tính ở bước xác nhận đơn</span>
      </div>

      <header className="header">
        <div className="header-inner">
          <Link className="brand" to="/" aria-label="Giftly trang chủ">
            <span className="brand-icon">
              <Gift size={25} strokeWidth={2.2} />
            </span>
            <span className="brand-name">
              giftly<span>.</span>
              <small>Gửi quà, gửi yêu thương</small>
            </span>
          </Link>

          <nav className={`nav ${menuOpen ? 'nav-open' : ''}`}>
            <Link to="/" onClick={() => setMenuOpen(false)}>Trang chủ</Link>
            <Link to="/products" onClick={() => setMenuOpen(false)}>Danh mục quà</Link>
            <Link to="/products" onClick={() => setMenuOpen(false)}>Sản phẩm</Link>
            <Link to="/gift-finder" onClick={() => setMenuOpen(false)}>Gift Finder</Link>
          </nav>

          <div className="header-actions">
            <button
              className="icon-button mobile-menu"
              aria-label="Mở menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            <Link className="icon-button account-button" to={getAuth()?.token ? '/account' : '/login'} aria-label="Tài khoản">
              <UserRound size={21} />
            </Link>
            <button
              className="icon-button cart-button"
              aria-label="Giỏ hàng"
              onClick={() => navigate('/cart')}
            >
              <ShoppingBag size={21} />
              <span className="cart-count">{cartCount}</span>
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-content">
            <div className="eyebrow">
              <Sparkles size={16} />
              <span>Món quà nhỏ, niềm vui lớn</span>
            </div>

            <h1>
              Chọn quà thật dễ,
              <br />
              <span>trao gửi yêu thương.</span>
            </h1>

            <p className="hero-description">
              Không còn đau đầu khi chọn quà. Tìm món quà phù hợp với người
              nhận, dịp đặc biệt và ngân sách của bạn.
            </p>

            <div className="hero-buttons">
          <button className="primary-button" onClick={() => navigate('/products')}>
                Khám phá quà tặng <ArrowRight size={18} />
              </button>
              <Link className="secondary-button" to="/gift-finder"><Sparkles size={17} /> Tìm quà phù hợp</Link>
            </div>

            <div className="hero-proof"><Package size={20}/><div><strong>{productCount || '—'} sản phẩm</strong><p>Từ catalog đang hoạt động</p></div></div>
          </div>

          <div className="hero-visual">
            <div className="hero-image-wrap">
              <img
                src="https://images.unsplash.com/photo-1513883049090-d0b7439799bf?auto=format&fit=crop&w=1100&q=90"
                alt="Hộp quà được gói đẹp mắt"
              />
            </div>
            <div className="floating-card floating-card-top">
              <span className="floating-icon"><Heart size={18} fill="currentColor" /></span>
              <div>
                <strong>Món quà ý nghĩa</strong>
                <small>Dành riêng cho người ấy</small>
              </div>
            </div>
            <div className="floating-card floating-card-bottom">
              <span className="sparkle-badge"><Sparkles size={19} /></span>
              <div>
                <strong>Gift Finder</strong>
                <small>Đúng người, đúng dịp</small>
              </div>
            </div>
            <div className="hero-decoration decoration-one" />
            <div className="hero-decoration decoration-two" />
          </div>
        </section>

        {banners.length>0&&<section className="home-promo" aria-label="Nội dung nổi bật">
          <div className="home-promo-copy"><span>GIFTLY · DÀNH TẶNG ĐIỀU Ý NGHĨA</span><h2>{banners[bannerIndex]?.title}</h2>{banners[bannerIndex]?.subtitle&&<p>{banners[bannerIndex].subtitle}</p>}
            {(()=>{const banner=banners[bannerIndex];if(!banner?.buttonText)return null;const href=banner.targetUrl||'/products';return /^https?:\/\//i.test(href)?<a className="primary-button" href={href}>{banner.buttonText}<ArrowRight size={17}/></a>:<Link className="primary-button" to={href}>{banner.buttonText}<ArrowRight size={17}/></Link>})()}
          </div>
          <div className="home-promo-art"><img src={banners[bannerIndex]?.imageUrl} alt="" loading="lazy"/>{banners.length>1&&<div className="home-promo-controls" aria-label="Chọn nội dung nổi bật">{banners.map((banner,index)=><button type="button" key={banner.id} className={index===bannerIndex?'is-active':''} aria-label={`Xem banner ${index+1}`} aria-pressed={index===bannerIndex} onClick={()=>setBannerIndex(index)}/>)}</div>}</div>
        </section>}

        {recommendations.items?.length > 0 && <section className="section products-section recommendation-section" id="recommendations">
          <div className="section-heading">
            <div>
              <span className="section-kicker">GIFTLY PICKS</span>
              <h2>{recommendations.method === 'personalized_activity' ? <>G&#7907;i &#253; ri&#234;ng cho <span>b&#7841;n</span></> : <>M&#243;n qu&#224; &#273;ang &#273;&#432;&#7907;c y&#234;u th&#237;ch</>}</h2>
              <p>{recommendations.method === 'personalized_activity'
                ? '\u0050h\u00e2n t\u00edch l\u01b0\u1ee3t xem, s\u1edf th\u00edch v\u00e0 t\u01b0\u01a1ng t\u00e1c g\u1ea7n \u0111\u00e2y c\u1ee7a t\u00e0i kho\u1ea3n.'
                : 'Nh\u1eefng s\u1ea3n ph\u1ea9m c\u00f2n h\u00e0ng trong catalog Giftly.'}</p>
            </div>
            <Link to="/products" className="text-link">Xem th&#234;m <ArrowRight size={17} /></Link>
          </div>
          <div className="commerce-product-grid home-catalog-grid">
            {recommendations.items.map((product) => <ProductCard
              key={product.id}
              product={product}
              recommendationSource="home"
              onChange={setNotice}
            />)}
          </div>
        </section>}

        <section className="benefits">
          <div className="benefit-item">
            <span className="benefit-icon"><Truck size={23} /></span>
            <div><strong>Giao hàng tận nơi</strong><small>Trao quà đúng hẹn</small></div>
          </div>
          <div className="benefit-item">
            <span className="benefit-icon"><ShieldCheck size={23} /></span>
            <div><strong>Thanh toán an tâm</strong><small>Thông tin được bảo vệ</small></div>
          </div>
          <div className="benefit-item">
            <span className="benefit-icon"><Sparkles size={23} /></span>
            <div><strong>Gift Finder</strong><small>So khớp theo tiêu chí bạn chọn</small></div>
          </div>
          <div className="benefit-item">
            <span className="benefit-icon"><Package size={23} /></span>
            <div><strong>Theo dõi đơn hàng</strong><small>Cập nhật trạng thái trong tài khoản</small></div>
          </div>
        </section>

        <section className="section categories-section" id="categories">
          <div className="section-heading">
            <div>
              <span className="section-kicker">KHÁM PHÁ</span>
              <h2>Chọn quà theo <span>cảm hứng</span></h2>
              <p>Mỗi dịp đặc biệt đều xứng đáng có một món quà riêng.</p>
            </div>
            <Link to="/products" className="text-link">
              Xem tất cả <ArrowRight size={17} />
            </Link>
          </div>

          <div className="category-grid">
            {categories.map((category, index) => {
              const Icon = categoryIcons[index % categoryIcons.length];
              return (
                <Link
                  className="category-card"
                  key={category.id}
                  to={`/products?category=${category.id}`}
                >
                  <span className={`category-icon ${categoryColors[index % categoryColors.length]}`}>
                    <Icon size={27} strokeWidth={1.8} />
                  </span>
                  <strong>{category.name}</strong>
                  <small>{category.productCount} sản phẩm</small>
                  <ChevronRight className="category-arrow" size={18} />
                </Link>
              );
            })}
            {categories.length === 0 && <p>Danh mục sẽ hiển thị sau khi catalog được nạp.</p>}
          </div>
        </section>

        <section className="section products-section" id="products">
          <div className="section-heading">
            <div>
              <span className="section-kicker">ĐƯỢC YÊU THÍCH</span>
              <h2>Quà tặng <span>nổi bật</span></h2>
              <p>Những lựa chọn xinh xắn để bạn bắt đầu.</p>
            </div>
            <Link to="/products" className="text-link">
              Khám phá thêm <ArrowRight size={17} />
            </Link>
          </div>

          <form className="product-search" onSubmit={submitSearch}>
            <Search size={19} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tìm món quà bạn đang nghĩ đến..."
              aria-label="Tìm sản phẩm"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Xóa tìm kiếm">
                <X size={18} />
              </button>
            )}
            <button type="submit" aria-label="Tìm kiếm">Tìm</button>
          </form>

          {productsLoading ? <div className="empty-search">Đang tải sản phẩm từ cửa hàng…</div> : productsError ? <div className="empty-search">{productsError}</div> : <div className="product-grid">
            {products.map((product) => (
              <article className="product-card" key={product.id}>
                <div className="product-image-wrap">
                  <Link to={`/products/${product.id}`}><img src={product.imageUrl} alt={product.name} loading="lazy" /></Link>
                  <span className="product-tag">{product.stock > 0 ? (product.isFeatured ? 'Nổi bật' : 'Có sẵn') : 'Hết hàng'}</span>
                  <button
                    className={`favorite-button ${favorites.includes(product.id) ? 'is-favorite' : ''}`}
                    onClick={() => toggleFavorite(product.id)}
                    aria-label="Yêu thích sản phẩm"
                  >
                    <Heart size={19} fill={favorites.includes(product.id) ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    className="quick-add"
                    onClick={() => handleAddToCart(product)}
                    disabled={product.stock < 1}
                  >
                    <ShoppingBag size={16} /> {product.stock > 0 ? 'Thêm vào giỏ' : 'Hết hàng'}
                  </button>
                </div>
                <div className="product-info">
                  <span className="product-category">{product.category}</span>
                  <h3><Link to={`/products/${product.id}`}>{product.name}</Link></h3>
                  <div className="product-rating">
                    <Star size={15} fill="currentColor" />
                    <span>{product.reviewCount ? Number(product.averageRating).toFixed(1) : 'Mới'}</span>
                    <span className="rating-caption">{product.reviewCount} đánh giá</span>
                  </div>
                  <div className="product-price-row">
                    <strong>{formatPrice(product.price)}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>}

          {!productsLoading && !productsError && products.length === 0 && (
            <div className="empty-search">
              <Package size={35} />
              <h3>Chưa tìm thấy món quà phù hợp</h3>
              <p>Thử tìm bằng một tên sản phẩm khác nhé.</p>
            </div>
          )}

          <div className="center-action">
            <Link className="outline-button" to="/products">
              Xem tất cả sản phẩm <ArrowRight size={17} />
            </Link>
          </div>
        </section>

        {newProducts.length > 0 && <section className="section products-section" id="new-products">
          <div className="section-heading"><div><span className="section-kicker">CATALOG GIFTLY</span><h2>Sản phẩm <span>mới nhất</span></h2><p>Các sản phẩm mới được cập nhật trong catalog.</p></div><Link to="/products?sort=newest" className="text-link">Xem tất cả <ArrowRight size={17}/></Link></div>
          <div className="commerce-product-grid home-catalog-grid">{newProducts.map(product=><ProductCard key={product.id} product={product} onChange={setNotice}/>)}</div>
        </section>}

        {popularProducts.length > 0 && <section className="section products-section" id="popular-products">
          <div className="section-heading"><div><span className="section-kicker">NỔI BẬT</span><h2>Được ưu tiên trong <span>catalog</span></h2><p>Sản phẩm nổi bật và mức tương tác gần đây được tính từ dữ liệu thật.</p></div><Link to="/products?sort=popular" className="text-link">Khám phá thêm <ArrowRight size={17}/></Link></div>
          <div className="commerce-product-grid home-catalog-grid">{popularProducts.map(product=><ProductCard key={product.id} product={product} onChange={setNotice}/>)}</div>
        </section>}

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
              nhiêu. Hệ thống sẽ giúp bạn tìm ra những lựa chọn phù hợp hơn.
            </p>
            <ul className="ai-check-list">
              <li><span>✓</span> Chọn theo người nhận và sở thích</li>
              <li><span>✓</span> Phù hợp dịp tặng và ngân sách</li>
              <li><span>✓</span> Giải thích tiêu chí khớp với catalog</li>
            </ul>
            <button
              className="primary-button"
              onClick={() => navigate('/gift-finder')}
            >
              Mở Gift Finder <Sparkles size={17} />
            </button>
          </div>
        </section>

        <section className="closing-banner">
          <div className="closing-icon"><Gift size={29} /></div>
          <div>
            <h2>Món quà ý nghĩa bắt đầu từ sự quan tâm.</h2>
            <p>Hãy để mỗi dịp đặc biệt trở thành một kỷ niệm đẹp.</p>
          </div>
          <button className="closing-button" onClick={() => navigate('/products')}>
            Chọn quà ngay <ArrowRight size={17} />
          </button>
        </section>
      </main>

      <footer className="footer" id="account">
        <div className="footer-main">
          <div className="footer-brand">
            <a className="brand footer-brand-link" href="#home">
              <span className="brand-icon"><Gift size={24} /></span>
              <span className="brand-name">giftly<span>.</span><small>Gửi quà, gửi yêu thương</small></span>
            </a>
            <p>
              Nơi giúp bạn tìm món quà phù hợp và gửi gắm tình cảm đến những
              người quan trọng.
            </p>
          </div>
          <div className="footer-column">
            <h4>Khám phá</h4>
            <a href="#categories">Danh mục quà</a>
            <a href="#products">Sản phẩm nổi bật</a>
            <a href="#ai">Gift Finder</a>
          </div>
          <div className="footer-column">
            <h4>Hỗ trợ</h4>
            <Link to="/orders">Theo dõi đơn hàng</Link>
            <Link to="/account#addresses">Quản lý địa chỉ</Link>
            <Link to="/products">Xem catalog</Link>
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
