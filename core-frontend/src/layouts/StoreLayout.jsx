import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Gift, Heart, ShoppingBag, UserRound } from 'lucide-react';
import { clearAuth, getAuth } from '../lib/api.js';
import { useCart } from '../context/CartContext.jsx';
import { FloatingSocialDock } from '../components/FloatingSocialDock.jsx';
import './store-layout.css';

export function StoreLayout(){
  const auth = getAuth();
  const navigate = useNavigate();
  const { cartCount } = useCart();

  return (
    <div className="store-layout">
      <header className="store-layout-header">
        <Link to="/" className="store-layout-brand">
          <Gift size={22} />
          giftly<span>.</span>
        </Link>
        <nav>
          <Link to="/products">Cửa hàng</Link>
          <Link to="/gift-finder">Gift Finder</Link>
          {auth?.token && <Link to="/orders">Đơn hàng</Link>}
          {auth?.user?.role === 'ADMIN' && <Link to="/admin">Quản trị</Link>}
        </nav>
        <div>
          <Link to={auth?.token ? '/favorites' : '/login'} aria-label="Yêu thích">
            <Heart size={19} />
          </Link>
          <Link to="/cart" className="store-layout-cart-btn" aria-label="Giỏ hàng">
            <ShoppingBag size={19} />
            {cartCount > 0 && <span className="store-layout-cart-count">{cartCount}</span>}
          </Link>
          <Link to={auth?.token ? '/account' : '/login'} aria-label="Tài khoản">
            <UserRound size={19} />
          </Link>
          {auth?.token && (
            <button onClick={() => { clearAuth(); navigate('/'); }}>
              Thoát
            </button>
          )}
        </div>
      </header>
      <Outlet />
      <footer className="store-layout-footer">
        <Link to="/">Giftly</Link>
        <span>Gợi ý quà dựa trên thuộc tính sản phẩm. Thanh toán và giao hàng trực tuyến phụ thuộc cấu hình dịch vụ của cửa hàng.</span>
      </footer>
      <FloatingSocialDock />
    </div>
  );
}

export function RequireUser(){const auth=getAuth();if(!auth?.token)return <div className="commerce-page commerce-empty"><h1>Đăng nhập để tiếp tục</h1><Link to="/login">Đăng nhập</Link></div>;return <Outlet/>}
export function RequireAdmin(){const auth=getAuth();if(!auth?.token)return <div className="commerce-page commerce-empty"><h1>Đăng nhập bằng tài khoản quản trị</h1><Link to="/login">Đăng nhập</Link></div>;if(auth.user?.role!=='ADMIN')return <div className="commerce-page commerce-empty"><h1>Không có quyền truy cập</h1><Link to="/">Về cửa hàng</Link></div>;return <Outlet/>}
