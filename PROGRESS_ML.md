# Giftly — Tiến độ và Đặc tả Hệ thống Gợi ý Học máy (ML Recommendation)

Cập nhật lần cuối: 2026-11-07  
Nhánh phát triển: `feature/giftly-hoan-thien`

---

## 1. Tổng quan Kiến trúc Pipeline Gợi ý 2 Giai đoạn

Hệ thống gợi ý Giftly áp dụng kiến trúc chuẩn công nghiệp 2 giai đoạn:
1. **Giai đoạn 1: Sinh ứng viên (Candidate Generation / Retrieval):**
   - Đa kênh kết hợp: **ItemKNN** (lọc cộng tác dựa trên sản phẩm, cosine tương đồng trên ma trận tương tác nhị phân), **TF-IDF Content-Based Filtering** (so khớp văn bản tên, danh mục, thương hiệu), và **Popularity Baseline** (trượt theo thời gian).
   - Baseline CandidateGenerator đạt **NDCG@10 = 0.062373** (nhãn chính) trên toàn bộ 7.441 người dùng tập validation.
2. **Giai đoạn 2: Tái xếp hạng (Ranker / Re-ranking):**
   - Mô hình **LightGBM Ranker (LC-1)** tối ưu hóa hàm mục tiêu `lambdarank`.
   - Sử dụng vector **31 đặc trưng** gồm 3 nhóm:
     + *Nhóm User (11 đặc trưng):* Tần suất tương tác, tỷ lệ mua/giỏ, recency, chi tiêu trung bình,...
     + *Nhóm Item (6 đặc trưng):* Độ phổ biến, giá, phân vị giá, thương hiệu, danh mục,...
     + *Nhóm User-Item & Retrieval (14 đặc trưng):* Điểm ItemKNN, điểm TF-IDF, điểm Popularity, thứ hạng từng kênh, số kênh đề xuất, lịch sử xem/giỏ trước đó, khoảng cách thời gian tương tác cuối.
   - Kết quả Validation: **NDCG@10 = 0.085476** (đạt mức tăng +37.04% so với baseline CandidateGenerator 0.062373; số 0.082260 trước đây là nhầm lẫn trong quá trình tổng hợp tài liệu).
   - Kết quả Đánh giá Chính thức trên 2 Tập Kiểm thử Độc lập (checkpoint 7.3c - Phần B):
     + **Tập `test_1` (7.496 users):** Baseline CG = `0.055774`, Ranker LC-1 = **`0.071261`** (tăng **+27.77%**, 95% Bootstrap CI: `[+0.013188, +0.018063]`, loại trừ 0).
     + **Tập `test_2` (7.045 users):** Baseline CG = `0.053167`, Ranker LC-1 = **`0.070601`** (tăng **+32.79%**, 95% Bootstrap CI: `[+0.015119, +0.019819]`, loại trừ 0).
     + **Phương sai giữa hai tập test (`test_2 - test_1`):** Chênh lệch hiệu năng Ranker chỉ **`-0.000660`**, chứng minh mô hình hoạt động cực kỳ ổn định qua các mốc thời gian khác nhau.

---

## 2. Thông số Đóng băng Mô hình (Frozen Model Artifacts)

Mô hình Ranker LC-1 đã được đóng băng cố định, không huấn luyện lại và không chỉnh sửa:

| Tên File | Đường dẫn | SHA-256 Checksum | Trạng thái |
|---|---|---|---|
| `ranker_best_model.pkl` | `ml-service/models/ranker_best_model.pkl` | `1d11488782894eae3b4eb142943303f4c9e85d0784f800047396d4f444eea8ff` | **Đã đóng băng** (chứa mô hình LightGBM `model` và `encoder: CategoricalEncoder` được đóng gói bên trong artifact) |

---

## 3. Trạng thái Triển khai Online (FastAPI & Docker)

Mô hình LC-1 đã được đưa vào phục vụ online thực tế:
- **Service:** `ml-service` (Python 3.10 + FastAPI + LightGBM + Uvicorn).
- **Docker Container:** `gift_ml_service` (chạy trên port `8000`, network `gift_network`).
  + Docker build context: chỉ 11 kB nhờ `.dockerignore` tối ưu.
  + Healthcheck tự động: `curl -f http://localhost:8000/health`.
- **API Endpoints:**
  + `GET /health`: Trả về trạng thái service, phiên bản mô hình và mã băm SHA-256 xác thực.
  + `POST /recommend/rank`: Nhận `{ user_id, top_k, candidate_ids }`, trả về danh sách item xếp hạng kèm điểm dự báo, nguồn xếp hạng (`source: "ranker_lc1"`) và các lý do gợi ý chi tiết (ItemKNN rank, lịch sử giỏ, recency, category match, brand match).
- **Parity Verification:** Đã kiểm thử parity trên 50 người dùng mẫu từ tập validation; sai lệch điểm số tuyệt đối giữa offline inference và online API đều $< 1\times 10^{-6}$ (không bị train/serve skew).
- **Độ trễ E2E (Latency):** Đo lường trên 200 requests liên tiếp qua Node.js backend bridge:
  + Mean: **18.29 ms**
  + p50: **16.02 ms**
  + p95: **36.19 ms** ($\le 50$ ms, đáp ứng yêu cầu realtime).

---

## 4. Bảo vệ An toàn Cửa hàng và Phân định Dữ liệu (BƯỚC 1)

Nhằm đảm bảo 188 sản phẩm demo REES46 không làm sai lệch hoạt động thương mại của Giftly, hệ thống đã thiết lập 8 tầng rào chắn:
1. **Catalog công khai (`GET /api/products`):** Luôn lọc `WHERE (is_synthetic_display = FALSE OR is_synthetic_display IS NULL)`. Khách vãng lai chỉ thấy đúng 14 sản phẩm thật của Giftly.
2. **Tìm kiếm sản phẩm:** Tự động kế thừa điều kiện lọc trên, không bao giờ trả về sản phẩm synthetic.
3. **Gift Finder (`POST /api/products/gift-finder`):** Chỉ lọc ứng viên từ các sản phẩm thật có sẵn trong kho.
4. **Chi tiết sản phẩm (`GET /api/products/:id`):** Nếu sản phẩm là synthetic, chỉ cho phép tài khoản demo có `ml_user_id` xem; khách vãng lai và người dùng thông thường nhận mã lỗi `HTTP 404 Product not found`.
5. **Thêm vào giỏ hàng (`POST /api/cart/items`):** Backend kiểm tra và từ chối `HTTP 400` nếu sản phẩm có `is_synthetic_display = TRUE` ("Sản phẩm mẫu thử nghiệm không thể thêm vào giỏ hàng.").
6. **Hợp nhất giỏ hàng (`POST /api/cart/merge`):** Từ chối `HTTP 400` nếu giỏ khách vãng lai chứa sản phẩm synthetic.
7. **Đặt hàng (`POST /api/orders` & `/orders/quote`):** Trừ kho và báo giá chặn ở cấp transaction, từ chối `HTTP 400` nếu giỏ chứa sản phẩm synthetic.
8. **Mua lại (`POST /api/orders/:id/reorder`):** Hàm `calculateReorderItems` tự động bỏ qua sản phẩm synthetic với thông báo rõ ràng trong `skippedItems`.

---

## 5. Giới hạn Kỹ thuật Thực tế (Technical Constraints & Known Limitations)

1. **Dữ liệu snapshot tĩnh (Tháng 01/2020):**
   Toàn bộ ma trận ItemKNN và 31 đặc trưng của Ranker LC-1 được xây dựng từ tập dữ liệu REES46 eCommerce events tháng 01/2020. Dữ liệu này mang tính lịch sử tĩnh.
2. **Phạm vi tài khoản cá nhân hóa:**
   Hiện tại trong cơ sở dữ liệu Giftly có đúng **3 tài khoản demo** được gán `ml_user_id` liên kết với REES46:
   - `demo_rees_431235351@giftly.vn` (User ID: 58, ML ID: `431235351`)
   - `demo_rees_519418027@giftly.vn` (User ID: 59, ML ID: `519418027`)
   - `demo_rees_524084300@giftly.vn` (User ID: 60, ML ID: `524084300`)
   Khách vãng lai và mọi tài khoản thông thường khác sẽ nhận gợi ý từ fallback an toàn (`python_content_baseline` hoặc `node_fallback`).
3. **Bản quyền hình ảnh sản phẩm demo:**
   188 sản phẩm REES46 hiển thị là dữ liệu tổng hợp (`is_synthetic_display = TRUE`). Hình ảnh sản phẩm được lấy từ Unsplash; bắt buộc phải rà soát giấy phép bản quyền trước khi đưa vào khai thác thương mại chính thức.
4. **Chưa có cơ chế Online Learning:**
   Các sự kiện tương tác mới phát sinh trên Giftly (`VIEW`, `CART_ADD`, `PURCHASE`, `RECOMMENDATION_CLICK`) hiện chỉ được lưu vào bảng `product_events` trong MySQL để phục vụ phân tích offline; hệ thống chưa tự động cập nhật trọng số online hay huấn luyện lại tự động theo chu kỳ (retrain batch).
5. **Trạng thái Môi trường Container (Docker Compose):**
   Trong file `docker-compose.yml`, hiện tại mới chỉ có các dịch vụ cơ sở hạ tầng và ML chạy trong container:
   - Container đang chạy: `gift_mysql` (MySQL 8), `gift_redis` (Redis 7), `gift_ml_service` (FastAPI ML Service).
   - Service chạy cục bộ máy host: `core-backend` (Node.js Express) và `core-frontend` (Vite React). Chưa container hóa toàn bộ ứng dụng thành 1 lệnh duy nhất.
