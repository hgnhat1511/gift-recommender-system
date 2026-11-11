const pool = require('../config/db');

function validId(value) {
    return /^\d{1,20}$/.test(String(value || ''));
}

async function listOrders(req, res, next) {
    try {
        const [rows] = await pool.execute(`SELECT o.id,o.order_code,o.status,o.payment_method,o.payment_status,
            o.recipient_name,o.phone,o.shipping_address,o.shipping_carrier,o.tracking_number,o.total_amount,
            o.created_at,o.delivered_at,s.provider
            FROM orders o JOIN shipments s ON s.order_id=o.id AND s.provider='INTERNAL'
            WHERE o.shipper_user_id=? AND o.status IN ('PROCESSING','SHIPPED')
            ORDER BY o.created_at DESC,o.id DESC LIMIT 200`, [req.user.id]);
        return res.json({ success: true, data: rows.map((row) => ({
            id: String(row.id), orderCode: row.order_code, status: row.status,
            paymentMethod: row.payment_method, paymentStatus: row.payment_status,
            recipientName: row.recipient_name, phone: row.phone,
            shippingAddress: typeof row.shipping_address === 'string' ? JSON.parse(row.shipping_address) : row.shipping_address,
            shippingCarrier: row.shipping_carrier, trackingNumber: row.tracking_number,
            total: Number(row.total_amount), createdAt: row.created_at, deliveredAt: row.delivered_at,
            provider: row.provider,
        })) });
    } catch (error) { return next(error); }
}

async function dispatchOrder(req, res, next) {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Mã đơn hàng không hợp lệ.' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [[order]] = await connection.execute(`SELECT o.id,o.user_id,o.order_code,o.status,o.payment_method,
            o.payment_status,o.shipper_user_id,s.provider FROM orders o
            LEFT JOIN shipments s ON s.order_id=o.id WHERE o.id=? FOR UPDATE`, [req.params.id]);
        if (!order) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng.' }); }
        if (String(order.shipper_user_id) !== String(req.user.id) || order.provider !== 'INTERNAL') {
            await connection.rollback(); return res.status(403).json({ success: false, message: 'Đơn hàng không được giao cho tài khoản shipper này.' });
        }
        if (order.payment_method === 'VNPAY' && order.payment_status !== 'PAID') {
            await connection.rollback(); return res.status(409).json({ success: false, message: 'Đơn VNPAY chưa được xác nhận thanh toán.' });
        }
        if (order.status !== 'PROCESSING') {
            await connection.rollback(); return res.status(409).json({ success: false, message: 'Chỉ bắt đầu giao khi đơn đang chuẩn bị.' });
        }
        await connection.execute("UPDATE orders SET status='SHIPPED' WHERE id=?", [order.id]);
        await connection.execute("UPDATE shipments SET status='OUT_FOR_DELIVERY',last_event_at=NOW() WHERE order_id=? AND provider='INTERNAL'", [order.id]);
        await connection.execute(`INSERT INTO order_status_history (order_id,changed_by,from_status,to_status,note,source)
            VALUES (?,?, 'PROCESSING','SHIPPED','Shipper bắt đầu giao đơn nội bộ','INTERNAL')`, [order.id, req.user.id]);
        await connection.execute("INSERT INTO notifications (user_id,type,title,body,order_id) VALUES (?,'SHIPPING',?,?,?)",
            [order.user_id, `Đơn ${order.order_code} đang được giao`, 'Shipper đã bắt đầu giao đơn hàng.', order.id]);
        await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (NULL,?,?,?,CAST(? AS JSON))',
            ['SHIPPER_DISPATCH', 'order', order.id, JSON.stringify({ shipperId: String(req.user.id), source: 'INTERNAL' })]);
        await connection.commit();
        return res.json({ success: true, data: { status: 'SHIPPED' } });
    } catch (error) { await connection.rollback(); return next(error); }
    finally { connection.release(); }
}

async function deliverOrder(req, res, next) {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Mã đơn hàng không hợp lệ.' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [[order]] = await connection.execute(`SELECT o.id,o.user_id,o.order_code,o.status,o.payment_method,
            o.payment_status,o.shipper_user_id,s.provider FROM orders o
            LEFT JOIN shipments s ON s.order_id=o.id WHERE o.id=? FOR UPDATE`, [req.params.id]);
        if (!order) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng.' }); }
        if (String(order.shipper_user_id) !== String(req.user.id) || order.provider !== 'INTERNAL') {
            await connection.rollback(); return res.status(403).json({ success: false, message: 'Đơn hàng không được giao cho tài khoản shipper này.' });
        }
        if (order.status === 'DELIVERED') {
            await connection.commit(); return res.json({ success: true, data: { status: 'DELIVERED', unchanged: true } });
        }
        if (order.status !== 'SHIPPED') {
            await connection.rollback(); return res.status(409).json({ success: false, message: 'Chỉ xác nhận giao thành công khi đơn đang giao.' });
        }
        await connection.execute(`UPDATE orders SET status='DELIVERED',delivered_at=COALESCE(delivered_at,NOW()),
            payment_status=IF(payment_method='COD','PAID',payment_status) WHERE id=?`, [order.id]);
        await connection.execute("UPDATE shipments SET status='DELIVERED',last_event_at=NOW() WHERE order_id=? AND provider='INTERNAL'", [order.id]);
        await connection.execute(`INSERT INTO order_status_history (order_id,changed_by,from_status,to_status,note,source)
            VALUES (?,?, 'SHIPPED','DELIVERED','Shipper xác nhận giao thành công','INTERNAL')`, [order.id, req.user.id]);
        await connection.execute("INSERT INTO notifications (user_id,type,title,body,order_id) VALUES (?,'ORDER',?,?,?)",
            [order.user_id, 'Đã giao hàng thành công', `Đơn ${order.order_code} đã được giao thành công.`, order.id]);
        await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (NULL,?,?,?,CAST(? AS JSON))',
            ['SHIPPER_DELIVERED', 'order', order.id, JSON.stringify({ shipperId: String(req.user.id), source: 'INTERNAL' })]);
        await connection.commit();
        return res.json({ success: true, data: { status: 'DELIVERED' } });
    } catch (error) { await connection.rollback(); return next(error); }
    finally { connection.release(); }
}

module.exports = { listOrders, dispatchOrder, deliverOrder };
