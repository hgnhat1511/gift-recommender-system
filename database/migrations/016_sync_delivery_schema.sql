-- Repair delivery schema drift after migrations 013 and 014
-- Each ALTER is prepared only when the target column is missing

SET @giftly_016_sql = IF(
    EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'delivered_at'
    ),
    'SELECT 1',
    'ALTER TABLE orders ADD COLUMN delivered_at DATETIME NULL'
);
PREPARE giftly_016_stmt FROM @giftly_016_sql;
EXECUTE giftly_016_stmt;
DEALLOCATE PREPARE giftly_016_stmt;

-- Backfill only missing delivery timestamps using the earliest DELIVERED history event
UPDATE orders o
JOIN (
    SELECT order_id, MIN(created_at) AS delivered_at
    FROM order_status_history
    WHERE to_status = 'DELIVERED'
    GROUP BY order_id
) h ON h.order_id = o.id
SET o.delivered_at = h.delivered_at
WHERE o.status = 'DELIVERED' AND o.delivered_at IS NULL;

SET @giftly_016_sql = IF(
    EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'received_confirmed_at'
    ),
    'SELECT 1',
    'ALTER TABLE orders ADD COLUMN received_confirmed_at DATETIME NULL'
);
PREPARE giftly_016_stmt FROM @giftly_016_sql;
EXECUTE giftly_016_stmt;
DEALLOCATE PREPARE giftly_016_stmt;

SET @giftly_016_sql = IF(
    EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_status_history' AND COLUMN_NAME = 'source'
    ),
    'SELECT 1',
    'ALTER TABLE order_status_history ADD COLUMN source ENUM(''ADMIN'', ''CUSTOMER'', ''GHN'', ''INTERNAL'', ''SYSTEM'') NOT NULL DEFAULT ''SYSTEM'''
);
PREPARE giftly_016_stmt FROM @giftly_016_sql;
EXECUTE giftly_016_stmt;
DEALLOCATE PREPARE giftly_016_stmt;

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

-- Refuse to narrow provider if any value would be converted or discarded
SET @giftly_016_invalid_provider = EXISTS (
    SELECT 1 FROM shipments
    WHERE provider IS NULL
       OR CAST(provider AS BINARY) NOT IN (CAST('GHN' AS BINARY), CAST('INTERNAL' AS BINARY))
);

SET @giftly_016_sql = IF(
    @giftly_016_invalid_provider,
    'SELECT * FROM __giftly_016_provider_values_require_manual_review__',
    IF(
        EXISTS (
            SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'shipments'
              AND COLUMN_NAME = 'provider'
              AND DATA_TYPE = 'enum'
              AND COLUMN_TYPE = 'enum(''GHN'',''INTERNAL'')'
              AND IS_NULLABLE = 'NO'
        ),
        'SELECT 1',
        'ALTER TABLE shipments MODIFY COLUMN provider ENUM(''GHN'', ''INTERNAL'') NOT NULL'
    )
);
PREPARE giftly_016_stmt FROM @giftly_016_sql;
EXECUTE giftly_016_stmt;
DEALLOCATE PREPARE giftly_016_stmt;
