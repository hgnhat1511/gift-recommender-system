require('dotenv').config();
const pool = require('../config/db');

async function cleanupFixture(email) {
    if (!/^e2e-[a-z0-9-]+@example\.invalid$/i.test(email || '')) {
        throw new Error('Refusing to clean a non-E2E fixture email.');
    }
    const connection = await pool.getConnection();
    try {
        const [[database]] = await connection.query('SELECT DATABASE() name');
        if (!/^giftly_[a-z0-9_]*_test$/i.test(database.name || '')) {
            throw new Error('Refusing to clean fixtures outside a dedicated Giftly test database.');
        }
        const [[user]] = await connection.execute('SELECT id FROM users WHERE email=? LIMIT 1', [email]);
        if (!user) return;
        const [orders] = await connection.execute('SELECT id,status,payment_status FROM orders WHERE user_id=?', [user.id]);
        for (const order of orders) {
            if (order.status === 'CANCELLED' && order.payment_status === 'UNPAID') continue;
            if (order.status === 'DELIVERED' && order.payment_status === 'PAID') {
                const [returns] = await connection.execute('SELECT status FROM return_requests WHERE order_id=?', [order.id]);
                const [unbalancedStock] = await connection.execute(`SELECT product_id FROM inventory_movements
                    WHERE order_id=? GROUP BY product_id HAVING SUM(quantity_delta)<>0 LIMIT 1`, [order.id]);
                if (returns.length === 1 && returns[0].status === 'COMPLETED' && unbalancedStock.length === 0) continue;
            }
            throw new Error('Refusing to delete a fixture order unless it is cancelled unpaid or fully returned with neutral inventory.');
        }

        await connection.beginTransaction();
        for (const order of orders) {
            const [returns] = await connection.execute('SELECT id FROM return_requests WHERE order_id=?', [order.id]);
            for (const request of returns) {
                await connection.execute("DELETE FROM admin_audit_logs WHERE entity_type='return' AND entity_id=?", [request.id]);
            }
            const [orderReviews] = await connection.execute('SELECT id FROM reviews WHERE order_id=?', [order.id]);
            for (const review of orderReviews) {
                await connection.execute("DELETE FROM admin_audit_logs WHERE entity_type='review' AND entity_id=?", [review.id]);
            }
            await connection.execute('DELETE FROM reviews WHERE order_id=?', [order.id]);
            await connection.execute("DELETE FROM admin_audit_logs WHERE entity_type='order' AND entity_id=?", [order.id]);
            for (const [table, column] of [
                ['order_items', 'order_id'], ['order_status_history', 'order_id'], ['order_shipping_history', 'order_id'],
                ['inventory_movements', 'order_id'], ['notifications', 'order_id'], ['coupon_uses', 'order_id'],
                ['return_requests', 'order_id']
            ]) await connection.execute(`DELETE FROM ${table} WHERE ${column}=?`, [order.id]);
            await connection.execute('DELETE FROM payment_attempts WHERE order_id=?', [order.id]);
            await connection.execute('DELETE FROM shipments WHERE order_id=?', [order.id]);
            await connection.execute('DELETE FROM orders WHERE id=?', [order.id]);
        }
        for (const [table, column] of [
            ['cart_items', 'user_id'], ['product_events', 'user_id'], ['favorites', 'user_id'], ['addresses', 'user_id'],
            ['notifications', 'user_id'], ['cart_merge_requests', 'user_id'], ['account_deletion_requests', 'user_id'],
            ['reviews', 'user_id']
        ]) await connection.execute(`DELETE FROM ${table} WHERE ${column}=?`, [user.id]);
        await connection.execute('DELETE FROM inventory_movements WHERE changed_by=?', [user.id]);
        await connection.execute('DELETE FROM admin_audit_logs WHERE admin_id=?', [user.id]);
        await connection.execute('DELETE FROM users WHERE id=?', [user.id]);
        await connection.commit();
        console.log('Removed the isolated Playwright customer fixture.');
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        connection.release();
    }
}

async function cleanupCoupon(code) {
    if (!/^E2E-[A-F0-9]{32}$/.test(code || '')) {
        throw new Error('Refusing to clean a coupon without an exact E2E fixture code.');
    }
    const connection = await pool.getConnection();
    try {
        const [[database]] = await connection.query('SELECT DATABASE() name');
        if (!/^giftly_[a-z0-9_]*_test$/i.test(database.name || '')) {
            throw new Error('Refusing to clean fixtures outside a dedicated Giftly test database.');
        }
        const [[coupon]] = await connection.execute('SELECT id FROM coupons WHERE code=? LIMIT 1', [code]);
        if (!coupon) return;
        const [[usage]] = await connection.execute('SELECT COUNT(*) total FROM coupon_uses WHERE coupon_id=?', [coupon.id]);
        if (Number(usage.total) !== 0) {
            throw new Error('Refusing to delete a coupon that still has order usage records.');
        }
        await connection.beginTransaction();
        await connection.execute("DELETE FROM admin_audit_logs WHERE entity_type='coupon' AND entity_id=?", [coupon.id]);
        await connection.execute('DELETE FROM coupon_categories WHERE coupon_id=?', [coupon.id]);
        await connection.execute('DELETE FROM coupons WHERE id=?', [coupon.id]);
        await connection.commit();
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        connection.release();
    }
}

async function cleanup() {
    try {
        await cleanupFixture(process.argv[2]);
        if (process.argv[3]) await cleanupCoupon(process.argv[3]);
    } finally {
        await pool.end();
    }
}

cleanup().catch((error) => {
    console.error('E2E fixture cleanup failed:', error.message || error.code || 'unexpected error');
    process.exitCode = 1;
});
