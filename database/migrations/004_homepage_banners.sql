CREATE TABLE IF NOT EXISTS homepage_banners (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    title VARCHAR(120) NOT NULL,
    subtitle VARCHAR(300) NULL,
    image_url VARCHAR(2048) NOT NULL,
    target_url VARCHAR(2048) NULL,
    button_text VARCHAR(40) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    starts_at DATETIME NULL,
    ends_at DATETIME NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_homepage_banners_active_order (is_active, sort_order, starts_at, ends_at),
    CONSTRAINT fk_homepage_banners_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
