import { Link, Outlet } from 'react-router-dom';
import { getAuth } from '../lib/api.js';
import { SiteHeader } from '../components/SiteHeader.jsx';
import { FloatingSocialDock } from '../components/FloatingSocialDock.jsx';
import './store-layout.css';

export function StoreLayout(){
  return (
    <div className="store-layout">
      <SiteHeader />
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
