# Giftly — Hệ thống kinh doanh và gợi ý quà tặng

Giftly is a gift commerce project. The workspace contains React/Vite, Express 5, MySQL 8 and Redis. MySQL-backed features include registered-user and guest carts, accounts, catalog, checkout, inventory ledger, orders, reviews, returns, notifications and admin tools.

## Cấu trúc

- `core-frontend/`: React 19, Vite, React Router 7, Axios; trang cửa hàng, Gift Finder, tài khoản và admin.
- `core-backend/`: Express 5 API, `mysql2`, bcryptjs, JWT và Redis health check.
- `database/schema.sql`: schema nền ban đầu.
- `database/migrations/`: migration lặp an toàn cho tài khoản, nghiệp vụ cửa hàng và nội dung banner.
- `ml-service/`: thư mục service Python hiện chưa có code hoặc dependency.

## Chạy local

Yêu cầu Node.js 20+, npm, Docker Desktop/Compose. Tại thư mục dự án:

```powershell
docker compose up -d mysql-db redis-cache
docker ps
```

Compose dùng service `mysql-db`/`redis-cache`; tên container là `gift_mysql`/`gift_redis`. Không xóa volume để khởi động lại. Compose hiện chứa thông tin đăng nhập phát triển; không dùng cấu hình đó trong production.

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

Migration đã được chạy trên database phát triển hiện có và chạy lại an toàn. Nó không xóa bảng hoặc hàng. `seed:demo` thêm 5 danh mục và 14 sản phẩm ví dụ nếu chưa tồn tại; đây là catalog minh họa lưu trong MySQL, không phải tồn kho của cửa hàng thật. Có thể chạy seed nhiều lần.

Mở terminal khác:

```powershell
cd core-frontend
npm.cmd install
npm.cmd run dev
```

Frontend mặc định gọi `http://localhost:5000/api`. Có thể đặt `VITE_API_BASE_URL`; CORS backend dùng `CORS_ORIGIN` (danh sách origin phân tách dấu phẩy). Khi backend chạy trong cùng Docker network, dùng `mysql-db` và `redis-cache` thay cho `localhost`.

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
3. Gift Finder `/gift-finder`: xếp hạng sản phẩm đang bán theo tags thật trong catalog, ngân sách và sở thích; mỗi gợi ý nêu tiêu chí khớp. Lượt tìm và click từ Gift Finder được ghi thành sự kiện MySQL. Đây là content matching có thể giải thích, không phải mô hình AI đã huấn luyện hay cá nhân hóa.
4. Visitors can add items to a browser-local cart and review current catalog prices and stock. Signing in merges those rows into the account cart; checkout remains account-only. Addresses, favorites, orders and deletion requests require an account.
5. Checkout hiện chỉ có COD. Phí giao mặc định `SHIPPING_FEE=30000`; miễn phí từ `FREE_SHIPPING_MINIMUM=500000`. Đơn, chi tiết, lịch sử, coupon usage, thông báo và trừ kho được ghi trong transaction.
6. Khách tìm đơn theo mã/trạng thái, xem lịch sử vận chuyển nội bộ, mua lại bằng cách chép sản phẩm còn hoạt động/còn hàng vào giỏ, hủy đơn `PENDING`, gửi yêu cầu đổi trả sau `DELIVERED` và theo dõi phản hồi. Giá hiện tại được tính lại ở giỏ/checkout; tracking chưa truy vấn trực tiếp hãng vận chuyển.
7. `/admin`: dashboard có lọc ngày, catalog/danh mục, lịch sử điều chỉnh kho, đơn hàng lọc theo ngày/trạng thái/thanh toán, coupon, khách hàng/quyền, đổi trả và điều tiết đánh giá. Chuyển trạng thái đơn theo state machine; hủy đơn hoàn kho trong transaction. Hàng được nhập lại kho khi yêu cầu đổi trả chuyển sang `COMPLETED`. COD chỉ được ghi nhận đã thu khi admin chuyển đơn sang `DELIVERED`; hệ thống không chuyển tiền hoàn thật.

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

`npm.cmd run migrate` áp dụng toàn bộ file SQL có thứ tự trong `database/migrations/`; cột mở rộng được thêm sau khi kiểm tra `information_schema`. Các bảng mới gồm địa chỉ, giỏ, đơn, chi tiết/lịch sử trạng thái, lịch sử hãng/mã vận đơn (`order_shipping_history`), yêu cầu xóa tài khoản có audit (`account_deletion_requests`), banner (`homepage_banners`), coupon/lượt dùng, yêu thích, sự kiện, đánh giá, thông báo, nhật ký tồn kho, đổi trả và admin audit. Migration cũng bổ sung `shipping_carrier`, `tracking_number` và `cart_items.is_selected` cho dữ liệu cũ; các dòng giỏ đã có mặc định vẫn được chọn. Các hàng `users`, `categories`, `products` cũ được giữ nguyên.
`npm.cmd run migrate` áp dụng toàn bộ file SQL có thứ tự trong `database/migrations/`; cột mở rộng được thêm sau khi kiểm tra `information_schema`. Các bảng mới gồm địa chỉ, giỏ, đơn, chi tiết/lịch sử trạng thái, lịch sử hãng/mã vận đơn (`order_shipping_history`), yêu cầu xóa tài khoản có audit (`account_deletion_requests`), banner (`homepage_banners`), phạm vi coupon theo danh mục (`coupon_categories`), coupon/lượt dùng, yêu thích, sự kiện, đánh giá, thông báo, nhật ký tồn kho, đổi trả và admin audit. Migration cũng bổ sung `shipping_carrier`, `tracking_number` và `cart_items.is_selected` cho dữ liệu cũ; các dòng giỏ đã có mặc định vẫn được chọn. Các hàng `users`, `categories`, `products` và coupon hiện hữu được giữ nguyên.

`npm.cmd run seed:demo` thêm catalog minh họa. Không có tài khoản hay mật khẩu admin mặc định.

## Kiểm tra đã thực hiện

- `npm.cmd run migrate` chạy thành công nhiều lần trên MySQL đang dùng; migration giữ dữ liệu hiện có.
- `npm.cmd run seed:demo` chạy hai lần và vẫn chỉ có 5 danh mục/14 sản phẩm demo.
- Bộ integration trước đó trên MySQL/Redis: checkout/auth 48/48, tồn kho/đổi trả/dashboard 22/22, tracking/Gift Finder 6/6, coupon CRUD 6/6, review distribution 1/1, SQL injection qua tìm kiếm catalog 1/1. Các kiểm tra gồm role, giá/coupon server-side, idempotency, quyền đơn, state machine, review đã mua, nhập lại tồn kho và validation sự kiện.
- Luồng vận chuyển hiện tại: 14 assertion API/MySQL đạt: chỉ cho phép khi đơn đang xử lý/giao, cập nhật và sửa tracking, bỏ qua bản cập nhật trùng, lịch sử, thông báo, quyền xem và hoàn kho khi hủy.
- Tìm đơn/đổi trả: 7 assertion API/MySQL đạt: tìm theo mã cùng trạng thái, cách ly quyền xem, tạo/đọc yêu cầu, phản hồi admin và kiểm tra tồn kho.
- Mua lại: 7 assertion API/MySQL đạt: chặn đơn người khác, gộp giỏ, từ chối vượt tồn và giữ nguyên giỏ khi giao dịch bị từ chối.
- Yêu cầu xóa tài khoản: 11 assertion API/MySQL đạt cho xác thực lại mật khẩu, chặn yêu cầu trùng, phân quyền admin, trạng thái/phản hồi riêng tư và notification. Tài khoản không bị xóa tự động; fixture đã được dọn.
- Chọn dòng giỏ hàng: 13 assertion API/MySQL đạt cho validation/quyền chọn, subtotal/quote, checkout một phần, giữ hàng chưa chọn khi đặt/retry và stock chỉ trừ dòng đã mua. Fixture đã dọn, stock gốc khôi phục.
- Coupon theo danh mục: 20 assertion API/MySQL đạt cho xác thực category, phân quyền CRUD, minimum trên subtotal đủ điều kiện, quote và checkout theo giá server-side, hủy đơn hoàn lượt dùng/tồn kho. Fixture đã dọn.
- Banner trang chủ: 19 assertion API/MySQL đạt cho quyền customer/admin, URL an toàn, lịch hiển thị, CRUD, ẩn mềm và dữ liệu công khai. Tài khoản và banner fixture đã được dọn.
- Sau các thay đổi: `npm.cmd run lint`, `npm.cmd run build`, `node --check` các controller/route backend liên quan và chạy lại migration đều đạt. MySQL/Redis health check trả thành công.
- Fixture người dùng/đơn/banner/coupon của các lượt test đã được dọn; kiểm tra database xác nhận 0 fixture, giữ nguyên 5 danh mục/14 sản phẩm đang bán.

## Giới hạn đã biết

- Thanh toán chỉ COD; không có cổng thanh toán thật.
- Admin lưu hãng vận chuyển, mã vận đơn và lịch sử cập nhật trong Giftly; khách xem được trên chi tiết đơn và nhận thông báo trong app. Chưa kết nối API hãng vận chuyển nên không có tracking thời gian thực.
- Chưa cấu hình email provider: quên/đặt lại mật khẩu bị vô hiệu hóa, không tạo token giả.
- `ml-service/main.py`, `requirements.txt` và dữ liệu huấn luyện hiện rỗng; chưa có model FastAPI. Gift Finder hiện dùng content matching theo metadata catalog, không tuyên bố là AI đã huấn luyện.
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


## Activity based product recommendations

The homepage can request `GET /api/products/recommendations?limit=4` and renders the result when products are available. The route is public and accepts an optional Bearer token. The default limit is 8; accepted limits are 1 through 20.

A signed-in account receives `personalized_activity` when its recent product history matches available products. The baseline reads up to 300 product events from the last 180 days and up to 100 current favorites. It weights purchases (5), favorites (4), cart additions (3), recommendation clicks (2), and views (1), with a 90-day exponential decay. It compares category, occasion, recipient, interest, style, and gift-type attributes. Ranking also includes a small recent-popularity, rating, and featured-product score. Results require an active product with stock and omit products already in that account's cart or favorites. The response includes short explanation reasons for each product.

Visitors and accounts without a matching activity profile receive `popular_cold_start`, which ranks currently available products using the same small popularity/rating/featured baseline. Homepage recommendation-card clicks are stored as `RECOMMENDATION_CLICK` product events. This is a deterministic Node.js baseline over catalog attributes and interaction history; it is not a trained machine-learning model. The Python recommendation service/model is still pending, and no AI accuracy claim is made.

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

Checkout now supports STANDARD and EXPRESS delivery selections. The quote API returns both configured fees and the fee for the selected option; order creation recalculates the quote in its transaction and stores the selected method on the order. STANDARD uses SHIPPING_FEE (default 30000 VND) and can become free when the discounted subtotal reaches FREE_SHIPPING_MINIMUM (default 500000 VND). EXPRESS uses EXPRESS_SHIPPING_FEE (default 50000 VND) and is not covered by the standard free-shipping threshold. The backend keeps COD as the only payment method.

Send shippingMethod as STANDARD or EXPRESS to POST /api/orders/quote and POST /api/orders; omitting the field defaults to STANDARD for existing clients. The quote response returns shippingOptions and the selected fee. The database migration runner conditionally adds orders.shipping_method with STANDARD as its default, preserving existing orders. Run npm.cmd run migrate in core-backend to apply it. Both shipping choices and their prices are a demo estimate; Giftly does not submit bookings to a carrier and shipment tracking remains an internal admin update.


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
