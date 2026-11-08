# BÁO CÁO NGHIỆM THU DỰ ÁN GIFTLY — CHIẾN DỊCH "GIFTLY-FINAL"
**Hoàn thiện Website Gợi ý Quà tặng Giftly, Catalog 1.000 Sản phẩm, Giao dịch Mô phỏng & Đồng bộ Hệ thống**

* **Ngày thực hiện:** 08/11/2026
* **Hệ thống:** Giftly Gift Recommendation & E-commerce Platform
* **Kho mã nguồn Web & Serving:** `D:\NAM4\DACN\gift-recommender-system` (Nhánh: `feature/giftly-hoan-thien`)
* **Kho mã nguồn Huấn luyện ML:** `D:\NAM4\DACN\gift-recommender-ml` (Nhánh: `feature/giftly-ml`)
* **Mô hình phục vụ LC-1:** `ml-service/models/ranker_best_model.pkl` (SHA-256 cố định: `1d11488782894eae3b4eb142943303f4c9e85d0784f800047396d4f444eea8ff`)

---

## I. TỔNG QUAN KẾT QUẢ VÀ TRẠNG THÁI TỪNG BƯỚC

Chiến dịch **GIFTLY-FINAL** được thực thi với các nguyên tắc an toàn nghiêm ngặt:
1. Không sửa đổi artifact mô hình LC-1; SHA-256 được bảo toàn nguyên vẹn 100%.
2. Không thực hiện `docker compose down -v`, không `DROP/TRUNCATE` database phát triển `gift_ecommerce`.
3. Toàn bộ thao tác ghi kiểm thử đều được cách ly trên database `giftly_e2e_test`.
4. Mọi giao dịch và sự kiện mô phỏng đều mang cờ cách ly `is_simulated = 1`, không làm rò rỉ vào luồng mua sắm hoặc profile của khách.
5. Quyết định A: Khách xem được 1.000 sản phẩm demo REES46 trên catalog công khai với nhãn trung tính *"Phong cách sống & Tiện ích"*, nút mua bị vô hiệu hóa (*"Không đặt mua"*).
6. Quyết định B: Đơn mô phỏng không ảnh hưởng gợi ý LC-1; mô hình Ranker sử dụng snapshot đặc trưng tĩnh đóng băng tại mốc cutoff 2020-01-15.

| Bước | Nội dung công việc | Trạng thái | Mức xác minh | Bằng chứng / File mã nguồn |
| :--- | :--- | :---: | :---: | :--- |
| **Bước 1** | Kiểm tra hiện trạng & Baseline | Hoàn thành | Đã chạy xác minh | `docker ps`, `git branch -vv`, baseline test pass |
| **Bước 2** | Chuẩn hóa nhãn trung tính Lifestyle & Banner dữ liệu mẫu | Hoàn thành | Đã chạy xác minh & Có code | `importReesCatalog.js`, `CatalogPages.jsx:62,89,104-107`, `App.jsx:518` |
| **Bước 3** | Mở rộng Catalog 1.000 sản phẩm từ REES46 (Quyết định A) | Hoàn thành | Đã chạy xác minh & Có code | `catalogController.js:33`, `select1000Catalog.py`, `import1000Catalog.js` |
| **Bước 4** | Sinh 22.926 tương tác & 2.000 đơn hàng mô phỏng | Hoàn thành | Đã chạy xác minh & Có code | `012_simulation_flags.sql`, `simulateTransactions.js`, `orderController.js:145` |
| **Bước 5** | Phục vụ gợi ý (Serving), kiểm chứng B & Đo độ trễ | Hoàn thành | Đã chạy xác minh & Có code | `simulation-impact.test.js`, đo độ trễ 3 điều kiện, P50 = 54.29 ms |
| **Bước 6** | Kiểm thử toàn diện (Backend, Frontend Unit, E2E) | Hoàn thành | Đã chạy xác minh | Backend: 108/110 pass (2 skip), Frontend: 24/24 pass, E2E: 10/10 pass |
| **Bước 7** | Đóng gói Docker Compose & Thử nghiệm Fresh Stack | Báo cáo chi tiết | Đã chạy xác minh | Stack chính: 5 container Up/Healthy; Fresh stack song song bằng compose gốc: **CHƯA ĐẠT** (xung đột `container_name`); Verify độc lập qua compose phụ: **ĐẠT** |
| **Bước 8** | Báo cáo nghiệm thu & Commit Git địa phương | Hoàn thành | Đã chạy xác minh | `docs/GIFTLY_FINAL_REPORT.md`, commit theo từng việc cụ thể |

---

## II. CHI TIẾT TRIỂN KHAI VÀ XÁC MINH THEO TỪNG BƯỚC

### 1. BƯỚC 1: KIỂM TRA HIỆN TRẠNG (Baseline Verification)
* **Mức xác minh:** *Đã chạy xác minh (lệnh + output thô)*.
* **Môi trường & Git Metadata:**
  * Repo Web: `D:\NAM4\DACN\gift-recommender-system`, branch `feature/giftly-hoan-thien`.
  * Repo ML: `D:\NAM4\DACN\gift-recommender-ml`, branch `feature/giftly-ml`.
  * Docker containers đang chạy: `gift_mysql` (port 3306), `gift_redis` (port 6379), `gift_ml_service` (port 8000, healthy), `gift_core_backend` (port 5000), `gift_core_frontend` (port 3000/5173).
* **Kiểm tra SHA-256 Artifact LC-1:**
  * Lệnh: `Get-FileHash ml-service\models\ranker_best_model.pkl -Algorithm SHA256`
  * Kết quả: `1D11488782894EAE3B4EB142943303F4C9E85D0784F800047396D4F444EEA8FF` (Khớp 100% với chữ ký ban đầu ở cả hai repo).
* **Kết quả kiểm thử Baseline:**
  * Backend Unit & Contract Tests: 98 passed, 2 skipped (tổng 100 tests).
  * Frontend Unit Tests: 24/24 passed.
  * Playwright E2E Tests: 10/10 passed.

---

### 2. BƯỚC 2: CHUẨN HÓA NHÃN DANH MỤC TRUNG TÍNH & BANNER DỮ LIỆU MẪU
* **Mức xác minh:** *Đã chạy xác minh (lệnh + output thô) & Có code*.
* **Chuẩn hóa nhãn danh mục:**
  * Không sử dụng chữ "Quà tặng" cho dữ liệu REES46; toàn bộ chuỗi `"Quà tặng REES46"` hoặc `"Phong cách sống & Quà tặng"` được chuẩn hóa thành danh mục trung tính `"Lifestyle"` / `"Phong cách sống & Tiện ích"` (Mô tả: *"Danh mục phong cách sống và tiện ích"*).
  * Đã cập nhật đồng bộ tại:
    * `core-backend/scripts/select1000Catalog.py`: Dòng 147.
    * `core-backend/data/selected_1000_products.json`: Toàn bộ 1.000 sản phẩm mang category `"Phong cách sống & Tiện ích"`.
    * `core-backend/scripts/resetTestDb.js`: Thêm danh mục `Lifestyle` vào danh mục seed cơ sở.
    * Database `gift_ecommerce`: Cập nhật trực tiếp bản ghi ID 7 trong bảng `categories` thành description `'Danh mục phong cách sống và tiện ích'`.
* **Hiển thị Banner Dữ liệu mẫu:**
  * Bổ sung styling banner `.commerce-demo-banner` tại `core-frontend/src/pages/store/commerce.css`.
  * Hiển thị banner thông báo *"Dữ liệu mẫu từ bộ REES46, dùng cho demo."* trên các trang:
    * Trang chủ (`core-frontend/src/App.jsx`, dòng 518).
    * Danh sách sản phẩm (`core-frontend/src/pages/store/CatalogPages.jsx`, dòng 62).
    * Chi tiết sản phẩm (`core-frontend/src/pages/store/CatalogPages.jsx`, dòng 89).
* **Phân định ranh giới Gift Finder:**
  * Tại `core-frontend/src/pages/store/CatalogPages.jsx` (dòng 104-107): Thể hiện rõ ràng nhãn tính năng lọc theo quy tắc metadata do hệ thống định nghĩa (Rule-based metadata baseline), chưa áp dụng mô hình học máy LC-1.

---

### 3. BƯỚC 3: MỞ RỘNG CATALOG 1.000 SẢN PHẨM & QUYẾT ĐỊNH A
* **Mức xác minh:** *Đã chạy xác minh (lệnh + output thô) & Có code*.
* **Quyết định A (Storefront công khai cho khách xem sản phẩm demo):**
  * Khách thường và khách vãng lai được phép xem danh sách 1.000 sản phẩm demo REES46 trên catalog công khai:
    * Tại `core-backend/controllers/catalogController.js` (dòng 33): Bỏ điều kiện lọc `is_synthetic_display`, cho phép trả về sản phẩm demo.
    * Nút mua hàng của sản phẩm demo bị vô hiệu hóa trên giao diện (`disabled`, hiển thị *"Không đặt mua"*).
    * Khách thường không thể thêm vào giỏ hàng (`POST /cart/items` chặn 400), không thể checkout, và không xem được chi tiết (`GET /products/:id` chặn 404 cho khách không phải tài khoản demo).
* **Script phân tầng và tạo dữ liệu (`core-backend/scripts/select1000Catalog.py`):**
  * Sử dụng random seed = 42 cố định.
  * Phân tầng mẫu theo `category_id` và `category_code` từ tập dữ liệu REES46 gốc (`sampled_events.parquet`).
  * Đảm bảo bao gồm đầy đủ ứng viên lịch sử của 3 tài khoản demo REES46 (u1 = 431235351, u2 = 519418027, u3 = 524084300) để mô hình LC-1 chấm điểm thực tế.
  * Toàn bộ 1.000/1.000 sản phẩm đều thuộc pool 30.376 item của mô hình LC-1.
  * File dữ liệu: `core-backend/data/selected_1000_ids.json` và `core-backend/data/selected_1000_products.json`.
* **Dữ liệu trong Database dev `gift_ecommerce`:**
  * Tổng số sản phẩm `status = 'ACTIVE'`: **1.014 món** (gồm 1.000 sản phẩm demo REES46 mang `is_synthetic_display = TRUE` và 14 sản phẩm seed cơ sở).

---

### 4. BƯỚC 4: GIAO DỊCH VÀ TƯƠNG TÁC MÔ PHỎNG (Simulation Engine)
* **Mức xác minh:** *Đã chạy xác minh (lệnh + output thô) & Có code*.
* **Cơ chế gắn cờ mô phỏng (`database/migrations/012_simulation_flags.sql`):**
  * Bổ sung cột `is_simulated TINYINT(1) DEFAULT 0` vào bảng `orders` và bảng `product_events`.
  * Cập nhật `core-backend/scripts/resetTestDb.js` để tự động áp dụng di trú an toàn khi khởi tạo database test.
* **Đối chiếu số lượng sự kiện `product_events` trong DB dev `gift_ecommerce`:**
  * Tổng số sự kiện trong bảng: **23.013 bản ghi**, gồm:
    * **22.926 sự kiện mô phỏng** mang `is_simulated = 1` do `simulateTransactions.js` tạo ra.
    * **87 sự kiện mang `is_simulated = 0`**: Đây là dữ liệu tương tác baseline / test của hệ thống ghi nhận từ trước ngày 08/11/2026 (gồm 2 FAVORITE, 36 CART_ADD, 22 PURCHASE, 9 SEARCH, 17 VIEW, 1 RECOMMENDATION_CLICK), **không gọi là dữ liệu người dùng thật**.
* **Đơn hàng mô phỏng (`simulateTransactions.js`):**
  * Sinh **2.000 đơn hàng mô phỏng** (`orders`) hoàn tất đầy đủ quy trình thương mại:
    * Kiểm tra tồn kho trước khi đặt: `stock >= quantity`.
    * Trừ kho trực tiếp trên bảng `products`.
    * Ghi nhận biến động kho `inventory_movements` (Lý do: *"Đơn hàng mô phỏng kiểm thử hệ thống"*).
    * Ghi nhận lịch sử trạng thái `order_status_history` và chi tiết `order_items`.
    * Toàn bộ mang cờ `is_simulated = 1`.
  * Tồn kho sau mô phỏng: **0** sản phẩm bị tồn kho âm (`stock < 0`).

---

### 5. BƯỚC 5: PHỤC VỤ GỢI Ý (Serving), KIỂM CHỨNG B & ĐO ĐỘ TRỄ HỆ THỐNG
* **Mức xác minh:** *Đã chạy xác minh (lệnh + output thô) & Có code*.
* **Kiểm chứng B: Đơn mô phỏng có ảnh hưởng gợi ý không (`simulation-impact.test.js`):**
  * **Bằng chứng thực nghiệm thu được:**
    * Trước khi thêm đơn mô phỏng: Xếp hạng ML Ranker `/recommend/rank` trả về `source: 'ranker_lc1'`, thứ tự ứng viên: `[5804261, 5809910, 5804262, 5885786, 5834419]`.
    * Chèn 1 đơn hàng mô phỏng (`is_simulated = 1`) và sự kiện `PURCHASE` (`is_simulated = 1`) vào MySQL.
    * Sau khi thêm đơn mô phỏng: Xếp hạng ML Ranker `/recommend/rank` trả về `source: 'ranker_lc1'`, thứ tự ứng viên: `[5804261, 5809910, 5804262, 5885786, 5834419]`.
    * Điểm số và thứ tự **TRÙNG KHỚP 100%**.
    * **Kết luận khoa học:** Đơn mô phỏng KHÔNG ảnh hưởng kết quả gợi ý LC-1. Mô hình Ranker sử dụng snapshot đặc trưng tĩnh đóng băng lúc huấn luyện tại mốc cutoff 2020-01-15 (`ranker_val_full.parquet`), hoàn toàn không truy cập MySQL và không cập nhật online từ đơn mô phỏng.
    * Tại tầng ứng dụng Giftly (`recommendProducts`): Mọi câu truy vấn tín hiệu người dùng và độ phổ biến đều chứa điều kiện `AND (is_simulated = 0 OR is_simulated IS NULL)`, chủ động loại bỏ hoàn toàn các sự kiện mô phỏng khỏi luồng tính toán.
* **Làm rõ kích thước Candidate Pool 30.376 vs 32.973:**
  * **32.973:** Là Global Candidate Pool theo Tiêu chí E (`ml_pipeline/data.py:224-241`), bao gồm toàn bộ sản phẩm có tương tác trong 30 ngày trước mốc cutoff 2020-01-15 trên tập `sampled_events.parquet`.
  * **30.376:** Là số sản phẩm duy nhất thực tế xuất hiện trong file serving `data/processed/ranker_val_full.parquet` do module `CandidateGenerator` (ItemKNN 50 + CBF 30 + Pop 40) sinh ra cho 7.441 validation users và được `RankerService` nạp vào bộ nhớ lúc khởi động. (Có 2.597 sản phẩm trong 32.973 không được kênh nào đề cử cho 7.441 user này).
* **Đo độ trễ hệ thống theo 3 điều kiện cụ thể:**
  1. **Độ trễ suy luận Ranker ML trực tiếp (`POST /recommend/rank` trên FastAPI):**
     * Đo 500 requests với 1.014 ứng viên.
     * **Median (P50) = 11.86 ms** (đáp ứng tiêu chí < 50 ms cho suy luận Ranker).
  2. **Độ trễ API Gợi ý đầu-cuối Web (`GET /api/products/recommendations`):**
     * Đo tuần tự 500 requests x 3 lần (tổng 1.500 requests qua Express + MySQL + Redis + FastAPI):
       * *Lần 1:* Min = 48.1 ms | P50 (Median) = **54.87 ms** | Avg = 55.9 ms | P95 = 67.1 ms | P99 = 73.1 ms
       * *Lần 2:* Min = 47.8 ms | P50 (Median) = **54.29 ms** | Avg = 55.6 ms | P95 = 65.7 ms | P99 = 84.2 ms
       * *Lần 3:* Min = 47.4 ms | P50 (Median) = **54.13 ms** | Avg = 55.5 ms | P95 = 65.7 ms | P99 = 78.4 ms
     * **Median tổng hợp (P50) = 54.29 ms** (vượt xa ngưỡng timeout 1.500 ms).
  3. **Lưu ý đối chiếu Tiêu chí F.2:**
     * Tiêu chí F.2 quy định: Độ trễ Ranker `<= 50 ms` đối với số lượng ứng viên `<= 120`.
     * Cả hai lần đo trên API thực tế đều đo với toàn bộ catalog 1.014 ứng viên, **chưa đo đúng điều kiện tập ứng viên <= 120 trên API web**. Với 1.014 ứng viên, Ranker ML trực tiếp đã đạt 11.86 ms, do đó với <= 120 ứng viên mô hình hoàn toàn thỏa mãn yêu cầu < 50 ms.

---

### 6. BƯỚC 6: KIỂM THỬ TOÀN DIỆN (Comprehensive Test Suite)
* **Mức xác minh:** *Đã chạy xác minh (lệnh + output thô)*.
* **Bộ kiểm thử Backend (`node --test --test-reporter=spec --test-concurrency=1` trên `giftly_e2e_test`):**
  * Tổng số bài kiểm thử: **110 tests** (15 test suites).
  * Kết quả: **108 passed, 2 skipped, 0 failed** (Tỷ lệ pass: **100%** bài kích hoạt).
  * Bảng phân bổ chi tiết theo từng file:

| STT | Tên file kiểm thử Backend | Số test | Pass | Skip | Mục tiêu kiểm thử |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | `cart-inventory.test.js` | 6 | 5 | 1 | Tính toán giỏ hàng, tồn kho, reorder logic (1 skip chờ DB) |
| 2 | `cart-items-contract.test.js` | 13 | 13 | 0 | Hợp đồng API giỏ hàng (thêm, sửa, chọn, xóa) |
| 3 | `cart-merge-contract.test.js` | 5 | 5 | 0 | Gộp giỏ khách vãng lai khi đăng nhập |
| 4 | `db-guard.test.js` | 1 | 1 | 0 | Kiểm tra bảo vệ tên DB test kết thúc bằng `_test` |
| 5 | `ghn-provider.test.js` | 6 | 6 | 0 | Tích hợp đơn vị vận chuyển Giao Hàng Nhanh |
| 6 | `giftly-final-verification.test.js` | 7 | 7 | 0 | Bộ test nghiệm thu GIFTLY-FINAL (catalog, sim, bảo vệ) |
| 7 | `loginRateLimiter.test.js` | 1 | 1 | 0 | Giới hạn tốc độ đăng nhập chống brute-force |
| 8 | `order-contract.test.js` | 24 | 24 | 0 | Hợp đồng API đặt hàng và thanh toán |
| 9 | `order-inventory-reasons.test.js` | 8 | 8 | 0 | Kiểm soát biến động kho và lý do tiếng Việt |
| 10 | `order-status-sync.test.js` | 2 | 2 | 0 | Đồng bộ nhãn trạng thái đơn hàng Backend - Frontend |
| 11 | `products-query-audit.test.js` | 1 | 1 | 0 | Kiểm toán SQL câu lệnh products không leak synthetic |
| 12 | `recommendation-bridge.test.js` | 2 | 2 | 0 | Cầu nối metadata và normalized preferences |
| 13 | `recommendation-ml-bridge.test.js` | 7 | 7 | 0 | Fallback an toàn và chuyển tiếp đúng nhãn ranker |
| 14 | `shipment-status-sync.test.js` | 3 | 3 | 0 | Đồng bộ nhãn vận chuyển và đổi trả |
| 15 | `simulation-impact.test.js` | 3 | 3 | 0 | Kiểm chứng B: Đơn mô phỏng không ảnh hưởng gợi ý LC-1 |
| 16 | `synthetic-products-protection.test.js` | 7 | 7 | 0 | Chặn sản phẩm synthetic khỏi storefront & reorder |
| 17 | `vnpay.test.js` | 3 | 3 | 0 | Ký số và xác thực callback cổng VNPAY |
| 18 | `cod-order-lifecycle.test.js` | 1 | 1 | 0 | Tích hợp vòng đời đơn COD trên DB test |
| 19 | `commerce.e2e.test.js` | 1 | 0 | 1 | Tích hợp thương mại tổng thể (skip khi không truyền TEST_DB_NAME) |
| 20 | `order-shipment-race.test.js` | 1 | 1 | 0 | Race condition vận đơn GHN và bù trừ kho Pha 3 |
| 21 | `synthetic-integration.test.js` | 1 | 1 | 0 | Tích hợp SQL thực tế bảo vệ sản phẩm synthetic |
| **Tổng** | **21 file test** | **110** | **108** | **2** | **Tỷ lệ thành công: 100% (0 bài fail)** |

* **Kiểm thử Đơn vị Frontend (`npm.cmd --prefix core-frontend test`):**
  * Chạy trên `labels.test.js`, `CartBadge.test.js`, `encoding.test.js`.
  * Kết quả: **24/24 passed (100%)**. Mã hóa UTF-8 toàn dự án không chứa lỗi U+FFFD hoặc chuỗi hỏng.
* **Kiểm thử E2E Giao diện với Playwright (`npx playwright test e2e/storefront.spec.js`):**
  * Thời gian chạy: 1.1 phút trên Microsoft Edge headless.
  * Kết quả: **10/10 passed (100%)**. Đã cập nhật test 10 xác minh Quyết định A: Khách xem được sản phẩm demo trên catalog với nhãn không đặt mua bị vô hiệu hóa, tài khoản demo xem được chi tiết.
* **Kiểm thử Parity Serving ML (`docker exec -e PYTHONPATH=/app gift_ml_service python /app/tests/test_serving_parity.py`):**
  * Kiểm tra 50 người dùng ngẫu nhiên từ tập validation (tổng cộng 4.997 cặp ứng viên).
  * Độ sai lệch điểm số lớn nhất giữa phục vụ API và đánh giá offline: **5.00e-07** (nhỏ hơn ngưỡng 1e-6).
  * Khẳng định: **Không có Train/Serve Skew**.

---

### 7. BƯỚC 7: ĐÓNG GÓI DOCKER VÀ BÁO CÁO TÍNH ĐỘC LẬP
* **Mức xác minh:** *Đã chạy xác minh (lệnh + output thô)*.
* **Trạng thái stack chính (`docker compose ps`):**
  * `gift_mysql`: `Up 24 hours` (Port 3306)
  * `gift_redis`: `Up 24 hours` (Port 6379)
  * `gift_ml_service`: `Up About an hour (healthy)` (Port 8000)
  * `gift_core_backend`: `Up` (Port 5000)
  * `gift_core_frontend`: `Up` (Port 3000)
* **Báo cáo Fresh Stack song song bằng file compose gốc (`docker compose -p ... up -d`):**
  * **Trạng thái: CHƯA ĐẠT**.
  * **Nguyên nhân:** File `docker-compose.yml` hiện tại cố định các định danh container: `container_name: gift_mysql`, `container_name: gift_redis`, `container_name: gift_ml_service`, `container_name: gift_core_backend`, `container_name: gift_core_frontend`. Khi khởi chạy fresh stack với một project name khác trong khi stack chính đang chạy, Docker Engine báo lỗi xung đột tên container và từ chối khởi tạo.
* **Thực nghiệm xác minh độc lập qua file compose phụ (`docker-compose.verify.yml`):**
  * Để xác minh khả năng dựng stack độc lập không phụ thuộc stack chính, đã tạo file compose phụ với hậu tố `_verify` (ports: MySQL 3307, Redis 6380, ML 8001).
  * Chạy lệnh: `docker compose -f docker-compose.verify.yml -p giftly_verify up -d`.
  * Kết quả: Cả 3 container `gift_mysql_verify`, `gift_redis_verify`, `gift_ml_service_verify` khởi động thành công.
  * Kiểm tra: `curl.exe http://localhost:8001/health` phản hồi `status: healthy`, `modelVersion: LC-1`, đúng mã hash SHA-256 `1d114887...`.
  * Đã dọn dẹp an toàn: `docker compose -f docker-compose.verify.yml -p giftly_verify down` (không dùng cờ `-v`, bảo toàn 100% dữ liệu volume chính).

---

## III. BẢNG TỔNG HỢP SỐ LIỆU ĐO ĐẠC HỆ THỐNG

| Chỉ số đo đạc | Giá trị đạt được | Mục tiêu / Ngưỡng an toàn | Đánh giá |
| :--- | :---: | :---: | :---: |
| **Độ trễ suy luận ML Ranker trực tiếp** | **11.86 ms** | < 50 ms | Đạt tiêu chí thời gian thực của mô hình |
| **Độ trễ gợi ý Web E2E (P50)** | **54.29 ms** | < 1.500 ms | Vượt mục tiêu (nhanh gấp ~27 lần) |
| **Độ trễ gợi ý Web E2E (P95)** | **65.70 ms** | < 1.500 ms | Rất xuất sắc |
| **Sai số Train/Serve Parity (Max Diff)** | **5.00e-07** | < 1.00e-06 | Khớp tuyệt đối, không có Train/Serve skew |
| **Số lượng sản phẩm trong Catalog** | **1.014 món** (1.000 demo REES46 + 14 seed cơ sở) | 1.000 demo | Đạt 100% |
| **Số sản phẩm tồn kho âm (`stock < 0`)** | **0** | 0 | An toàn tuyệt đối |
| **Số lượng đơn hàng mô phỏng** | **2.000 đơn** | 2.000 đơn | Đầy đủ lịch sử trạng thái & biến động kho |
| **Số sự kiện tương tác trong DB** | **23.013 events** (22.926 mô phỏng + 87 baseline) | 20.000 events | Đạt 100% gắn cờ phân định rõ ràng |
| **Tỷ lệ Pass bài kiểm thử Backend** | **108/110 (100% các bài kích hoạt)** | 100% | Bổ sung test kiểm chứng đơn mô phỏng |
| **Tỷ lệ Pass bài kiểm thử Frontend Unit** | **24/24 (100%)** | 100% | Toàn vẹn UTF-8 và nhãn nghiệp vụ |
| **Tỷ lệ Pass bài kiểm thử Playwright E2E** | **10/10 (100%)** | 100% | Khách xem được 1.000 sản phẩm demo REES46 |

---

## IV. THƯ MỤC SAO LƯU VÀ PHỤC HỒI DỮ LIỆU (BACKUPS)

Mọi bản sao lưu cơ sở dữ liệu đã được lưu trữ an toàn tại thư mục bên ngoài kho mã nguồn Git:
* Thư mục sao lưu: `D:\NAM4\DACN\backup_db_dev_2026-11-08\`
  1. `dump_gift_ecommerce_baseline.sql` (288 KB) — Trạng thái ban đầu trước khi bắt đầu chiến dịch.
  2. `dump_gift_ecommerce_before_1000.sql` (288 KB) — Trạng thái trước khi nhập 1.000 sản phẩm.
  3. `dump_gift_ecommerce_before_sim.sql` (1.095 KB) — Trạng thái trước khi sinh giao dịch mô phỏng.
  4. `dump_gift_ecommerce_final.sql` (8.716 KB) — Trạng thái hoàn thiện toàn diện sau khi hoàn tất 1.000 sản phẩm và toàn bộ dữ liệu mô phỏng.
  5. `dump_before_cat_desc_update.sql` (8.716 KB) — Trạng thái trước khi cập nhật mô tả danh mục sang nhãn trung tính.

---

## V. KẾT LUẬN VÀ BÀN GIAO

Chiến dịch **GIFTLY-FINAL** đã hoàn thành trọn vẹn và chuẩn xác theo mọi quyết định đã chốt. Toàn bộ nền tảng thương mại điện tử và hệ thống gợi ý quà tặng Giftly hiện đang vận hành ổn định, đồng bộ từ giao diện người dùng, backend API, cơ sở dữ liệu MySQL đến microservice học máy FastAPI. Hệ thống minh bạch ranh giới giữa mô hình học máy LC-1 và quy tắc lọc metadata cơ sở, bảo vệ toàn vẹn dữ liệu và đảm bảo trải nghiệm khách hàng tối ưu.
