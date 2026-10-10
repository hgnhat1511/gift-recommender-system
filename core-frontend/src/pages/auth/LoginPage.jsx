
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Gift, Mail, LockKeyhole, Eye, EyeOff } from "lucide-react";
import api, { getApiError, saveAuth } from "../../lib/api.js";
import { beginGuestCartMerge, clearGuestCartMergePending, completeGuestCartMerge } from "../../lib/guestCart.js";
import "./AuthPages.css";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const location = useLocation();
  const [message, setMessage] = useState(location.state?.message || "");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      saveAuth(data.data, remember);
      const destination = typeof location.state?.from === 'string' && location.state.from.startsWith('/') && !location.state.from.startsWith('//') ? location.state.from : '/';
      const pending = beginGuestCartMerge();
      if (pending) {
        try {
          await api.post('/cart/merge', pending);
          completeGuestCartMerge(pending.key);
        } catch (mergeError) {
          if (mergeError.response?.status && mergeError.response.status < 500) clearGuestCartMergePending();
          navigate('/cart', { replace: true, state: { message: getApiError(mergeError, 'Sign-in succeeded, but the guest cart still needs attention.') } });
          return;
        }
      }
      navigate(destination, { replace: true });
    } catch (error) {
      setMessage(getApiError(error, "Không thể đăng nhập. Vui lòng thử lại."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-visual">
        <Link to="/" className="auth-brand">
          <span className="auth-brand-icon"><Gift size={25} /></span>
          <span>giftly<span className="auth-brand-dot">.</span></span>
        </Link>

        <div className="auth-visual-content">
          <span className="auth-eyebrow">GỬI TRAO YÊU THƯƠNG</span>
          <h1>Món quà nhỏ,<br />ý nghĩa lớn.</h1>
          <p>
            Để Giftly giúp bạn tìm thấy món quà phù hợp cho những người
            quan trọng nhất.
          </p>
          <div className="auth-visual-note">
            <Gift size={22} />
            <span>Mỗi món quà là một câu chuyện riêng.</span>
          </div>
        </div>

        <div className="auth-visual-footer">
          Tìm món quà hoàn hảo, theo cách của riêng bạn.
        </div>
      </section>

      <section className="auth-form-side">
        <Link to="/" className="auth-mobile-brand">
          <Gift size={23} /> giftly<span>.</span>
        </Link>

        <div className="auth-form-container">
          <div className="auth-heading">
            <h2>Chào mừng trở lại!</h2>
            <p>Đăng nhập để khám phá những món quà dành riêng cho bạn.</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-label" htmlFor="login-email">Email</label>
            <div className="auth-input-wrap">
              <Mail size={18} className="auth-input-icon" />
              <input
                id="login-email"
                type="email"
                placeholder="ban@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div className="auth-label-row">
              <label className="auth-label" htmlFor="login-password">
                Mật khẩu
              </label>
              <Link to="/forgot-password" className="auth-text-link">
                Quên mật khẩu?
              </Link>
            </div>

            <div className="auth-input-wrap">
              <LockKeyhole size={18} className="auth-input-icon" />
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                placeholder="Nhập mật khẩu"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <label className="auth-checkbox">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>Ghi nhớ đăng nhập</span>
            </label>

            {message && <p className="auth-message">{message}</p>}

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? "Đang đăng nhập…" : <>Đăng nhập <span>→</span></>}
            </button>
          </form>

          <p className="auth-switch">
            Chưa có tài khoản? <Link to="/register">Đăng ký ngay</Link>
          </p>
        </div>

        <p className="auth-legal">
          Bằng việc tiếp tục, bạn đồng ý với các điều khoản sử dụng
          và chính sách bảo mật của Giftly.
        </p>
      </section>
    </main>
  );
}
