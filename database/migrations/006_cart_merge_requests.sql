USE gift_ecommerce;

-- Records successful guest-cart merges so retrying after a lost response cannot add quantities twice.
CREATE TABLE IF NOT EXISTS cart_merge_requests (
    user_id BIGINT UNSIGNED NOT NULL,
    merge_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, merge_key),
    CONSTRAINT fk_cart_merge_request_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
