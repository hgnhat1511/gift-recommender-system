# Dùng dữ liệu archive cho Giftly

## Archive là gì

`D:\NAM4\DACN\archive` chứa các CSV REES46 theo tháng, từ 10/2019 đến 02/2020. Các trường `event_time`, `event_type`, `product_id`, `category_id`, `category_code`, `brand`, `price`, `user_id` và `user_session` phù hợp với pipeline event hiện có trong `ml-service/ml_pipeline`.

Đây là dữ liệu hành vi thương mại điện tử tổng quát. Nó không có nhãn dịp tặng, người nhận, ngân sách quà tặng hay ý định tặng quà. Vì vậy:

- Dùng archive làm benchmark offline cho candidate generation và ranking.
- Không nhập các dòng archive thành đơn hàng/sự kiện của khách Giftly.
- Không trộn `user_id` archive với ID tài khoản Giftly.
- Không thay catalog Giftly bằng catalog archive. Catalog archive chỉ chứa ID, category/brand và giá, không phải thông tin sản phẩm quà tặng dùng được cho cửa hàng.
- Không nhập chung Online Retail II UCI vào pipeline này; hai bộ có schema, ID và thời gian khác nhau.

## Trạng thái website hiện tại

- Ranker LC-1 đang là artifact serving đã đóng băng, dùng REES46 và ba tài khoản demo có liên kết `ml_user_id`.
- Khách Giftly thường được gợi ý dựa trên sự kiện Giftly, danh mục, dịp/người nhận/sở thích và fallback nội dung; tài khoản thường không được gán ID REES46.
- Gift Finder lọc trên sản phẩm Giftly còn bán và dùng content baseline/rule matching. Đây không phải kết quả LC-1.
- Script archive tạo artifact nghiên cứu riêng; artifact đó không được tự động đưa vào đường serving.

## Chuẩn bị và huấn luyện validation-only

Chạy từ PowerShell ở thư mục gốc `gift-recommender-system`:

```powershell
.\ml-service\.venv\Scripts\python.exe .\ml-service\scripts\prepare_archive_events.py --archive-dir D:\NAM4\DACN\archive
.\ml-service\.venv\Scripts\python.exe .\ml-service\scripts\train_archive_ranker.py --events .\ml-service\data\experiments\archive_sampled_events_10pct.parquet
```

Bước chuẩn bị đọc CSV theo từng khối, lấy mẫu xác định 10% người dùng với seed 42 và ghi Parquet cùng JSON provenance dưới `ml-service/data/experiments/`. Script huấn luyện ghi model và metrics dưới các thư mục `experiments/`; không ghi đè artifact serving LC-1.

`train_archive_ranker.py` chỉ tạo/đánh giá trên train và validation. Nó không chấm `test_1` hoặc `test_2`. Validation được dùng để chọn/early-stop model, nên kết quả validation là kết quả chọn mô hình, không phải ước lượng cuối cùng không thiên lệch.

## Khi nào mới đổi model đang phục vụ

Không chép `models/experiments/<run>/ranker_experiment.pkl` đè lên `models/ranker_best_model.pkl`. Trước khi thay LC-1 cần:

1. Đóng băng dữ liệu, feature schema và model version.
2. Xác minh candidate `ml_product_id` của sản phẩm đang bán tồn tại trong validation/candidate pool của artifact mới.
3. Kiểm tra tương thích model/encoder/feature columns với `RankerService` và đường fallback.
4. Đánh giá cuối trên holdout thời gian chưa dùng để chọn model, sau khi kế hoạch đánh giá được chốt.
5. Có đường rollback về LC-1 và báo rõ đây vẫn là benchmark e-commerce tổng quát, không phải bằng chứng riêng cho quà tặng.

Để chứng minh mô hình quà tặng, cần tích lũy tương tác thật trên catalog Giftly, bảo đảm đủ cỡ mẫu theo người dùng, rồi đánh giá theo thời gian trên các sản phẩm Giftly. Không tạo click/view giả từ archive.
