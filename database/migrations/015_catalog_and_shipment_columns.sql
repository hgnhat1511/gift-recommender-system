ALTER TABLE categories
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN sort_order INT NOT NULL DEFAULT 0;

ALTER TABLE products
    ADD COLUMN occasion_tags JSON NULL,
    ADD COLUMN recipient_tags JSON NULL,
    ADD COLUMN interest_tags JSON NULL,
    ADD COLUMN style VARCHAR(80) NULL,
    ADD COLUMN gift_type VARCHAR(80) NULL,
    ADD COLUMN is_featured BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE shipments
    ADD COLUMN client_order_code VARCHAR(50) NULL AFTER order_id,
    ADD UNIQUE KEY uq_shipment_client_code (provider, client_order_code);
