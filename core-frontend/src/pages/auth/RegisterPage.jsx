
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Gift, Mail, LockKeyhole, UserRound, Eye, EyeOff } from "lucide-react";
import api, { getApiError } from "../../lib/api.js";
import "./AuthPages.css";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    if (password.length < 8) {
      setMessage("Mật khẩu phải có ít nhất 8 ký tự.");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Mật khẩu xác nhận không khớp.");
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/register", { fullName: name, email, password, confirmPassword });
      navigate("/login", { replace: true, state: { message: "Tạo tài khoản thành công. Hãy đăng nhập." } });
    } catch (error) {
      setMessage(getApiError(error, "Không thể tạo tài khoản. Vui lòng thử lại."));
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
            Tạo tài khoản để lưu lại những ý tưởng quà tặng và tìm món quà
            phù hợp cho người thân yêu.
          </p>
          <div className="auth-visual-note">
            <Gift size={22} />
            <span>Khởi đầu hành trình trao gửi yêu thương.</span>
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
            <h2>Tạo tài khoản Giftly</h2>
            <p>Tham gia cùng Giftly để việc chọn quà trở nên dễ dàng hơn.</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-label" htmlFor="register-name">Họ và tên</label>
            <div className="auth-input-wrap">
              <UserRound size={18} className="auth-input-icon" />
              <input
                id="register-name"
                type="text"
                placeholder="Nguyễn Văn A"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </div>

            <label className="auth-label" htmlFor="register-email">Email</label>
            <div className="auth-input-wrap">
              <Mail size={18} className="auth-input-icon" />
              <input
                id="register-email"
                type="email"
                placeholder="ban@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <label className="auth-label" htmlFor="register-password">Mật khẩu</label>
            <div className="auth-input-wrap">
              <LockKeyhole size={18} className="auth-input-icon" />
              <input
                id="register-password"
                type={showPassword ? "text" : "password"}
                placeholder="Tối thiểu 8 ký tự"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
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

            <label className="auth-label" htmlFor="register-confirm">
              Xác nhận mật khẩu
            </label>
            <div className="auth-input-wrap">
              <LockKeyhole size={18} className="auth-input-icon" />
              <input
                id="register-confirm"
                type={showConfirm ? "text" : "password"}
                placeholder="Nhập lại mật khẩu"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowConfirm(!showConfirm)}
                aria-label={showConfirm ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              >
                {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {message && <p className="auth-message">{message}</p>}

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? "Đang tạo tài khoản…" : <>Tạo tài khoản <span>→</span></>}
            </button>
          </form>

          <p className="auth-switch">
            Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
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
