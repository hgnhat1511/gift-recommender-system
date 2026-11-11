# Giftly — báo cáo xác minh mới nhất

Ngày chạy: 2026-11-11. Nhánh: `feature/giftly-luong-giao-hang`. Báo cáo này ghi output của lượt kiểm tra gần nhất; không đại diện cho tích hợp production.

## Kết quả

| Hạng mục | Mức xác minh | Lệnh / thao tác | Output ghi nhận |
|---|---|---|---|
| Backend | Đã chạy | `DB_NAME=TEST_DB_NAME=giftly_e2e_test`, `NODE_ENV=test`; `node --test --test-reporter=spec --test-concurrency=1` tại `core-backend` | Thô: `ℹ tests 147`, `ℹ suites 15`, `ℹ pass 147`, `ℹ fail 0`, `ℹ cancelled 0`, `ℹ skipped 0`, `ℹ todo 0`, `ℹ duration_ms 93109.4712` |
| Frontend unit | Đã chạy | `npm.cmd test` tại `core-frontend` | Thô: `# tests 24`, `# pass 24`, `# fail 0`, `# skipped 0` |
| Frontend lint | Đã chạy | `npm.cmd run lint` | Thô: `eslint .`, exit code `0` |
| Frontend build | Đã chạy | `npm.cmd run build` | Thô: `✓ 1998 modules transformed`, `✓ built in 539ms`; exit code `0` |
| Giao diện Playwright | Đã chạy | `npx.cmd playwright test -c playwright-visual.config.js e2e/phase5-commerce-ui.spec.js` | Thô: `3 passed (5.5s)` |
| Playwright E2E | Đã chạy | `PLAYWRIGHT_DB_NAME=giftly_e2e_test`, secret test-only; `npx.cmd playwright test` | Thô: `28 passed (1.4m)`. Hai lượt chạy hoàn tất; lượt cuối gồm assertion UI shipper A không thấy đơn của shipper B. |
| Database backend | Đã chạy trên DB `_test` | `node scripts/resetTestDb.js giftly_e2e_test --seed-demo` | Thô: `SELECT DATABASE(): giftly_e2e_test`, `Đã áp dụng toàn bộ 16 file migrations`, `Hoàn tất ... 27 bảng`; seed tạo 1.000 sản phẩm demo, 14 sản phẩm cơ sở và 2.000 đơn mô phỏng. Chỉ reset `giftly_e2e_test`. |
| Docker Compose | Đã chạy | `docker compose -p giftly_clean_20261111 up --build -d`; sau đó `docker compose ... ps` | 5 dịch vụ MySQL, Redis, ML, backend, frontend đều healthy/running. Project dùng DB `giftly_e2e_test` và volume riêng. |
| ML trong Docker | Đã chạy | `curl.exe -fsS http://localhost:8001/health` | Thô: `status=healthy`, `modelVersion=LC-1`, `totalUsersLoaded=7441`, `candidatePoolSize=30376`, SHA-256 `1d11488782894eae3b4eb142943303f4c9e85d0784f800047396d4f444eea8ff` |
| Tài khoản REES46 demo | Đã chạy | Import fixture vào DB `_test`, đăng nhập qua `http://localhost:5002/api/auth/login`, gọi `/api/products/recommendations?limit=8` | Thô: `demo-login: success=True, role=USER`; `recommendation-source: ranker_lc1; count=8` |
| HTTP backend / frontend Docker | Đã chạy | `curl.exe` tới cổng 5002 và 3001 | Thô: `backend root HTTP 200`, `frontend HTTP 200` |
| Docker dừng | Đã chạy | `docker compose -p giftly_clean_20261111 down` | Container/network đã dừng; hai volume `giftly_clean_20261111_mysql_data` và `giftly_clean_20261111_redis_data` còn nguyên. Không dùng `-v`. |

## Playwright theo file

| File | Số test chạy | Kết quả |
|---|---:|---|
| `e2e/cart-badge.spec.js` | 7 | Đạt |
| `e2e/delivery-flow.spec.js` | 2 | Đạt; COD nội bộ, GHN webhook, khách xác nhận/đổi trả, cách ly shipper A/B |
| `e2e/phase5-commerce-ui.spec.js` | 3 | Đạt |
| `e2e/storefront.spec.js` | 10 | Đạt |
| `e2e/visual-audit.spec.js` | 6 | Đạt |
| **Tổng** | **28** | **28 passed** |

Backend spec reporter ghi tổng suite và tên test, còn log lượt chạy này không lưu số leaf test theo từng backend file thành báo cáo riêng. Các integration file giao hàng/thanh toán được chạy trong suite gồm `cod-order-lifecycle.test.js`, `commerce.e2e.test.js`, `delivery-receipt.test.js`, `delivery-receipt-safe.test.js`, `dev-ghn-deliver.test.js`, `order-shipment-race.test.js`, `payment-flow-safe.test.js`, `shipper-flow.test.js`, `synthetic-integration.test.js` và `simulation-impact.test.js`. Tổng suite là 147/147; không suy diễn số đếm riêng từng file khi output không ghi chúng.

## Quy tắc nghiệp vụ đã đối chiếu

- COD tạo đơn trước; nếu đủ kho thì backend tự chuyển sang `PROCESSING`.
- VNPAY tạo đơn `PENDING/UNPAID` và payment attempt `PENDING`; IPN hợp lệ chỉ cập nhật thanh toán `PAID`. IPN trùng được xử lý idempotent; attempt hết hạn thành `EXPIRED`, IPN thành công về muộn chuyển `REVIEW`.
- GHN webhook là nguồn trạng thái duy nhất cho shipment GHN. Shipper nội bộ chỉ thao tác đơn được gán và có nguồn `INTERNAL`; admin không có thao tác đặt tay `SHIPPED/DELIVERED` hoặc nhập carrier/tracking tự do.
- Khi giao thành công, COD chuyển `PAID` và `delivered_at` được ghi một lần. Khách có thể xác nhận nhận hàng; sau 7 ngày hệ thống coi đã nhận khi đọc. Ảnh không tự đổi trạng thái.
- Đổi trả tính hạn từ `delivered_at`; hoàn tất đổi trả nhập lại kho nhưng chưa tự động hoàn tiền.
- Sản phẩm demo synthetic hiện bị chặn mua theo quyết định tạm thời của người dùng.

## Giới hạn / chưa làm

- Chưa thực hiện giao dịch VNPAY/GHN với merchant production; kết quả là test callback, local hoặc sandbox.
- LC-1 được huấn luyện/đánh giá trên REES46; chỉ tài khoản demo REES46 đã ánh xạ dùng được nhánh `ranker_lc1`. Chưa huấn luyện hoặc đánh giá trên dữ liệu Giftly.
- Chưa tích hợp email gửi thật hoặc hoàn tiền tự động.
- Docker run dùng cổng thay thế vì 3000, 5000 và 3306 đã có listener; frontend được xác minh ở 3001, backend 5002, MySQL 13307, Redis 16380, ML 8001.
- Không ghi vào `gift_ecommerce` hoặc `giftly_verification_test` trong lượt xác minh này. File root `.env` chứa secret Compose cục bộ, được Git ignore.
