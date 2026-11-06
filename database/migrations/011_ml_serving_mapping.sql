-- Migration 011: Thêm cột ánh xạ phục vụ mô hình học máy (ML Serving Mapping)
-- BƯỚC 3: Giữ nguyên khóa chính (id) của bảng hiện có, thêm cột phụ nullable có unique constraint.

ALTER TABLE users ADD COLUMN ml_user_id BIGINT UNSIGNED NULL UNIQUE;
ALTER TABLE products ADD COLUMN ml_product_id BIGINT UNSIGNED NULL UNIQUE;
ALTER TABLE products ADD COLUMN is_synthetic_display BOOLEAN NOT NULL DEFAULT FALSE;
