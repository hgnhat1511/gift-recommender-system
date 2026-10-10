# Giftly — Tiến độ mở rộng

Cập nhật: 2026-10-10. Không có metadata Git trong workspace nên không thể báo cáo diff/index Git. Database đang dùng có `users`, `categories`, `products`; ba bảng đều rỗng lúc bắt đầu đợt mở rộng. Các volume Docker được giữ nguyên.

## Ma trận audit và trạng thái

| Nhóm | Trước đợt này | Hiện tại |
|---|---|---|
| Auth/JWT | Đã triển khai | Giữ nguyên; thêm profile/change-password; admin role đọc từ DB |
| Catalog | Giao diện demo, DB rỗng | Trang chủ/danh mục/sản phẩm mới/nổi bật lấy từ DB; API phân trang/lọc/tìm/sắp xếp, chi tiết và review summary |
| Giỏ hàng | Chỉ tăng counter trên client | Giỏ MySQL persistent, chọn dòng hàng, tồn kho; checkout một phần giữ hàng chưa chọn |
| Checkout | Chưa có | COD; quote coupon/phí; order/items/history/inventory trong transaction |
| Đơn hàng | Chưa có | Tìm/lọc, chi tiết theo chủ, mua lại có kiểm tồn, lịch sử vận chuyển/đổi trả, hủy PENDING, state machine admin |
| Admin | Chưa có | Dashboard có lọc ngày và hiệu suất danh mục; sản phẩm/danh mục/banner, coupon theo danh mục, đơn lọc ngày/trạng thái/thanh toán, khách/role, tồn kho ledger/adjustment, return, review moderation |
| Profile | Chưa có | Thông tin liên hệ, mật khẩu, địa chỉ, yêu thích, thông báo và yêu cầu xóa có xác thực/queue admin |
| Gift Finder | Nút placeholder | Content matching từ tags catalog, budget, lời giải thích khớp; ghi sự kiện tìm và click |
| AI Python | `main.py`/requirements/data rỗng | Chưa triển khai model hoặc FastAPI; không khai báo kết quả ML |
| Redis | Health check | Dùng health check; chưa cache nghiệp vụ |
| Thanh toán/vận chuyển/email | Chưa tích hợp | COD; admin lưu hãng/mã vận đơn/lịch sử nội bộ, khách xem trong app và nhận thông báo; chưa có API hãng hoặc email reset |

## File đã tạo/cập nhật chính

- Backend: `controllers/{account,admin,cart,catalog,order,return,review}Controller.js`, `routes/{account,admin,cart,catalog,order,review}Routes.js`, `middleware/authMiddleware.js`, `scripts/{migrate,seedDemo,promoteAdmin}.js`.
- Frontend: `layouts/StoreLayout.jsx`, `pages/store/{CatalogPages,CommercePages}.jsx`, `pages/account/AccountPages.jsx`, `pages/admin/AdminPages.jsx` (dashboard, inventory ledger/adjustment, date/payment filters), stylesheet đi kèm, `data/catalogOptions.js`, routes trong `main.jsx`, catalog API trong `App.jsx`.
- Database/docs: `database/migrations/002_store_operations.sql`, `database/migrations/003_account_deletion_requests.sql`, `database/migrations/004_homepage_banners.sql`, `database/migrations/005_coupon_categories.sql`, `README.md`, `PROGRESS.md`, `.env.example` và npm scripts.

## Migrations và môi trường

Chạy `cd core-backend; npm.cmd run migrate`; migration thêm `orders.shipping_carrier`, `orders.tracking_number`, `cart_items.is_selected`, lịch sử vận chuyển/yêu cầu xóa, bảng `homepage_banners` và mapping `coupon_categories` theo cách lặp an toàn. Sau đó `npm.cmd run seed:demo` để nạp catalog minh họa. Cấu hình thêm `SHIPPING_FEE=30000`, `FREE_SHIPPING_MINIMUM=500000`. Cần đăng ký tài khoản trước khi cấp admin bằng `npm.cmd run admin:promote -- email@example.com`. Không tự sinh admin/mật khẩu mặc định.

## Xác minh

- Migration chạy idempotent trên database có dữ liệu.
- Seed chạy hai lần không nhân đôi; hiện có 5 category, 14 product demo.
- Các lượt integration trên MySQL/Redis: auth/checkout 48/48; inventory/return/dashboard 22/22; tracking/Gift Finder 6/6; coupon CRUD 6/6; review distribution 1/1; SQL injection ở tìm kiếm 1/1. Đã xác minh idempotency, chặn tồn âm, ledger, nhập lại hàng khi hoàn tất đổi trả, bộ lọc và COD. Tài khoản/đơn/coupon/event thử đã được dọn; giữ lại 5 danh mục và 14 sản phẩm demo.
- Lint/build frontend và kiểm tra cú pháp toàn bộ JavaScript backend đạt; health check MySQL và Redis thành công.
- Luồng shipping: 14 assertion API/MySQL đạt, gồm từ chối trạng thái chưa xử lý, ghi và sửa tracking, bỏ qua bản cập nhật trùng, lịch sử/notification, giới hạn quyền xem, admin detail và hoàn tồn kho. Fixture thử đã được xóa.
- Search/return: 7 assertion API/MySQL đạt cho tra mã đơn, quyền xem, tạo yêu cầu, status/phản hồi admin và cách ly dữ liệu; fixture đã được dọn.
- Giao diện admin có form cập nhật carrier/tracking ở trạng thái PROCESSING/SHIPPED; trang chi tiết của chủ đơn hiển thị thông tin và lịch sử, kèm nhãn rõ ràng rằng chưa đồng bộ hãng.
- Lịch sử đơn có ô tìm theo mã và bộ lọc trạng thái dùng chung query URL. Chi tiết đơn hiển thị tiến độ/phản hồi đổi trả và có nút mua lại; API kiểm tra stock/status và lượng đã có trong giỏ trước khi ghi trong transaction.
- Reorder API: 7 assertion tích hợp đạt, gồm chặn đơn người khác, thêm item, gộp giỏ, từ chối vượt tồn, bảo toàn giỏ khi lỗi, không giữ tồn trước checkout và dọn fixture về stock ban đầu.
- Yêu cầu xóa tài khoản: 11 assertion tích hợp đạt cho password confirmation, duplicate pending, phân quyền/đọc dữ liệu theo chủ, admin review, notification và không xóa tài khoản ngầm. Migration 003 đã áp dụng; fixture đã xóa.
- Chọn giỏ/checkout: 13 assertion tích hợp đạt cho default selected, validation/ownership, subtotal/quote, checkout một phần, giữ dòng chưa chọn/idempotency và phục hồi stock sau fixture. is_selected migrate mặc định TRUE.
- Banner trang chủ: 19 assertion API/MySQL đạt cho role, URL, lịch UTC, CRUD/ẩn, public visibility và response fields. Tài khoản/banner fixture đã được dọn; database còn 0 user fixture/0 banner fixture, 5 danh mục và 14 sản phẩm demo. Migration 004 chạy trên DB hiện có.

- Bản in tóm tắt: dùng dữ liệu snapshot từ API chi tiết đơn; không gắn nhãn hóa đơn thuế. Frontend lint và production build đạt sau thay đổi; chưa xác minh bản in trực quan trong trình duyệt.
- Coupon theo danh mục: 20 assertion API/MySQL đạt; quote và order đều giảm trên eligible subtotal, minimum áp dụng cho đúng danh mục, cancel hoàn usage và stock. Fixture đã dọn; lint/build backend syntax đạt.

## Còn thiếu / bước tiếp theo

1. Kiểm tra thủ công các trang trên trình duyệt desktop/mobile; hiện đã xác minh API, lint và production build nhưng chưa chạy browser automation.
2. Nếu cần vận hành thật: HTTPS, cookie HttpOnly/CSRF, shared rate limit, MySQL app user, backup/restore, cấu hình CSP.
3. Tích hợp email provider rồi mới bật luồng reset token; hiện không có API khôi phục mật khẩu.
4. Tích hợp thanh toán và hãng vận chuyển; hiện chỉ COD và cập nhật nội bộ.
5. Nạp catalog/ảnh chính thức thay dữ liệu demo; thêm upload ảnh an toàn, biến thể và CMS cho nội dung tĩnh.
6. Thu thập dữ liệu tương tác có đồng ý, triển khai service Python/model, đánh giá trên dữ liệu thật rồi mới mô tả gợi ý là ML.
7. Cân nhắc giỏ khách vãng lai, hoàn thiện quy trình xóa/ẩn danh theo chính sách lưu trữ, lịch sử tìm kiếm và tùy chọn thông báo.
8. Có thể bổ sung tạo PDF riêng phía server, biến thể sản phẩm và upload ảnh an toàn.
9. Bổ sung CMS cho nội dung tĩnh và chỉ số vận hành AI sau khi có model Python; hiện chưa có model hoặc dashboard mô hình.


## 2026-10-10 - Activity based recommendations

- Added `core-backend/services/recommendationService.js` and public/optional-auth `GET /api/products/recommendations`. It scores real MySQL product events and current favorites with category/tag/style/type matching, 180-day history, 90-day decay, stock/status filtering, and a clear `personalized_activity` versus `popular_cold_start` method label.
- Connected the homepage recommendation section and explanation reasons; clicking a recommendation card records `RECOMMENDATION_CLICK`. No schema change or migration was needed because the existing product event/favorite tables support this baseline.
- Verified 24 API/MySQL assertions: public cold start, limit validation, temporary registration/login, favorite inclusion and exclusion, favorite removal no longer being treated as positive interest, view-based category matching and explanation, click event persistence, available-stock filtering, and absence of account fields. The temporary account, favorites, and user events were deleted afterward.
- Frontend `npm.cmd run lint` and `npm.cmd run build` passed; backend `node --check` passed for the recommendation service, catalog controller, and route. Live MySQL and Redis health endpoints returned success.
- The recommendation baseline is not a trained ML/AI model. Training, evaluation, and Python FastAPI integration remain future work.


## 2026-10-10 - Checkout delivery selection

- Added a server-validated STANDARD/EXPRESS choice to checkout quotes and order creation. Quote recalculation uses the configured fees, applies the free-shipping threshold to STANDARD only, and stores the chosen method with the order. Idempotent retries return the original selected method.
- Added orders.shipping_method as a safe conditional schema update in scripts/migrate.js and included the column in the fresh-install orders definition. Existing rows receive the backward-compatible STANDARD default. Added EXPRESS_SHIPPING_FEE to .env.example; the local .env was left untouched.
- Connected the customer checkout selector, order details, and admin order list. The UI states that delivery pricing is simulated and carrier integration is not connected; COD remains the only payment option.
- Verified 20 API/MySQL assertions across invalid methods, both quotes and totals, express checkout, order detail persistence, idempotent retry, cancellation, and stock restoration. Temporary account/order/address/cart/event fixtures were removed after stock was restored.
- Final frontend lint/build and backend syntax checks passed after implementation. The migration runner passed again without duplicate schema changes. MySQL and Redis health checks, plus the public recommendation endpoint, returned success. Final database audit found no temporary recommendation/shipping users, orders, or events; catalog remained at 5 categories and 14 active products.


## 2026-10-10 - Customer review history and moderation

- Added GET /api/account/reviews with bounded pagination and owner-scoped product/order details; connected a review history section to the account page with edit, delete, and load-more actions.
- Kept review updates/deletes scoped to the authenticated owner. An edit resets approval so changed text waits for admin moderation. Verified purchase validation remains required for new reviews; no schema migration was needed.
- Verified 19 API/MySQL assertions for delivered-order eligibility, pagination validation, owner-only history/update/delete, pending moderation after edits, public hiding, and deletion. Temporary accounts, review, order, and order item fixtures were removed; no stock was changed.
- Frontend lint/build and backend syntax checks passed after the account-page integration. Final database audit found zero review test users, orders, or reviews.


## 2026-10-10 - Guest cart and safe account merge

- Added a browser-local guest cart storing product ID, quantity and selected state only. Catalog cards, product detail, Gift Finder and homepage quick-add now let visitors add products without first signing in; the home/cart navigation opens the guest cart.
- Added public read-only `GET /api/products/lookup?ids=...` for current active product snapshots without creating VIEW events. Guest checkout redirects through sign-in and returns to checkout after a successful merge.
- Added authenticated `POST /api/cart/merge`: validates input, locks products and existing cart rows, checks status/stock/quantity, merges all rows in one transaction, preserves selected lines and writes CART_ADD events. HTTP 409 leaves the local guest rows editable.
- Added migration `006_cart_merge_requests.sql` for per-user merge idempotency keys, so a retry after an ambiguous network response cannot increment the account cart twice. Migration ran successfully on the existing database; no existing cart or inventory rows were reset.
- Verified 16 API/MySQL assertions: active lookup and current stock, lookup does not record VIEW, invalid IDs, auth required, temporary register/login, merge and selection persistence, same-key idempotent retry, 409 stock conflict with rollback, no idempotency record for a failed merge, and malformed-ID rejection. Temporary user/cart/events/merge rows were cleaned; no stock was changed.
- Frontend lint and production build passed. Backend changed files passed `node --check`. Browser automation was unavailable, so visual browser flow remains unverified.
