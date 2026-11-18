# Hướng Dẫn Nhanh Cho Cộng Sự & AI (Quick Start Guide)

Chào bạn! Dưới đây là hướng dẫn để clone và chạy dự án **Giftly (Gift Recommender System)** hoàn chỉnh trên máy của bạn chỉ với **Docker**. Toàn bộ mã nguồn, dịch vụ (Frontend, Backend, ML, Redis, MySQL) và dữ liệu cơ sở đã được đóng gói sẵn.

---

## 🚀 1. Khởi động dự án (Chỉ 2 bước)

### Bước 1: Sao chép file cấu hình môi trường
Mở terminal trong thư mục dự án và chạy:

- **Trên Windows (PowerShell / CMD):**
  ```powershell
  copy .env.example .env
  ```
- **Trên macOS / Linux:**
  ```bash
  cp .env.example .env
  ```

### Bước 2: Khởi động toàn bộ hệ thống bằng Docker
```bash
docker compose up -d
```
> Docker sẽ tự động:
> 1. Tải và build các image cho **Frontend**, **Backend**, **ML Service**.
> 2. Khởi tạo **MySQL 8.0** và **tự động nạp sẵn toàn bộ cơ sở dữ liệu** từ file `init.sql`.
> 3. Khởi tạo bộ nhớ đệm **Redis**.

---

## 🌐 2. Danh sách các đường dẫn truy cập

| Dịch vụ | Đường dẫn | Mô tả |
| :--- | :--- | :--- |
| **Frontend Web** | [http://localhost:3000](http://localhost:3000) | Giao diện người dùng (Cửa hàng, Gift Finder, Giỏ hàng, Đặt hàng, Shipper, Quản trị) |
| **Backend API** | [http://localhost:5000](http://localhost:5000) | Express REST API |
| **ML Service Docs** | [http://localhost:8000/docs](http://localhost:8000/docs) | Swagger UI cho dịch vụ gợi ý quà tặng học máy (FastAPI) |
| **MySQL Database** | `localhost:3306` | User: `root` \| Password: `rootpassword` \| Database: `gift_ecommerce` |
| **Redis Cache** | `localhost:6379` | Cache phiên và rate-limit |

---

## 🔑 3. Tài khoản kiểm thử có sẵn

Database đã nạp sẵn danh mục sản phẩm, dữ liệu giỏ hàng, đơn hàng mẫu:

- **Khách hàng (User):** `khach1@gmail.com` hoặc `example@gmail.com`
- **Quản trị viên (Admin):** `admin@giftly.vn`
- **Giao hàng (Shipper):** `shipper@giftly.vn`

---

## 🛠️ 4. Chạy trực tiếp trên máy không qua Docker (Tùy chọn cho Dev / Codex)

Nếu bạn muốn chạy code trực tiếp trên máy để vừa sửa vừa xem hot-reload:

1. **Khởi động Database & Redis:**
   ```bash
   docker compose up -d mysql-db redis-cache
   ```
2. **Backend:**
   ```bash
   cd core-backend
   npm install
   npm run dev      # Server chạy tại port 5000
   ```
3. **Frontend:**
   ```bash
   cd core-frontend
   npm install
   npm run dev      # Vite chạy tại port 5173
   ```
4. **Kiểm tra tự động (Unit & Integration Tests):**
   - Backend: `cd core-backend && npm test`
   - Frontend: `cd core-frontend && npm test`

---

## ⚠️ 5. Xử lý sự cố thường gặp (Troubleshooting)

- **Lỗi trùng cổng 3306 (MySQL):** Nếu máy bạn đã cài MySQL service hoặc XAMPP, hãy tạm tắt MySQL service (`Stop-Service MySQL*` trong PowerShell Admin) hoặc đổi cổng `MYSQL_HOST_PORT=3307` trong file `.env`.
- **Muốn làm sạch dữ liệu và nạp lại từ đầu:**
  ```bash
  docker compose down -v
  docker compose up -d
  ```
  *(Cờ `-v` sẽ xóa volume cũ để MySQL nạp lại toàn bộ file `init.sql`).*
