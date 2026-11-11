ALTER TABLE orders ADD COLUMN delivered_at DATETIME NULL;
ALTER TABLE orders ADD COLUMN received_confirmed_at DATETIME NULL;

UPDATE orders o
JOIN (
    SELECT order_id, MIN(created_at) AS delivered_at
    FROM order_status_history
    WHERE to_status = 'DELIVERED'
    GROUP BY order_id
) h ON h.order_id = o.id
SET o.delivered_at = h.delivered_at
WHERE o.status = 'DELIVERED' AND o.delivered_at IS NULL;
