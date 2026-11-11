# GIFTLY — báo cáo snapshot xác minh

Ngày ghi nhận: 2026-11-11. Báo cáo này chỉ ghi kết quả có log trong các giai đoạn 6–7 của nhánh `feature/giftly-luong-giao-hang`. Các con số trong tài liệu nghiệm thu cũ đã được thay bằng trạng thái dưới đây; kết quả lịch sử không được xem là đo lại ở snapshot này.

## Bảng xác minh

| Hạng mục | Mức xác minh | Lệnh / thao tác | Output ghi nhận |
|---|---|---|---|
| Frontend unit | Đã chạy, giai đoạn 6 | `npm.cmd test` trong `core-frontend` | 24 pass, 0 fail |
| Frontend lint | Đã chạy, giai đoạn 6 | `npm.cmd run lint` trong `core-frontend` | Thành công, không có lỗi lint |
| Frontend build | Đã chạy, giai đoạn 6 | `npm.cmd run build` trong `core-frontend` | Thành công; cảnh báo chunk JavaScript 515.68 kB vượt mức khuyến nghị 500 kB |
| Playwright E2E | Đã chạy, giai đoạn 6 | Playwright trên backend và DB `giftly_e2e_test` | 28 passed (1.1m) |
| Cấu hình Compose | Đã chạy | `docker compose -p giftly_clean config --quiet` với biến môi trường test | Exit code 0 |
| Docker services | Đã chạy | `docker compose -p giftly_clean ps` | 5 dịch vụ healthy/running: MySQL, Redis, ML, backend, frontend |
| Migration + seed | Đã chạy trên DB test cô lập | `docker compose -p giftly_clean exec -T core-backend npm run migrate`; `npm run seed:demo` | Migration 000–014 applied; seed: 5 categories, 14 products |
| ML health | Đã chạy | `curl http://localhost:18000/health` | `status=healthy`, `modelVersion=LC-1`, SHA-256 `1d11488782894eae3b4eb142943303f4c9e85d0784f800047396d4f444eea8ff`, `totalUsersLoaded=7441`, `candidatePoolSize=30376` |
| Tài khoản REES46 demo | Đã chạy | Đăng nhập qua backend container và gọi `/api/products/recommendations?limit=8` | Đăng nhập thành công; `source=ranker_lc1`; trả 8 items |
| Frontend qua Docker | Đã chạy | `curl http://localhost:13000` | HTTP 200 |
| Backend full suite | Đã chạy trên `giftly_e2e_test` | `node --test --test-reporter=spec --test-concurrency=1` với `DB_NAME=TEST_DB_NAME=giftly_e2e_test`, `NODE_ENV=test` | 141 tests, 141 pass, 0 fail, 0 skipped; duration 37299.1906 ms |
| Production / merchant thật | Chưa làm | Không áp dụng | VNPAY/GHN sandbox/local; chưa xác minh giao dịch thật |

## Compose và dữ liệu

Stack được khởi chạy bằng project riêng `giftly_clean`, các cổng host 13306 (MySQL), 16379 (Redis), 18000 (ML), 15000 (backend), 13000 (frontend). `DB_NAME=giftly_e2e_test`; volume MySQL mới `giftly_clean_mysql_data`. Sau khi kiểm tra đã chạy `docker compose -p giftly_clean down` không có `-v`; container/network đã dừng và volume còn nguyên.

Một lượt importer chạy từ host ban đầu đã kết nối nhầm MySQL ở cổng 3306, nhưng biến DB vẫn là `giftly_e2e_test`; output ghi nhận thêm 3 user demo, không thêm sản phẩm. Dữ liệu không bị xóa. Lượt chạy sau chỉ rõ `DB_HOST=127.0.0.1`, `DB_PORT=13306`, `DB_NAME=TEST_DB_NAME=giftly_e2e_test`, và chạy vào DB của project cô lập: thêm 188 sản phẩm REES46 và 3 tài khoản demo; tổng catalog khi đó là 202 sản phẩm (14 seed + 188 REES46), 3 user. Theo log thao tác, không ghi vào `gift_ecommerce` hoặc `giftly_verification_test`.

Backend suite lần đầu chạy khi DB chưa có fixture demo, kết quả 135 pass và 6 fail (hai test nhóm Gift Finder và bốn assertion về catalog/giao dịch mô phỏng). Sau đó `node scripts/resetTestDb.js giftly_e2e_test --seed-demo` dựng lại fixture từ các file đã commit: 1.000 sản phẩm demo, rule_v1 tags, 2.000 đơn mô phỏng và hơn 20.000 sự kiện. Chạy lại cùng lệnh suite đạt 141/141, không sửa test hoặc assertion. Các test tích hợp tự reset chỉ `giftly_e2e_test`; log của các file tích hợp xác nhận `SELECT DATABASE(): giftly_e2e_test`.

## Giới hạn và việc chưa đo

- Docker được xác minh trên máy phát triển, không phải production. Cần cấu hình secret và cổng riêng trước khi chạy ở môi trường khác.
- VNPAY và GHN chưa được xác minh với merchant production; kết quả local/sandbox không chứng minh thanh toán hoặc webhook ngoài thực tế.
- Build frontend thành công nhưng cảnh báo bundle 515.68 kB chưa được xử lý.
- Không có log raw đính kèm dưới dạng file riêng trong repository; các dòng kết quả trên được chép từ output công cụ của phiên xác minh.
