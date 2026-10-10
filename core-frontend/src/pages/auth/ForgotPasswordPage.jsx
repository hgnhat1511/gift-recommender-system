
import { useState } from "react";
import { Link } from "react-router-dom";
import { Gift, Mail, ArrowLeft } from "lucide-react";
import "./AuthPages.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");

  return (
    <main className="auth-page">
      <section className="auth-visual">
        <Link to="/" className="auth-brand">
          <span className="auth-brand-icon"><Gift size={25} /></span>
          <span>giftly<span className="auth-brand-dot">.</span></span>
        </Link>

        <div className="auth-visual-content">
          <span className="auth-eyebrow">ĐỪNG LO LẮNG</span>
          <h1>Luôn có cách<br />để trở lại.</h1>
          <p>
            Khôi phục tài khoản để tiếp tục khám phá những món quà
            ý nghĩa cùng Giftly.
          </p>
        </div>

        <div className="auth-visual-footer">
          Giftly — Gửi trao yêu thương.
        </div>
      </section>

      <section className="auth-form-side">
        <Link to="/" className="auth-mobile-brand">
          <Gift size={23} /> giftly<span>.</span>
        </Link>

        <div className="auth-form-container">
          {
            <>
              <div className="auth-heading">
                <h2>Quên mật khẩu?</h2>
                <p>Nhập email tài khoản để bắt đầu khôi phục mật khẩu.</p>
              </div>

              <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
                <label className="auth-label" htmlFor="forgot-email">
                  Email tài khoản
                </label>
                <div className="auth-input-wrap">
                  <Mail size={18} className="auth-input-icon" />
                  <input
                    id="forgot-email"
                    type="email"
                    placeholder="ban@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>

                <p className="auth-message">Khôi phục mật khẩu chưa khả dụng vì môi trường này chưa cấu hình dịch vụ gửi email mã xác minh.</p>
                <button type="submit" className="auth-submit" disabled>
                  Chưa thể gửi yêu cầu <span>→</span>
                </button>
              </form>
            </>
          }

          <Link to="/login" className="auth-back-link">
            <ArrowLeft size={17} /> Quay lại đăng nhập
          </Link>
        </div>

        <p className="auth-legal">
          Bảo vệ tài khoản của bạn là ưu tiên của Giftly.
        </p>
      </section>
    </main>
  );
}
