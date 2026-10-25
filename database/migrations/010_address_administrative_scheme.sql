ALTER TABLE addresses
    ADD COLUMN is_new_administrative_address BOOLEAN NOT NULL DEFAULT FALSE;
