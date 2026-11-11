const pool = require('../config/db');

async function assignInternalShipper(req, res, next) {
    const orderId = String(req.params.orderId || '');
    const shipperUserId = String(req.body?.shipperUserId || '');
    if (!/^\d{1,20}$/.test(orderId) || !/^\d{1,20}$/.test(shipperUserId)) {
        return res.status(400).json({ success: false, message: 'Cần mã đơn và tài khoản shipper hợp lệ.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [[order]] = await connection.execute(`SELECT id,order_code,status,payment_method,payment_status,
            shipper_user_id FROM orders WHERE id=? FOR UPDATE`, [orderId]);
        if (!order) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng.' }); }
        const [[shipper]] = await connection.execute("SELECT id FROM users WHERE id=? AND role='SHIPPER' AND status='ACTIVE' FOR UPDATE", [shipperUserId]);
        if (!shipper) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Tài khoản shipper không tồn tại hoặc đang bị khóa.' }); }
        if (order.status !== 'PROCESSING') {
            await connection.rollback(); return res.status(409).json({ success: false, message: 'Chỉ gán shipper cho đơn đang chuẩn bị.' });
        }
        if (order.payment_method === 'VNPAY' && order.payment_status !== 'PAID') {
            await connection.rollback(); return res.status(409).json({ success: false, message: 'Đơn VNPAY chưa thanh toán.' });
        }
        const [[existing]] = await connection.execute('SELECT id,provider FROM shipments WHERE order_id=? FOR UPDATE', [order.id]);
        if (existing) {
            if (existing.provider !== 'INTERNAL') {
                await connection.rollback(); return res.status(409).json({ success: false, message: 'Đơn hàng đã có nguồn vận chuyển khác.' });
            }
            if (String(order.shipper_user_id || '') === shipperUserId) {
                await connection.commit(); return res.json({ success: true, data: { assigned: true, unchanged: true, provider: 'INTERNAL' } });
            }
            await connection.execute('UPDATE orders SET shipper_user_id=? WHERE id=?', [shipperUserId, order.id]);
            await connection.execute("INSERT INTO order_shipping_history (order_id,changed_by,carrier,tracking_number,note) VALUES (?,?, 'Giftly', ?, 'Đã cập nhật phân công shipper nội bộ')", [order.id, req.user.id, order.order_code]);
            await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,CAST(? AS JSON))',
                [req.user.id, 'SHIPPER_REASSIGN', 'order', order.id, JSON.stringify({ previousShipperId: order.shipper_user_id == null ? null : String(order.shipper_user_id), shipperId: shipperUserId, source: 'INTERNAL' })]);
            await connection.commit();
            return res.json({ success: true, data: { assigned: true, reassigned: true, provider: 'INTERNAL', shipperUserId } });
        }

        await connection.execute("UPDATE orders SET shipper_user_id=?,shipping_carrier='Giftly',tracking_number=order_code WHERE id=?", [shipperUserId, order.id]);
        await connection.execute("INSERT INTO shipments (order_id,client_order_code,provider,status) VALUES (?,?,'INTERNAL','CREATED')", [order.id, order.order_code]);
        await connection.execute("INSERT INTO order_shipping_history (order_id,changed_by,carrier,tracking_number,note) VALUES (?,?, 'Giftly', ?, 'Đã gán shipper nội bộ')", [order.id, req.user.id, order.order_code]);
        await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,CAST(? AS JSON))',
            [req.user.id, 'SHIPPER_ASSIGN', 'order', order.id, JSON.stringify({ shipperId: shipperUserId, source: 'INTERNAL' })]);
        await connection.execute("INSERT INTO notifications (user_id,type,title,body,order_id) SELECT user_id,'SHIPPING',?,?,id FROM orders WHERE id=?",
            [`Đơn ${order.order_code} đã được phân công giao`, 'Đơn hàng đã được phân công cho nhân viên giao hàng.', order.id]);
        await connection.commit();
        return res.status(201).json({ success: true, data: { assigned: true, provider: 'INTERNAL', shipperUserId } });
    } catch (error) {
        await connection.rollback(); return next(error);
    } finally { connection.release(); }
}

module.exports = { assignInternalShipper };
