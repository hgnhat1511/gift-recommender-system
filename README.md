# Giftly — Phát triển hệ thống đề xuất sản phẩm dựa trên học máy trong ngách quà tặng

> ⚡ **Bạn muốn chạy ngay dự án bằng Docker? Xem hướng dẫn tại [QUICKSTART.md](QUICKSTART.md) (Chỉ 2 bước với Docker Compose).**

## Định hướng đồ án

Đề tài chính của Giftly là **phát triển và đánh giá hệ thống đề xuất sản phẩm dựa trên học máy cho sản phẩm quà tặng**. Website bán hàng là lớp ứng dụng để quản lý catalog, thu thập tín hiệu xem/giỏ hàng/đặt mua và trình bày gợi ý; thanh toán, vận chuyển và admin là nghiệp vụ hỗ trợ, không phải đóng góp nghiên cứu chính.

Trạng thái cần phân biệt rõ:

- **Đã có mô hình học máy:** Ranker LightGBM LC-1 được huấn luyện và đánh giá offline trên dữ liệu REES46 eCommerce tổng quát.
- **Đã có tích hợp demo:** backend có thể gọi model service và hiển thị nguồn/phần giải thích cho các hồ sơ demo được ánh xạ.
- **Chưa chứng minh là mô hình quà tặng đã hoàn chỉnh:** dữ liệu train không phải dữ liệu Giftly; chưa có đánh giá offline trên tập quà tặng riêng, và hành vi của khách Giftly chưa được dùng để huấn luyện/retrain LC-1. Gift Finder hiện lọc ứng viên theo dịp, người nhận, ngân sách và thuộc tính rồi xếp hạng bằng content baseline/rule fallback.

Vì vậy, các chỉ số LC-1 trong tài liệu là kết quả trên REES46, không phải bằng chứng hiệu năng trên người dùng hoặc sản phẩm Giftly. Lộ trình nghiên cứu tiếp theo là chuẩn hóa sự kiện Giftly, xây dựng tập dữ liệu gắn nhãn phù hợp với quà tặng, so sánh baseline với mô hình học máy, rồi đánh giá trên tập test tách theo thời gian.

Giftly is a gift commerce project. The workspace contains React/Vite, Express 5, MySQL 8 and Redis. MySQL-backed features include registered-user and guest carts, accounts, catalog, checkout, inventory ledger, orders, reviews, returns, notifications and admin tools.

## Cấu trúc

- `core-frontend/`: React 19, Vite, React Router 7, Axios; trang cửa hàng, Gift Finder, tài khoản và admin.
- `core-backend/`: Express 5 API, `mysql2`, bcryptjs, JWT và Redis health check.
- `database/schema.sql`: schema nền ban đầu.
- `database/migrations/`: migration lặp an toàn, gồm khởi tạo schema nền, nghiệp vụ cửa hàng, thanh toán và vận chuyển.
- `ml-service/`: FastAPI serving cho LightGBM Ranker LC-1 đã huấn luyện trên REES46 và các endpoint baseline nội dung/popularity; phạm vi dữ liệu và giới hạn miền quà tặng được ghi ở phần đề tài.
- Quy trình sử dụng dữ liệu `D:\NAM4\DACN\archive` cho benchmark offline, không trộn ID/catalog và không chấm test tự động: [docs/ML_ARCHIVE_WORKFLOW.md](docs/ML_ARCHIVE_WORKFLOW.md).

## Chạy local

Yêu cầu Node.js 20+, npm, Docker Desktop/Compose. Compose chạy đủ MySQL, Redis, ML service, backend và frontend. Để chạy stack cô lập phục vụ demo/test, đặt mật khẩu và cổng riêng trong PowerShell trước khi khởi động:

```powershell
$env:MYSQL_ROOT_PASSWORD = node -p "require('node:crypto').randomBytes(48).toString('base64url')"
$env:JWT_SECRET = node -p "require('node:crypto').randomBytes(48).toString('base64url')"
$env:DB_NAME = 'giftly_e2e_test'
$env:MYSQL_HOST_PORT = '13306'
$env:REDIS_HOST_PORT = '16379'
$env:ML_HOST_PORT = '18000'
$env:BACKEND_HOST_PORT = '15000'
$env:FRONTEND_HOST_PORT = '13000'
$composeProject = "giftly_clean_$((Get-Date).ToString('yyyyMMdd_HHmmss'))"
$env:CORS_ORIGIN = "http://localhost:$env:FRONTEND_HOST_PORT"
docker compose -p $composeProject up --build -d
docker compose -p $composeProject ps
```

Use a new Compose project name to get fresh named volumes. Do not reuse a previous project when a clean database is required. Select free host ports. Keep generated secrets in environment variables only. Set DB_NAME=giftly_e2e_test before migrations or tests that write data; do not use gift_ecommerce or giftly_verification_test. Stop with docker compose -p $composeProject down to preserve volumes; do not use down -v.

Prepare the schema and catalog in the MySQL container from core-backend. resetTestDb accepts only an isolated database ending in _test.

```powershell
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = $env:MYSQL_HOST_PORT
$env:DB_USER = 'root'
$env:DB_PASSWORD = $env:MYSQL_ROOT_PASSWORD
$env:TEST_DB_NAME = 'giftly_e2e_test'
node scripts/resetTestDb.js giftly_e2e_test --seed-demo
$env:DEMO_USER_PASSWORD = node -p "require('node:crypto').randomBytes(32).toString('base64url')"
node scripts/importReesCatalog.js --apply
```

Do not print the demo password or commit it; keep it in the process environment when logging into a fixture account.

Tạo `core-backend/.env` từ `.env.example`, đặt host `localhost` khi Node chạy ngoài Docker, rồi tạo JWT secret cục bộ:

```powershell
node -e "require('node:crypto').randomBytes(48).toString('base64url')" | Set-Clipboard
```

Dán chuỗi vào `JWT_SECRET` trong `.env`. Secret cần ít nhất 32 byte. Không commit `.env`. Các file `.env` đã được ignore.

```powershell
cd core-backend
npm.cmd install
npm.cmd run migrate
npm.cmd run seed:demo
npm.cmd run dev
```

Migration `000_base_catalog.sql` tạo các bảng nền `users`, `categories`, `products` nếu chưa có; các migration tiếp theo tạo phần nghiệp vụ. Vì vậy cùng lệnh này chạy được trên database mới lẫn database đã có dữ liệu. Runner dùng database được chọn bởi `DB_NAME` và bỏ qua các `USE gift_ecommerce` cũ trong file migration để không chuyển nhầm schema. Migration không xóa bảng hoặc hàng. `seed:demo` thêm 5 danh mục và 14 sản phẩm ví dụ nếu chưa tồn tại; đây là catalog minh họa lưu trong MySQL, không phải tồn kho của cửa hàng thật. Có thể chạy seed nhiều lần.

Mở terminal khác:

```powershell
cd core-frontend
npm.cmd install
npm.cmd run dev
```

Frontend mặc định gọi `http://localhost:5000/api`. Nếu cổng `5173` đang bận, Vite tự chọn cổng kế tiếp (ví dụ `5174`); backend cho phép origin loopback ở chế độ development để lần chạy đó vẫn gọi API được. Trong production, backend chỉ cho phép origin liệt kê trong `CORS_ORIGIN` (danh sách origin phân tách dấu phẩy). Có thể đặt `VITE_API_BASE_URL` nếu backend dùng cổng khác. Khi backend chạy trong cùng Docker network, dùng `mysql-db` và `redis-cache` thay cho `localhost`.

Kiểm tra service:

- `GET http://localhost:5000/`
- `GET http://localhost:5000/api/health/mysql`
- `GET http://localhost:5000/api/health/redis`

## Tài khoản admin

Không có admin mặc định. Đăng ký tài khoản của bạn qua `/register`, sau đó cấp quyền thủ công từ máy phát triển có quyền cập nhật DB:

```powershell
cd core-backend
npm.cmd run admin:promote -- ten-cua-ban@example.com
```

Lệnh chỉ nâng vai trò tài khoản đang hoạt động có email trùng khớp, ghi audit log và không đặt mật khẩu. Đăng nhập lại để frontend nhận vai trò mới. Backend vẫn tự kiểm tra role cho mọi `/api/admin/*`.

## Luồng website hiện có

1. Trang chủ lấy danh mục, số sản phẩm, sản phẩm nổi bật, mới nhất và mức tương tác từ catalog MySQL. Catalog `/products` có phân trang; tìm theo tên/mô tả/danh mục; lọc danh mục, khoảng giá, dịp, người nhận, sở thích, phong cách, loại quà và tồn kho; sắp xếp mới, giá, mức tương tác hoặc đánh giá.
2. Chi tiết `/products/:id`: trạng thái tồn kho, đánh giá đã duyệt và sản phẩm liên quan.
3. Gift Finder `/gift-finder`: lọc sản phẩm đang bán theo dịp, người nhận, ngân sách và metadata quà tặng; Python content baseline có thể xếp hạng lại ứng viên, còn Node rule matching là fallback. Mỗi gợi ý nêu tiêu chí khớp; lượt tìm và click được ghi vào MySQL. Đây là baseline nội dung có thể giải thích, chưa phải LC-1 và chưa cá nhân hóa theo lịch sử từng người.
4. Khách vãng lai có giỏ cục bộ; đăng nhập sẽ gộp giỏ vào tài khoản. Checkout, địa chỉ, yêu thích và đơn hàng yêu cầu đăng nhập.
5. Checkout hỗ trợ COD và VNPAY sandbox khi có merchant credentials. Với VNPAY, đơn được tạo ở trạng thái chưa thanh toán cùng `payment_attempt` PENDING; IPN hợp lệ mới đánh dấu PAID. Hủy thanh toán làm attempt EXPIRED; callback muộn được đưa REVIEW theo logic hiện hành. Phí giao mặc định `SHIPPING_FEE=30000`; miễn phí từ `FREE_SHIPPING_MINIMUM=500000`.
6. Vận chuyển có hai nguồn loại trừ nhau: GHN (trạng thái SHIPPED/DELIVERED đến từ webhook có chữ ký) hoặc giao nội bộ (đơn gán shipper). COD chuyển PAID khi DELIVERED. Khách xác nhận đã nhận hàng hoặc được coi là đã nhận sau `RETURN_WINDOW_DAYS` (mặc định 7 ngày); thời hạn đổi trả tính từ `delivered_at`. Ảnh chỉ đính kèm yêu cầu đổi trả, không tự cập nhật trạng thái giao hàng.
7. `/admin`: quản lý catalog, tồn kho, đơn, coupon, khách hàng/quyền, đổi trả và đánh giá. Admin không có lối tắt đặt trạng thái SHIPPED/DELIVERED; GHN webhook hoặc shipper của đơn INTERNAL thực hiện chuyển trạng thái tương ứng. Duyệt đổi trả không tự hoàn tiền.

JWT lưu ở session storage mặc định hoặc local storage nếu chọn ghi nhớ. Đây là phương án demo; production nên triển khai cookie `HttpOnly`, CSP và cấu hình HTTPS. Logout xóa token ở trình duyệt; JWT phát hành không bị thu hồi và có hiệu lực tới khi hết hạn (mặc định 1 giờ). Đổi mật khẩu cũng không thu hồi JWT cũ.

## API chính

Tất cả payload/response là JSON. Không kết nối frontend trực tiếp tới database.

| Method | Endpoint | Quyền | Công dụng |
|---|---|---|---|
| POST | `/api/auth/register` | Công khai | Tạo tài khoản USER |
| POST | `/api/auth/login` | Công khai | Đăng nhập và nhận JWT |
| GET | `/api/auth/me` | Đăng nhập | Đọc tài khoản hiện tại |
| POST | `/api/auth/logout` | Đăng nhập | Báo logout stateless |
| GET | `/api/products` | Công khai | Catalog có lọc/phân trang; query `q`, `page`, `limit`, `category`, `minPrice`, `maxPrice`, `occasion`, `recipient`, `interest`, `style`, `giftType`, `inStock`, `sort` |
| GET | `/api/products/categories` | Công khai | Danh mục đang hoạt động |
| GET | `/api/products/lookup?ids=1,2` | Public | Read up to 50 current active products for a guest cart; does not record a product view |
| GET | `/api/products/banners` | Công khai | Banner đang hoạt động trong khung thời gian UTC |
| GET | `/api/products/:id` | Công khai | Chi tiết và sản phẩm cùng danh mục |
| POST | `/api/products/gift-finder` | Công khai | So khớp dịp/người nhận/ngân sách/sở thích |
| GET/POST | `/api/cart` và `/api/cart/items` | Đăng nhập | Đọc/xóa giỏ; thêm, sửa số lượng, xóa từng sản phẩm |
| POST | `/api/cart/merge` | Signed in | Merge guest rows in a transaction, validate stock, and make retries idempotent |
| PATCH | `/api/cart/items/:itemId/selection` | Chủ giỏ | Chọn/bỏ chọn dòng; checkout chỉ lấy dòng đã chọn |
| GET/PATCH | `/api/account/profile` | Đăng nhập | Đọc/cập nhật tên và số điện thoại |
| GET/POST | `/api/account/deletion-request` | Đăng nhập + mật khẩu hiện tại khi gửi | Tạo/xem yêu cầu xóa có trạng thái; không xóa tự động |
| GET/POST/PUT/DELETE | `/api/account/addresses` | Đăng nhập | CRUD địa chỉ và chọn địa chỉ mặc định |
| GET | `/api/account/favorites` | Đăng nhập | Danh sách yêu thích |
| PUT | `/api/account/favorites/:productId` | Đăng nhập | Toggle yêu thích |
| POST | `/api/orders/quote` | Đăng nhập | Tính lại coupon, phí giao và tổng tiền; trả subtotal đủ điều kiện khi coupon giới hạn danh mục |
| POST | `/api/orders` | Đăng nhập | Tạo đơn COD bằng transaction; gửi `Idempotency-Key` để chống tạo trùng khi retry |
| GET | `/api/orders` | Đăng nhập | Lịch sử đơn, lọc trạng thái/mã đơn |
| GET | `/api/orders/:id` | Đăng nhập | Xem chi tiết đơn của chính chủ |
| POST | `/api/orders/:id/cancel` | Chủ đơn | Hủy đơn `PENDING` |
| POST | `/api/orders/:id/reorder` | Chủ đơn | Chép sản phẩm còn hoạt động vào giỏ trong transaction, kiểm tra tồn kho và số lượng giỏ hiện có |
| GET/POST | `/api/orders/:id/returns` | Chủ đơn | Xem/gửi yêu cầu đổi trả sau khi giao |
| POST | `/api/products/events` | Công khai/đăng nhập | Ghi sự kiện tìm kiếm và tương tác catalog; context có giới hạn kích thước |
| GET/POST | `/api/products/:id/reviews` | Công khai/đăng nhập | Đọc đánh giá đã duyệt; gửi đánh giá khi có đơn giao thành công |
| PUT/DELETE | `/api/reviews/:id` | Chủ đánh giá | Sửa hoặc xóa đánh giá của chính mình |
| POST | `/api/admin/products/:id/inventory` | ADMIN | Điều chỉnh tồn kho có lý do, ghi audit và ledger |
| PATCH | `/api/admin/orders/:id/shipping` | ADMIN | Lưu hãng vận chuyển, mã vận đơn, lịch sử, audit và thông báo trong app (chỉ khi PROCESSING/SHIPPED) |
| GET | `/api/admin/inventory` | ADMIN | Lịch sử nhập/xuất/điều chỉnh tồn kho |
| GET/POST | `/api/admin/banners` | ADMIN | Liệt kê và tạo banner trang chủ |
| PUT/DELETE | `/api/admin/banners/:id` | ADMIN | Cập nhật hoặc ẩn banner (không xóa lịch sử) |
| GET/POST | `/api/admin/coupons` | ADMIN | Liệt kê/tạo coupon, có thể giới hạn danh mục |
| PUT/DELETE | `/api/admin/coupons/:id` | ADMIN | Cập nhật phạm vi coupon hoặc khóa mã |
| GET/POST/PATCH | `/api/admin/*` | ADMIN | Dashboard, catalog, đơn, coupon, khách, đổi trả, đánh giá và vận hành |

Ví dụ đặt hàng:

```json
POST /api/orders
Authorization: Bearer <token>
{"addressId":"12","couponCode":"GIFT10","note":"Gọi trước khi giao","paymentMethod":"COD"}
```

Khi gửi `POST /api/orders`, có thể thêm header `Idempotency-Key: checkout-<uuid>`. Dùng lại cùng key cho lần retry sẽ trả lại đơn đã tạo, tránh trừ tồn kho hoặc ghi nhận coupon lần hai.

Thử toàn bộ API bằng Postman/Hoppscotch. Không chia sẻ JWT thật. Đơn hàng luôn gắn với `user_id` từ JWT, không lấy ID khách từ request body.

## Migration và dữ liệu

`npm.cmd run migrate` áp dụng các migration có thứ tự trong `database/migrations/`. Runner bỏ qua migration đã ghi nhận; không chạy lệnh này trên DB dùng chung nếu chưa xác định rõ `DB_NAME`. `npm.cmd run seed:demo` thêm catalog minh họa 5 danh mục và 14 sản phẩm nếu chưa tồn tại. Không có tài khoản hay mật khẩu admin mặc định.

## Kiểm tra đã thực hiện

Verification snapshot (2026-11-11): backend suite 151 tests, 151 pass, 0 fail, 0 skipped on giftly_e2e_test; frontend unit 24 pass; lint and build pass; Playwright 28/28 pass. Local CORS preflight from `http://localhost:5174` to backend port 5000 returned 204 with the matching allow-origin header. Docker project giftly_clean_20261111 ran all 5 services on a separate giftly_e2e_test database, applied all 16 migrations and seeded demo fixtures. REES46 demo login through the container backend returned source=ranker_lc1 with 8 recommendations; ML /health and frontend HTTP checks returned healthy/200. Host ports 3000, 5000 and 3306 were occupied, so this run used ports 3001, 5002 and 13307 (plus 16380 and 8001). The project was stopped with docker compose down, without -v; its named volumes remain.

Lượt backend đầu tiên khi chưa nạp fixture demo có test đỏ; chạy lại sau khi nạp fixture bằng `--seed-demo` đạt kết quả nêu trên, không sửa assertion. Các trang tải theo route để giảm JavaScript ban đầu; build hiện không còn cảnh báo chunk vượt ngưỡng 500 kB.

## Giới hạn đã biết

- VNPAY và GHN phụ thuộc cấu hình merchant/sandbox; cần webhook GHN hợp lệ mới cập nhật đơn GHN. Không coi thử nghiệm local là xác nhận tích hợp production.
- GHN webhook và shipper nội bộ là hai nguồn trạng thái tách biệt; ứng dụng demo không có đối soát vận chuyển thực tế.
- Chưa cấu hình email provider: quên/đặt lại mật khẩu bị vô hiệu hóa, không tạo token giả.
- `ml-service`: Mô hình xếp hạng Ranker LC-1 (LightGBM) đã được huấn luyện trên tập dữ liệu REES46 eCommerce events, đạt Validation NDCG@10 = 0.085476 (+37,04% so với baseline 0.062373); kết quả đánh giá chính thức trên hai tập test độc lập: `test_1` đạt NDCG@10 = 0.071261 (+27,77%, 95% CI: [+0.013188, +0.018063]) và `test_2` đạt NDCG@10 = 0.070601 (+32,79%, 95% CI: [+0.015119, +0.019819]). Mô hình đã được đóng băng cố định tại `ml-service/models/ranker_best_model.pkl` (SHA-256: `1d11488782894eae3b4eb142943303f4c9e85d0784f800047396d4f444eea8ff`). Mô hình được phục vụ online qua FastAPI endpoint `POST /recommend/rank` và `GET /health` (container `gift_ml_service`). Tuy nhiên, cá nhân hóa hiện tại chỉ áp dụng cho 3 tài khoản demo có `ml_user_id` liên kết REES46; khách vãng lai và tài khoản khác dùng fallback an toàn. Gift Finder hiện dùng content matching theo metadata catalog.
- Bộ Docker Compose gồm 5 dịch vụ đã được chạy kiểm tra trong project cô lập `giftly_clean`; dữ liệu nằm trong named volume riêng. Khi dùng trên máy khác cần đặt `MYSQL_ROOT_PASSWORD`, `JWT_SECRET`, `DB_NAME` và chọn cổng phù hợp.
- Catalog demo dùng ảnh URL HTTPS bên ngoài; chưa có upload ảnh hoặc CMS cho nội dung tĩnh. Banner trang chủ được quản lý từ admin.
- Guest cart rows in localStorage contain only product IDs, quantities and selection state. Prices and stock come from the catalog API and are revalidated in MySQL during merge. A conflict returns HTTP 409 and leaves the guest cart available for correction.
- Trang chi tiết đơn có bản in từ snapshot đã lưu và có thể lưu PDF qua trình duyệt; chưa sinh PDF riêng ở server. Chưa có biến thể sản phẩm hoặc upload ảnh.
- Return `COMPLETED` nhập lại hàng và ghi ledger; không thực hiện hoàn tiền vì chưa tích hợp cổng thanh toán.
- Dashboard hiển thị danh mục và sản phẩm bán chạy dựa trên đơn không bị hủy; danh mục lấy từ liên kết sản phẩm hiện tại, chưa phải snapshot danh mục lúc mua.
- Có thể gửi yêu cầu xóa tài khoản sau khi xác nhận mật khẩu; admin rà soát và ghi phản hồi. Hệ thống chưa xóa/ẩn danh tự động vì chưa cấu hình chính sách lưu trữ; đơn hàng được giữ nguyên.
- Rate limit login lưu trong bộ nhớ một tiến trình, cần Redis/shared limiter nếu chạy nhiều instance.

Xem `PROGRESS.md` để biết ma trận audit và công việc còn lại.

## Bản in tóm tắt đơn hàng

Trong trang chi tiết đơn của khách hàng, nút **In / lưu bản tóm tắt** mở hộp thoại in của trình duyệt. Bản in dùng snapshot đơn hàng đã lưu trong MySQL (sản phẩm, số lượng, đơn giá, người nhận, địa chỉ, trạng thái và tổng tiền); có thể chọn máy in hoặc lưu thành PDF từ trình duyệt. Đây là bản tóm tắt thương mại, không phải hóa đơn thuế. Chức năng này chỉ hiển thị dữ liệu đơn của tài khoản đã đăng nhập.

## Banner trang chủ

Admin quản lý banner tại `/admin/banners`. Migration `004_homepage_banners.sql` tạo bảng nội dung có trạng thái, thứ tự và khoảng hiển thị. Ảnh và liên kết bên ngoài phải dùng HTTPS; đường dẫn tương đối trong cùng website cũng được chấp nhận. Banner bị ẩn vẫn nằm trong database để có thể chỉnh sửa hoặc bật lại. API công khai chỉ trả banner đang hoạt động theo giờ UTC; không có ảnh mặc định giả trong carousel khi danh sách rỗng.

## Coupon theo danh mục

Trong `/admin/coupons`, có thể chọn một hoặc nhiều danh mục. Không chọn danh mục thì coupon tiếp tục áp dụng toàn bộ sản phẩm như trước. Với coupon có giới hạn, backend chỉ giảm trên sản phẩm thuộc danh mục được chọn và so mức tối thiểu với subtotal đủ điều kiện; quote và checkout cùng dùng logic này trong MySQL. Ngày bắt đầu/kết thúc được nhập theo giờ địa phương của MySQL để tương thích các coupon hiện có.


## Activity based product recommendations & ML Ranker LC-1

Trang chủ gửi request `GET /api/products/recommendations?limit=8` và render kết quả gợi ý. Route này công khai và chấp nhận Bearer token tùy chọn (hỗ trợ limit từ 1 đến 20).

### Cơ chế phục vụ gợi ý:
1. **Tài khoản Demo REES46 (có `ml_user_id`):**
   - Backend gọi trực tiếp FastAPI endpoint `POST /recommend/rank` tại `ml-service` (cổng 8000).
   - Mô hình học máy LightGBM Ranker LC-1 (đã đóng băng) chấm điểm và xếp hạng thời gian thực dựa trên 31 đặc trưng (ItemKNN, TF-IDF, Popularity, lịch sử người dùng và mức tương thích).
   - Response trả về nhãn `source: "ranker_lc1"` kèm các lý do gợi ý minh bạch (ví dụ: "Gợi ý từ tương quan ItemKNN", "Bạn đã từng thêm vào giỏ hàng", "Tương tác gần đây").
2. **Khách vãng lai và Tài khoản thường (chưa có `ml_user_id`):**
   - Hệ thống tự động kích hoạt bộ lọc bảo vệ: chỉ lấy 14 sản phẩm thật trong catalog, loại bỏ hoàn toàn 188 sản phẩm synthetic (`is_synthetic_display = TRUE`).
   - Gợi ý chuyển sang fallback an toàn (`source: "python_content_baseline"` hoặc `"node_fallback"`) dựa trên mức độ quan tâm gần đây và thuộc tính danh mục quà tặng.

### Giới hạn kỹ thuật và phạm vi nghiên cứu hiện tại
- **Lệch miền dữ liệu:** Bộ đặc trưng và ma trận ItemKNN được huấn luyện trên snapshot REES46 eCommerce (tháng 01/2020), là dữ liệu bán lẻ tổng quát chứ không phải dữ liệu hành vi tặng quà Giftly. Các chỉ số NDCG đã nêu chỉ áp dụng cho các tập REES46 tương ứng.
- **Phạm vi cá nhân hóa LC-1:** Chỉ các tài khoản demo được liên kết `ml_user_id` sang REES46 mới có thể đi qua nhánh warm-user của Ranker LC-1. Khách thông thường dùng fallback trên tín hiệu và metadata Giftly; chưa có bằng chứng cá nhân hóa học máy trên người dùng thật của Giftly.
- **Sản phẩm tổng hợp:** 188 sản phẩm REES46 hiển thị là dữ liệu tổng hợp (`is_synthetic_display = TRUE`) nhằm mục đích demo xếp hạng mô hình; ảnh sản phẩm lấy từ Unsplash cần được rà soát giấy phép bản quyền trước khi đưa vào kinh doanh thương mại.
- **Chưa có vòng lặp học từ Giftly:** Sự kiện Giftly được lưu cho tín hiệu gợi ý hiện thời, nhưng chưa có pipeline xuất dữ liệu, huấn luyện/retrain LC-1 trên dữ liệu Giftly, kiểm định chất lượng dữ liệu và triển khai model mới có versioning.
- **Trạng thái Docker:** `docker compose` hiện chỉ chạy `ml-service` (`gift_ml_service`), `mysql-db` (`gift_mysql`) và `redis-cache` (`gift_redis`). `core-backend` và `core-frontend` vẫn chạy trực tiếp bằng Node.js ngoài Docker.

Example response shape:

```json
{
  "success": true,
  "data": {
    "method": "personalized_activity",
    "total": 1,
    "items": [
      {
        "id": "42",
        "name": "Example catalog item",
        "stock": 3,
        "reasons": ["Matched a category you viewed"]
      }
    ]
  }
}
```


## Delivery options in demo checkout

Checkout now supports STANDARD and EXPRESS delivery selections. The quote API returns both configured fees and the fee for the selected option; order creation recalculates the quote in its transaction and stores the selected method on the order. STANDARD uses SHIPPING_FEE (default 30000 VND) and can become free when the discounted subtotal reaches FREE_SHIPPING_MINIMUM (default 500000 VND). EXPRESS uses EXPRESS_SHIPPING_FEE (default 50000 VND) and is not covered by the standard free-shipping threshold. COD remains available; VNPAY sandbox checkout is implemented and appears only when its server credentials are configured.

Send shippingMethod as STANDARD or EXPRESS to POST /api/orders/quote and POST /api/orders; omitting the field defaults to STANDARD for existing clients. The quote response returns shippingOptions and the selected fee. The database migration runner conditionally adds orders.shipping_method with STANDARD as its default, preserving existing orders. Run npm.cmd run migrate in core-backend to apply it. STANDARD/EXPRESS pricing remains a demo estimate. An optional GHN adapter and shared-secret shipment status webhook are implemented; live carrier requests require provider credentials and address data.


## Customer review history

The signed-in account page lists a customer's own reviews with product/order context and pagination. GET /api/account/reviews accepts page and limit (1-50); it never returns other users' reviews. The account screen can edit or delete an owned review through PUT or DELETE /api/reviews/:id. Editing a review hides it from the public product list until an admin reviews it again. Review creation still requires a delivered order containing that product. No schema migration is needed.


## Guest cart

The storefront lets visitors add products to a local browser cart and view it without signing in. The browser stores only product IDs, quantities (1-99), and selection flags; it never stores authoritative prices. `GET /api/products/lookup?ids=...` returns current active catalog details without recording a VIEW event. A visitor must sign in before checkout.

After login, the frontend sends the saved rows to `POST /api/cart/merge`. MySQL validates product status, available stock, the existing account-cart quantity and selection, then commits all rows together. A stock conflict returns HTTP 409 and leaves guest data in the browser so the visitor can edit it and retry. Successful merge keys are stored in `cart_merge_requests`; if a response is lost, retrying the same key does not add quantities twice. Apply migration `006_cart_merge_requests.sql` using `npm.cmd run migrate`.

Example request:

```json
POST /api/cart/merge
Authorization: Bearer <token>
{"mergeKey":"guest-cart-unique-key","items":[{"productId":"13","quantity":1,"selected":true}]}
```

A merge is all-or-nothing. If a product became inactive or the account cart plus guest quantity exceeds current stock, correct or remove the guest row and retry. Authentication token storage follows the existing session/local storage choice; local cart data is not a secure storage boundary and should not contain personal or payment data.

## Product image gallery

Product detail pages show the main product image followed by up to eight additional images. Admins manage the extra image URLs in the product form, one URL per line. Gallery URLs must use HTTPS; the main image keeps its existing URL handling and is limited to 500 characters to match the database column. Duplicate URLs and repeating the main image as an extra image are rejected. The gallery is stored in `product_images`, with a product foreign key and a stable display order; deleting a product cascades to its gallery rows. This iteration accepts hosted image URLs and does not provide file uploads.

Apply the additive migration with `cd core-backend; npm.cmd run migrate`. It creates `product_images` with `CREATE TABLE IF NOT EXISTS` and preserves existing product rows. `GET /api/products/:id` returns `product.images` in display order, including the main image first; admin product list/create/update responses include `galleryImages`. If database connectivity is unavailable, the migration and API integration need to be rerun after MySQL is started.


## Payment, carrier and Python recommendation integration (status 2026-10-12)

VNPAY uses its sandbox URL and stays unavailable until `VNPAY_TMN_CODE` and `VNPAY_HASH_SECRET` are configured in `core-backend/.env`. The signed IPN endpoint is authoritative for payment state; the browser return only redirects to the order page and never marks an order paid. Configure the provider IPN URL as `https://<public-backend-host>/api/payments/vnpay/ipn` and return URL as `/api/payments/vnpay/return`; the provider must be able to reach the IPN endpoint. See [VNPAY payment API docs](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html).

Payment endpoints:

- `GET /api/payments/methods` returns enabled payment methods.
- `POST /api/payments/orders/:orderId/vnpay` requires the order owner and starts or resumes a pending payment.
- `GET /api/payments/vnpay/ipn` validates signature, amount, currency and order eligibility before updating MySQL.
- `GET /api/payments/vnpay/return` validates and redirects the browser; it does not confirm payment.

GHN is optional and remains disabled until staging credentials, sender address and a webhook secret are configured. An admin can create a shipment for an eligible order with `POST /api/admin/orders/:orderId/shipments/ghn`, passing `weightGrams`, `lengthCm`, `widthCm` and `heightCm`. GHN status callbacks use `POST /api/shipments/ghn/webhook`; configure the `x-giftly-shipping-secret` header and expected Shop ID. Creation uses the order code as the provider idempotency code. Webhook events are deduplicated and a state machine rejects older or backward state changes. Saved addresses now persist whether they use the current ward/province scheme or the legacy ward/district/province scheme; migration 010 defaults existing rows to the legacy format. Enter administrative names exactly as GHN expects—Giftly does not yet offer GHN catalog-backed address selectors. Checkout delivery prices remain local estimates, not GHN quotes. See the [GHN API docs](https://developer.ghn.dev/en/docs) and [webhook docs](https://developer.ghn.dev/en/docs/webhook/callback-order-status).

For a disposable test database, set `NODE_ENV=test`, `DB_NAME=giftly_e2e_test` and `TEST_DB_NAME=giftly_e2e_test`, then run `node scripts/resetTestDb.js giftly_e2e_test --seed-demo` from `core-backend`. This recreates only an `_test` database, applies every migration, imports the committed 1,000-product catalog and rule_v1 tags, and generates simulated test transactions. It reads repository data files and does not copy data from `gift_ecommerce`.

For local GHN state-flow demos only, start the backend with `DB_NAME=giftly_e2e_test` and `TEST_DB_NAME=giftly_e2e_test`, and set `GHN_SHOP_ID` and `GHN_WEBHOOK_SECRET` in `core-backend/.env`. Create a GHN shipment for the demo order, then run from `core-backend`:

```powershell
node scripts/devGhnDeliver.js <giftly-order-code> <ghn-order-code>
```

The script sends local `delivering` and `delivered` webhook events using the configured shared secret. It refuses production, any database other than `giftly_e2e_test`, and non-local API URLs. It does not contact GHN. The database check applies to the script environment; start the local backend with the same DB variables.

To create a development shipper account, set `DB_NAME` and `TEST_DB_NAME` to `giftly_e2e_test`, and set `SHIPPER_NAME`, `SHIPPER_EMAIL`, and `SHIPPER_PASSWORD` in the process environment. Run `npm.cmd run shipper:create:dev` from `core-backend`. The script checks the connected database before writing and refuses production or any database other than `giftly_e2e_test`; it creates or updates only a SHIPPER account. Keep the password out of Git and documentation.

The Python service provides `/health`, `/model`, `/recommend/rank`, `/recommendations`, `/gift-finder` and `/similar`. `/recommend/rank` serves the frozen LightGBM LC-1 model for compatible REES46 IDs; `/recommendations` and `/gift-finder` are content/rule baselines, not the trained ranker. Express validates returned product IDs and falls back to Node ranking if Python is unavailable. Gift Finder filters candidates against Giftly's real, sellable catalog before the Python content baseline can reorder them. LC-1's offline metrics are from REES46; Giftly-domain evaluation and retraining remain open work. Start the service from `ml-service`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

Set `ML_SERVICE_URL=http://127.0.0.1:8000`; `ML_SERVICE_TIMEOUT_MS` bounds backend requests. No model training, offline evaluation, production credentials or live provider sandbox transaction is included.

Migrations `008_payments_and_shipments.sql` and `009_shipment_client_order_code.sql` add payment attempts, shipments and event history while preserving orders. Run `cd core-backend; npm.cmd run migrate`; it is safe to rerun. Existing product and user data are not reset.

Historical verification entry from an earlier implementation; its development-database migration evidence and test totals are not the current verification snapshot. See the latest snapshot above and docs/GIFTLY_FINAL_REPORT.md.

The current Playwright config uses the isolated giftly_e2e_test database by default and refuses other database names in its DB-writing setup. Set PLAYWRIGHT_DB_NAME only to giftly_e2e_test. The suite runs with one worker and exercises checkout, payment callbacks, inventory, roles, delivery, returns and responsive storefront layouts.

The optional customer API integration test requires a **separate, empty MySQL test database** whose name matches `giftly_*_test`. Create that schema, then from `core-backend` set both `DB_NAME` and `TEST_DB_NAME` to its name, run `npm.cmd run migrate` and `npm.cmd run seed:demo`, and then `npm.cmd run test:integration`. The test refuses databases with existing users or orders; never point it at `gift_ecommerce` or production data. It uses dummy in-process VNPAY/GHN credentials and makes no external provider calls. It exercises registration/JWT (including duplicate/invalid input, role escalation, locked accounts and route authorization), cross-customer order privacy, Gift Finder fallback, cart/quote, idempotent COD checkout, VNPAY initiation/IPN/return/failure/replay and late callback, customer/admin cancellation guards for paid orders, GHN webhook authentication/deduplication/state progression, and inventory restoration. It removes all test fixtures but leaves the isolated schema intact.

Historical verification note only: giftly_verification_test was used by earlier work. Current test and Docker instructions use giftly_e2e_test; do not target giftly_verification_test or gift_ecommerce for current tests/migrations.

The integration suite also submits two separate customer checkouts concurrently while only one test unit is available. It verifies one order succeeds, the other receives HTTP 409, inventory never drops below zero, and cancellation restores the reservation. The checkout's idempotency lookup is a non-locking read to avoid an InnoDB gap-lock deadlock; the unique key and duplicate-key recovery still make same-key retries idempotent.

The browser suite also exercises customer administration: an admin locks a customer in the UI, the customer's already-issued JWT is rejected by `/api/auth/me`, and unlocking restores access for that token. The fixture helper removes both isolated accounts and their admin audit rows.

Latest local verification is recorded in PROGRESS.md and docs/GIFTLY_FINAL_REPORT.md; older dated verification notes below are historical and do not describe the current delivery contract.

Current delivery behavior: admin assigns an internal shipper or creates a GHN shipment; internal shipper transitions are limited to assigned INTERNAL orders, while GHN webhook controls GHN orders. Admin cannot enter arbitrary carrier/tracking data or manually set SHIPPED/DELIVERED. The customer sees tracking history generated by the selected source.

The VNPAY browser scenario uses explicit dummy credentials only in the Playwright Express process and intercepts the sandbox page in the browser. It verifies checkout selection, signed payment URL creation and redirection, then confirms the order remains UNPAID because no provider callback was received. This is not a real VNPAY transaction and does not alter development credentials.

Historical migration record: migration 010 was tested in an earlier phase. Do not repeat those development/verification database writes; current schema verification and tests target only giftly_e2e_test.

### Return and refund behavior

A delivered order can have one return request. Admin decisions follow `PENDING -> APPROVED/REJECTED -> COMPLETED`; completion records receipt of returned goods and restocks the order quantities once. It does not issue money to the customer. The return decision API reports `refundProcessed: false`; refunds for both COD and VNPAY must be handled separately until a refund integration is implemented.
