-- 017_add_momo_payment_method.sql
-- Add MOMO to orders.payment_method enum
ALTER TABLE orders MODIFY payment_method ENUM('COD','VNPAY','MOMO') NOT NULL DEFAULT 'COD';
