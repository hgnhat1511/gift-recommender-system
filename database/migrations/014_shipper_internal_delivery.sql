ALTER TABLE users
    MODIFY COLUMN role ENUM('USER', 'STAFF', 'ADMIN', 'SHIPPER') NOT NULL DEFAULT 'USER';

ALTER TABLE orders
    ADD COLUMN shipper_user_id BIGINT UNSIGNED NULL,
    ADD KEY idx_orders_shipper_status (shipper_user_id, status),
    ADD CONSTRAINT fk_orders_shipper_user
        FOREIGN KEY (shipper_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE shipments
    MODIFY COLUMN provider ENUM('GHN', 'INTERNAL') NOT NULL;

ALTER TABLE order_status_history
    ADD COLUMN source ENUM('ADMIN', 'CUSTOMER', 'GHN', 'INTERNAL', 'SYSTEM') NOT NULL DEFAULT 'SYSTEM';

CREATE TABLE IF NOT EXISTS delivery_proofs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    file_name VARCHAR(80) NOT NULL,
    mime_type VARCHAR(30) NOT NULL,
    sha256 CHAR(64) NOT NULL,
    uploaded_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_delivery_proof_order (order_id),
    CONSTRAINT fk_delivery_proof_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_delivery_proof_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
