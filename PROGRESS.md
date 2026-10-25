# Giftly — Tiến độ mở rộng

> **Lưu ý bảo mật:** Trước lần push đầu tiên phải quét bí mật (.env.example, e2e, playwright.config.js, URL chứa credential, chuỗi hex/base64 dài).

Cập nhật: 2026-10-25 (Triển khai Giai đoạn 2 - Giỏ hàng và tồn kho trên nhánh `feature/giftly-hoan-thien`).
- Đã tạo `CartContext` dùng chung (`core-frontend/src/context/CartContext.jsx`), khắc phục lỗi badge số lượng giỏ hàng trên header bị mất/hiển thị 0 trên StoreLayout. Quy ước tính `itemCount = sum(quantity)` đồng bộ cả khách vãng lai và người dùng đã đăng nhập.
- Đã bổ sung chi tiết tồn kho khi thêm/sửa giỏ hàng và đặt đơn: phản hồi lỗi khi không đủ tồn kho nêu rõ tên sản phẩm, số lượng còn lại trong kho và số lượng khách yêu cầu.
- Giữ nguyên mô hình trừ kho nguyên tử (`stock = stock - ? WHERE stock >= ?`), hoàn kho khi khách hủy đơn (đính chính: worker hết hạn thanh toán chưa được triển khai tại giai đoạn này, hiện tại chỉ hoàn kho khi hủy đơn); không thêm cột giữ hàng.
- Triển khai Khu vực 0: Tạo file nhãn tập trung `core-frontend/src/lib/labels.js`, chuẩn hóa và Việt hóa 100% nhãn trạng thái (đơn hàng, ngoại lệ VNPAY UNPAID PENDING -> "Chờ thanh toán", thanh toán, đổi/trả, vận chuyển, khách hàng, vai trò, sản phẩm, yêu cầu xóa tài khoản) tại `/orders`, `/orders/:id`, `/account`, và toàn bộ admin portal (dashboard KPI, orders toolbar/bảng/chi tiết, customers, returns, deletion requests).
- Viết unit test `core-frontend/src/lib/labels.test.js` import code thật (8/8 tests PASS).
- Bổ sung bộ kiểm thử an toàn `core-backend/test/cart-inventory.test.js` (unit test toán tử và format lỗi; test DB integration tự động skip khi không có `TEST_DB_NAME`). Toàn bộ 13 unit test backend PASS (1 skipped an toàn).
- Frontend lint (`npm run lint` đạt 0 lỗi) và build production (`npm run build` thành công).

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


## 2026-10-12 - Persistent product image galleries

- Added additive migration `007_product_images.sql` for ordered, product-owned gallery URLs with a cascade foreign key. Existing products retain their existing `image_url` as the primary image; gallery images are separate rows.
- Product detail API now returns the primary image first and gallery images in saved order. Admin list/create/update responses include gallery URLs; create/update writes gallery rows in the same transaction as the product change and audit record. Omitting `galleryImages` on an update preserves the current gallery for older API clients.
- Added an admin textarea for up to eight unique HTTPS image URLs and selectable thumbnails on customer product detail. No upload service was added; images must already be hosted. Main image URLs remain backward-compatible and are checked against the database's 500-character column.
- `node --check` passed for the changed backend controllers and migration runner; frontend lint and production build passed. MySQL migration/API integration could not run: Docker Desktop daemon was unavailable and localhost ports 3306/6379 refused connections. No database data was changed. Run `npm.cmd run migrate` from `core-backend` and repeat API checks once MySQL is reachable.


## 2026-10-12 - VNPAY, GHN webhook and Python recommendation bridge

- Added additive migrations `008_payments_and_shipments.sql` and `009_shipment_client_order_code.sql` for payment attempts, shipment records, idempotency keys and carrier event history. Ran migrations 001–009 repeatedly against the existing development database; existing catalog rows were retained.
- Added VNPAY sandbox URL generation/signature verification, authenticated payment initiation, provider IPN reconciliation and browser return redirect. Only a signed, amount-matched, eligible IPN can mark an order paid. Missing credentials keep VNPAY unavailable; no live provider transaction was attempted.
- Added optional GHN shipment creation for eligible admin-managed orders, package validation, client order idempotency, shared-secret webhook, event deduplication, timestamp ordering and a forward-only shipment state machine. Fixture integration verified delivered, stale, duplicate and newer-but-backward events; invalid transitions did not revert shipment/order status. No carrier API request was made because merchant credentials/address config are absent.
- Added FastAPI content-based endpoints and a Node bridge that validates candidate IDs and falls back to the Node baseline on service errors. Gift Finder now forwards its candidate set and context to Python after existing Node matching; Python filters query/budget and ranks with explanations. Health/model, recommendation and Gift Finder bridge requests were checked locally; the baseline is not trained ML.
- Connected VNPAY choice/retry and GHN sandbox shipment form to existing checkout/admin screens. Updated `.env.example` and README. The local `.env` was not modified.
- Verification: backend tests 9/9 pass; Python unit tests 4/4 pass; `node --check` passes for 37 backend JS files; frontend ESLint and Vite production build pass; migrations rerun successfully; MySQL and Redis health endpoints pass. VNPAY API integration assertions passed with test-only provider settings and temporary DB fixtures, which were removed.
- Final database check: 0 users, 0 orders, 0 payment attempts, 0 shipments; 5 categories and 14 products remain. No existing business data was reset. Remaining provider checks require merchant sandbox credentials and public callback reachability; ML model training/evaluation remains future work.

### Follow-up audit: checkout E2E and fresh database bootstrap

- Ran the real Express API against MySQL for a temporary customer: register, login/JWT `/me`, create address, add cart item, quote STANDARD shipping, create order, retry with the same idempotency key, read order detail, cancel, and verify the original stock was restored. The user/order/cart/address/event/history/inventory fixtures were removed afterward.
- Found that a brand-new Compose database did not import `database/schema.sql`, while migrations 001–002 assumed `users`, `categories`, and `products` already existed. Added `000_base_catalog.sql` with `CREATE TABLE IF NOT EXISTS`, preserving an existing catalog.
- Updated the migration runner to treat the connection's `DB_NAME` as authoritative and skip legacy `USE gift_ecommerce` statements, so a separately configured database can be migrated without redirecting to the development schema.
- Clean-schema migration plus demo seed passed on a uniquely named disposable database, separate from `gift_ecommerce`; all four expected feature tables existed and the fixture schema was dropped after verification. The development database retains 5 categories and 14 products with zero test users/orders.
- Persisted that customer-flow check as `test/integration/commerce.e2e.test.js` and added `npm run test:integration`. It refuses non-`giftly_*_test` schemas and refuses schemas containing users/orders; the suite passed against a fresh isolated database and removed its fixtures. It covers Gift Finder fallback along with registration, checkout and inventory restoration.
- Connected Gift Finder to the Python baseline without replacing its Node candidate filter. Python now uses gift preferences, budget and query text; invalid/unavailable results fall back to existing Node matching. The real Express → MySQL → FastAPI query returned the in-budget coffee gift with a text-match explanation.
- The expanded payment integration test exposed an unsafe cancellation path: a VNPAY-paid `PENDING` order could be cancelled and have stock restored without a refund. Customer and admin cancellation now reject paid orders; customer/admin UI no longer offers the unsafe cancellation action. The test verifies browser return is non-authoritative, invalid signatures/amounts are rejected, late success after cancellation becomes `REVIEW`, failed callbacks remain unpaid, successful callbacks are idempotent, GHN webhooks reject bad secrets/duplicates/backward updates, and delivered COD orders settle as paid.
- Latest checks: backend 10 passing unit tests plus the intentionally skipped unconfigured integration test; expanded persisted integration test passed separately on a fresh isolated database using dummy credentials and no provider network calls; Python 5/5; syntax check 38 JS files; frontend lint/build pass. The live demo database still has 0 users/orders/payment/shipment fixtures, 5 categories and 14 products.

### 2026-10-12 - Expanded persistent commerce integration coverage

- Extended `core-backend/test/integration/commerce.e2e.test.js` with invalid/duplicate registration, ignored self-assigned admin role, wrong-password and tampered-token rejection, required authentication, admin route authorization, locked-account rejection, and cross-customer order privacy checks.
- Created the separate local schema `giftly_verification_test`; migrations 000–009 and `seed:demo` completed there, and the expanded integration suite passed (1 test, 0 failures, 0 skips). The suite cleaned its users, orders, payment/shipment attempts, cart/address/event/notification fixtures; the isolated schema is retained and empty rather than dropped.
- Rechecked development data read-only: 5 categories, 14 products, 0 users/orders/payment attempts/shipments; existing 10 product events were left untouched. MySQL and Redis health endpoints remain healthy.
- This adds durable auth/authorization assertions to the existing COD/VNPAY/GHN integration scenarios. Real provider credentials, broader browser workflow coverage, and trained-model evaluation remain outstanding.
- Added Playwright browser flows using Microsoft Edge. `npm.cmd run test:e2e` starts Express against `giftly_verification_test` plus Vite, then covers guest catalog/cart and a signed-in COD checkout through UI, including order detail. The test cancels its order and removes its isolated fixture user; it does not connect the frontend test backend to `gift_ecommerce`.
- Added the admin browser workflow: register an isolated account, promote it with the bootstrap CLI, log in, read the live dashboard, adjust a product's inventory in the UI, confirm the ledger reason/delta, and reverse the adjustment. The cleanup helper removes only matching E2E user rows, their audit entries and inventory ledger entries, and refuses non-test schemas or uncancelled orders. All 3 browser scenarios passed twice; the test schema returned to 0 users/orders/carts/addresses/inventory movements/admin audit rows and seeded stock total 234.
- Extended browser verification to order operations: a customer fixture places a COD order, an admin opens order detail and advances PENDING → CONFIRMED → PROCESSING → CANCELLED through the order table; the customer API confirms cancellation and inventory restoration. All four browser scenarios passed together in two consecutive suite runs. The fixture cleanup also deletes only cancelled unpaid test orders and associated histories.
- Updated the storefront footer so it no longer incorrectly says payment and delivery providers are completely unintegrated; availability depends on store configuration.
- Added a two-customer simultaneous checkout test with exactly one unit in stock. It first exposed an InnoDB deadlock: a `SELECT ... FOR UPDATE` gap lock on a missing idempotency key conflicted with the product stock lock. The idempotency lookup is now a plain read; the unique index and duplicate-key recovery still protect retries. The API returns one 201 and one 409, never oversells, and cancellation restores stock. The integration suite passed three consecutive runs after this fix.
- Added a fifth Playwright browser scenario for admin customer management: lock/unlock through `/admin/customers`, verify an existing customer JWT is rejected while locked and accepted again after unlock, then clean both isolated accounts and their audit rows.
- Reverification after adding customer-status coverage: all 5 Playwright scenarios passed; the persistent API integration suite passed 1/1; backend unit tests passed 10 with 1 DB-dependent test skipped; Python tests passed 5/5; frontend lint and production build passed; `node --check` passed for backend JavaScript files and `git diff --check` reported no whitespace errors. Both test web servers stopped after the run.
- Post-test read-only database check: `gift_ecommerce` remains at 0 users, 0 orders, 14 products, 5 categories, 10 product events, 6 inventory movements, 29 admin audit rows, 0 shipments and stock total 232. `giftly_verification_test` has 0 fixture users/orders, 14 seeded products, 5 categories, and stock total 234; fixture cart/address/ledger/audit/shipment rows are empty.
- Added a browser workflow for internal shipment tracking: the admin moves a test COD order to PROCESSING, records carrier/tracking details through the order UI, and the customer sees the shipment history on the order page. The unpaid fixture order is cancelled before cleanup; no live GHN request is made.
- The first combined run exposed two test-only issues: the lock test checked before its PATCH completed, and cumulative browser logins hit the backend's real per-IP login throttle. The test now awaits the status response and authenticates admin UI sessions from the API-issued test JWT; the customer-facing login flow remains exercised. All 6 Playwright scenarios then passed together.
- Added a VNPAY browser checkout scenario using dummy credentials scoped to the Playwright backend process and an intercepted sandbox page. It verifies the storefront creates the order and signed payment attempt, redirects to the sandbox URL, and leaves payment UNPAID until a real signed callback; no external payment or development secret was used.
- Final browser run: 7/7 scenarios passed in one suite, covering guest cart, COD checkout, VNPAY initiation/redirect, admin inventory, order transitions, customer lock/unlock and shipment tracking visibility.
- Security audit found that the GHN webhook compared `String(event.ShopID)` with `String(config.shopId)` even when the configured shop ID was absent; a missing callback field could therefore match the literal `undefined` in a misconfigured deployment. The endpoint now rejects requests unless both shop ID and webhook secret are configured, and the API integration test verifies that a correctly shared-secret callback is still rejected when the shop ID is missing.
- After the webhook hardening, backend unit tests passed (10 passed, 1 isolated-database test skipped), the persistent API integration test passed (1/1), frontend lint/build passed, and all 7 Playwright scenarios passed together. Read-only database verification confirmed test fixtures are empty and development rows remain unchanged.
- Read-only live audit confirmed the development schema contains `product_images`, `shipments`, `payment_attempts`, `orders.shipping_method`, `orders.tracking_number`, and `shipments.client_order_code`; `product_images` has 0 rows. The existing ordered/idempotent migration runner has no separate migration-history ledger, so schema presence was checked directly rather than inferring `007` from filenames.
- Started the existing backend against the configured development DB only for health verification: MySQL health returned `result: 1`, Redis returned `PONG`; stopped the process after the checks. VNPAY/GHN configuration booleans are false in the local environment, so no external provider call was attempted.
- Started the FastAPI service with Uvicorn on loopback and verified `/health`, `/model`, `/recommendations`, and `/similar` over HTTP. Recommendations returned only the active, in-stock, within-budget matching item; similar products excluded the target; malformed product input returned HTTP 422. `/model` reports `trained: false`, matching the content/rules baseline and available data.
- Improved login throttling: successful authentication responses release their reserved per-IP slot, while failed attempts still accumulate to the 10-attempt/15-minute limit and receive `Retry-After` when blocked. Added focused unit tests for successful-login release and failed-login blocking. Full backend unit suite now reports 12 passed, 1 database-dependent test skipped; isolated integration and all 7 browser scenarios pass.
- FastAPI runtime smoke verification passed for `/health`, `/model`, `/recommendations`, and `/similar`; candidates were filtered by status, stock and budget, and invalid product input returned 422. The service still reports `trained: false` because no real training/evaluation dataset exists.
- Added migration `010_address_administrative_scheme.sql`, conditionally and idempotently applied by the existing migration runner. Existing address rows default to the legacy format; the account form supports both legacy ward/district/province and new ward/province formats, and order snapshots preserve the selected format for GHN payload creation. `GHN_FROM_IS_NEW_ADDRESS` controls the sender format.
- Applied migrations twice on `gift_ecommerce` and `giftly_verification_test`; the account UI created a new-format destination, checkout stored that format on the order, legacy GHN payload compatibility remained covered by unit/integration tests, and all 7 browser scenarios passed. Live GHN calls remain unavailable without credentials; address names are free-text and need to match GHN master data.
- GHN config validation now requires sender district only when the sender uses the legacy scheme; the current ward/province scheme can omit it. Focused unit tests cover both cases.
- Final verification after address-model support: backend 14 unit tests passed with 1 DB-only skip, API integration passed 1/1, frontend lint/build passed, and 7/7 browser scenarios passed. Both schemas retained their prior data counts and have empty test fixtures.

### 2026-10-13 - Return workflow state and refund clarity

- Tightened return state transitions: a pending request can only be approved or rejected; only an approved request can be completed. Before this fix, the API allowed a pending request to move directly to `COMPLETED`.
- Completing an approved return restocks the order's items once and writes inventory ledger entries. The admin API explicitly returns `refundProcessed: false`; this application does not execute refunds for COD or VNPAY.
- Updated customer/admin copy so `COMPLETED` means returned goods were received and restocked, with any customer refund handled separately. This does not claim a refund was issued.
- Added the isolated MySQL integration case covering delivered COD return creation, rejection of pending-to-completed, approval, one-time restock, and explicit no-refund result. Fixture cleanup removes its return and audit records.
- Verification: backend unit tests 14 passed, 1 DB-dependent test skipped; isolated integration passed 1/1. Frontend lint and production build passed after the UI copy update.

### 2026-10-13 - Browser coverage for customer returns

- Added a Playwright workflow spanning customer checkout, admin delivery-state transitions, customer return submission, admin approval/completion, customer-visible status, and database-backed inventory restoration.
- The browser test checks that completion reports `restocked: true` and `refundProcessed: false`, then verifies the product's stock returns to its pre-checkout value.
- Hardened E2E fixture cleanup: a paid delivered fixture can be removed only when exactly one return is `COMPLETED` and every order-linked inventory product has net quantity delta zero. Cancelled unpaid fixtures remain supported; all other orders are refused.
- Verification: complete Playwright suite 8/8 passed; backend unit tests 14 passed and 1 DB-only test skipped; API integration 1/1 passed; frontend lint/build passed. Read-only DB audit confirmed `gift_ecommerce` unchanged (0 users/orders/returns, 29 audit rows, stock total 232) and `giftly_verification_test` clean (0 users/orders/returns, 0 audit rows, stock total 234).

### 2026-10-13 - Coupon checkout browser coverage

- Added an isolated Playwright flow that creates a one-use coupon through the admin interface, applies it in customer checkout, checks the recalculated nonzero quote, submits COD, and verifies the stored coupon code/discount/total and usage count through the API.
- Extended test-only coupon cleanup to require the exact `E2E-` plus 32-hex fixture format, confirm no coupon usage records remain, remove its audit/category rows, and run only in a `giftly_*_test` schema.
- Verification: all 9 Playwright scenarios passed together; backend unit tests 14 passed/1 DB-only skip. Focused coupon browser run also passed independently. After final helper edits: frontend lint/build passed and isolated API integration passed 1/1.

### 2026-10-25 - Khu vực 0b: Chuẩn hóa nhãn tiếng Việt & đối chiếu Enum Database
- Trước lần push đầu tiên phải quét bí mật (.env.example, e2e, playwright.config.js, URL chứa credential, chuỗi hex/base64 dài).
- Đã chuẩn hóa tập trung từ điển nhãn và helper định dạng tại `core-frontend/src/lib/labels.js`, kèm unit test độc lập `core-frontend/src/lib/labels.test.js` (9/9 passed).
- Đã thay thế toàn bộ hiển thị enum thô trên giao diện (Storefront, Account, Admin Dashboard, Admin Orders, Admin Products, Admin Inventory, Admin Returns, Admin Deletion Requests).
- Đã cập nhật locator trong test E2E `core-frontend/e2e/storefront.spec.js` đồng bộ với nhãn tiếng Việt mới.
- **Việc ghi nhận để làm sau:**
  1. KPI "Đã giao hàng" trên Admin Dashboard cần được tách lại khi hệ thống bổ sung trạng thái `COMPLETED` cho đơn hàng (thực hiện ở Giai đoạn 4).
  2. Quy tắc nhãn "Chờ thanh toán" cho đơn `PENDING` + `UNPAID` cần bổ sung phương thức `BANK_TRANSFER` khi tích hợp chuyển khoản VCB (thực hiện ở Giai đoạn 8).
