-- 012_simulation_flags.sql
-- Bổ sung cờ is_simulated cho bảng orders và product_events để phân biệt dữ liệu mô phỏng

ALTER TABLE orders ADD COLUMN is_simulated TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE product_events ADD COLUMN is_simulated TINYINT(1) NOT NULL DEFAULT 0;
