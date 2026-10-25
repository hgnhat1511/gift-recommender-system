USE gift_ecommerce;

ALTER TABLE orders MODIFY payment_method ENUM('COD','VNPAY') NOT NULL DEFAULT 'COD';

CREATE TABLE IF NOT EXISTS payment_attempts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    provider VARCHAR(24) NOT NULL,
    reference VARCHAR(100) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'VND',
    status ENUM('PENDING','SUCCEEDED','FAILED','EXPIRED','REVIEW') NOT NULL DEFAULT 'PENDING',
    provider_transaction_id VARCHAR(100) NULL,
    provider_response_code VARCHAR(20) NULL,
    expires_at DATETIME NOT NULL,
    confirmed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_payment_reference (provider,reference),
    UNIQUE KEY uq_payment_provider_transaction (provider,provider_transaction_id),
    KEY idx_payment_order_status (order_id,status,created_at),
    CONSTRAINT fk_payment_attempt_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS shipments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    provider VARCHAR(32) NOT NULL,
    provider_order_code VARCHAR(100) NULL,
    tracking_number VARCHAR(100) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    estimated_delivery_at DATETIME NULL,
    last_event_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_shipment_provider_code (provider,provider_order_code),
    UNIQUE KEY uq_shipment_order_provider (order_id,provider),
    KEY idx_shipments_order (order_id,created_at),
    KEY idx_shipments_status (status,updated_at),
    CONSTRAINT fk_shipment_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS shipment_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    shipment_id BIGINT UNSIGNED NOT NULL,
    provider_event_key VARCHAR(190) NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    provider_status VARCHAR(80) NULL,
    normalized_status VARCHAR(32) NOT NULL,
    occurred_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_shipment_event_key (shipment_id,provider_event_key),
    KEY idx_shipment_event_order (shipment_id,occurred_at),
    CONSTRAINT fk_shipment_event_shipment FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
