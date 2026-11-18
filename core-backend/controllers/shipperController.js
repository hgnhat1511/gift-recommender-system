const pool = require('../config/db');

function validId(value) {
    return /^\d{1,20}$/.test(String(value || ''));
}

async function listOrders(req, res, next) {
    try {
        const [rows] = await pool.execute(`SELECT o.id,o.order_code,o.status,o.payment_method,o.payment_status,
            o.recipient_name,o.phone,o.shipping_address,o.shipping_carrier,o.tracking_number,o.total_amount,
            o.created_at,o.delivered_at,COALESCE(s.provider, 'INTERNAL') AS provider,o.shipper_user_id
            FROM orders o
            LEFT JOIN shipments s ON s.order_id=o.id AND s.provider='INTERNAL'
            WHERE (s.id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM shipments s2 WHERE s2.order_id=o.id AND s2.provider='GHN'))
              AND o.status IN ('PROCESSING','SHIPPED')
            ORDER BY o.created_at DESC,o.id DESC LIMIT 200`);
        return res.json({ success: true, data: rows.map((row) => ({
            id: String(row.id), orderCode: row.order_code, status: row.status,
            paymentMethod: row.payment_method, paymentStatus: row.payment_status,
            recipientName: row.recipient_name, phone: row.phone,
            shippingAddress: typeof row.shipping_address === 'string' ? JSON.parse(row.shipping_address) : row.shipping_address,
            shippingCarrier: row.shipping_carrier, trackingNumber: row.tracking_number,
            total: Number(row.total_amount), createdAt: row.created_at, deliveredAt: row.delivered_at,
            provider: row.provider,
            shipperUserId: row.shipper_user_id ? String(row.shipper_user_id) : null,
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
        if (order.provider && order.provider !== 'INTERNAL') {
            await connection.rollback(); return res.status(403).json({ success: false, message: 'Đơn hàng thuộc nguồn vận chuyển GHN, không thể xử lý nội bộ.' });
        }
        if (order.payment_method !== 'COD' && order.payment_status !== 'PAID') {
            await connection.rollback(); return res.status(409).json({ success: false, message: 'Đơn thanh toán online chưa được xác nhận thanh toán.' });
        }
        if (order.status !== 'PROCESSING') {
            await connection.rollback(); return res.status(409).json({ success: false, message: 'Chỉ bắt đầu giao khi đơn đang chuẩn bị.' });
        }
        await connection.execute("UPDATE orders SET status='SHIPPED', shipper_user_id=COALESCE(shipper_user_id, ?), shipping_carrier=COALESCE(shipping_carrier, 'Giftly'), tracking_number=COALESCE(tracking_number, order_code) WHERE id=?", [req.user.id, order.id]);
        if (!order.provider) {
            await connection.execute("INSERT INTO shipments (order_id,client_order_code,provider,status,last_event_at) VALUES (?,?,'INTERNAL','OUT_FOR_DELIVERY',NOW()) ON DUPLICATE KEY UPDATE status='OUT_FOR_DELIVERY',last_event_at=NOW()", [order.id, order.order_code]);
        } else {
            await connection.execute("UPDATE shipments SET status='OUT_FOR_DELIVERY',last_event_at=NOW() WHERE order_id=? AND provider='INTERNAL'", [order.id]);
        }
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
        if (order.provider && order.provider !== 'INTERNAL') {
            await connection.rollback(); return res.status(403).json({ success: false, message: 'Chỉ xác nhận giao cho đơn nội bộ.' });
        }
        if (order.status === 'DELIVERED') {
            await connection.commit(); return res.json({ success: true, data: { status: 'DELIVERED', unchanged: true } });
        }
        if (order.status !== 'SHIPPED') {
            await connection.rollback(); return res.status(409).json({ success: false, message: 'Chỉ xác nhận giao thành công khi đơn đang giao.' });
        }
        await connection.execute(`UPDATE orders SET status='DELIVERED',delivered_at=COALESCE(delivered_at,NOW()),
            shipper_user_id=COALESCE(shipper_user_id, ?),
            payment_status=IF(payment_method='COD','PAID',payment_status) WHERE id=?`, [req.user.id, order.id]);
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

async function failOrder(req, res, next) {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Mã đơn hàng không hợp lệ.' });
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim().slice(0, 255) : 'Giao hàng không thành công';
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [[order]] = await connection.execute(`SELECT o.id,o.user_id,o.order_code,o.status,o.payment_method,
            o.payment_status,o.shipper_user_id,s.provider FROM orders o
            LEFT JOIN shipments s ON s.order_id=o.id WHERE o.id=? FOR UPDATE`, [req.params.id]);
        if (!order) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng.' }); }
        if (order.provider && order.provider !== 'INTERNAL') {
            await connection.rollback(); return res.status(403).json({ success: false, message: 'Chỉ báo giao thất bại cho đơn nội bộ.' });
        }
        if (order.status !== 'SHIPPED') {
            await connection.rollback(); return res.status(409).json({ success: false, message: 'Chỉ báo giao thất bại khi đơn đang giao.' });
        }
        await connection.execute("UPDATE shipments SET status='FAILED',last_event_at=NOW() WHERE order_id=? AND provider='INTERNAL'", [order.id]);
        await connection.execute("UPDATE orders SET status='PROCESSING' WHERE id=?", [order.id]);
        await connection.execute(`INSERT INTO order_status_history (order_id,changed_by,from_status,to_status,note,source)
            VALUES (?,?, 'SHIPPED','PROCESSING',?,'INTERNAL')`, [order.id, req.user.id, `Giao thất bại: ${reason}`]);
        await connection.execute("INSERT INTO notifications (user_id,type,title,body,order_id) VALUES (?,'ORDER',?,?,?)",
            [order.user_id, 'Giao hàng không thành công', `Đơn ${order.order_code}: ${reason}`, order.id]);
        await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (NULL,?,?,?,CAST(? AS JSON))',
            ['SHIPPER_FAILED', 'order', order.id, JSON.stringify({ shipperId: String(req.user.id), reason, source: 'INTERNAL' })]);
        await connection.commit();
        return res.json({ success: true, data: { status: 'PROCESSING', note: `Giao thất bại: ${reason}` } });
    } catch (error) { await connection.rollback(); return next(error); }
    finally { connection.release(); }
}

module.exports = { listOrders, dispatchOrder, deliverOrder, failOrder };
