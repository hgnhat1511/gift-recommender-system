const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('../config/db');

const MAX_PROOF_BYTES = 3 * 1024 * 1024;
const privateDirectory = path.resolve(process.env.PRIVATE_UPLOAD_DIR || path.join(__dirname, '..', 'private_uploads', 'delivery-proofs'));

function sniffImage(buffer) {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return { mime: 'image/png', extension: 'png' };
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
    return null;
}

async function uploadDeliveryProof(req, res, next) {
    if (!/^\d{1,20}$/.test(String(req.params.id || ''))) return res.status(400).json({ success: false, message: 'Mã đơn hàng không hợp lệ.' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(415).json({ success: false, message: 'Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.' });
    if (req.body.length > MAX_PROOF_BYTES) return res.status(413).json({ success: false, message: 'Ảnh giao hàng tối đa 3 MB.' });
    const image = sniffImage(req.body);
    const contentType = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!image || contentType !== image.mime) return res.status(415).json({ success: false, message: 'Loại ảnh không hợp lệ hoặc không khớp nội dung tệp.' });

    const connection = await pool.getConnection();
    let filePath;
    try {
        await connection.beginTransaction();
        const [[order]] = await connection.execute(`SELECT o.id,o.shipper_user_id,o.status,s.provider FROM orders o
            LEFT JOIN shipments s ON s.order_id=o.id WHERE o.id=? FOR UPDATE`, [req.params.id]);
        if (!order) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng.' }); }
        if (order.provider && order.provider !== 'INTERNAL') {
            await connection.rollback(); return res.status(403).json({ success: false, message: 'Chỉ tải ảnh cho đơn giao hàng nội bộ.' });
        }
        if (order.status !== 'SHIPPED') {
            await connection.rollback(); return res.status(409).json({ success: false, message: 'Chỉ tải ảnh cho đơn nội bộ đang giao.' });
        }
        const [[existing]] = await connection.execute('SELECT id FROM delivery_proofs WHERE order_id=?', [order.id]);
        if (existing) { await connection.rollback(); return res.status(409).json({ success: false, message: 'Đơn hàng đã có ảnh giao hàng.' }); }

        const fileName = `${crypto.randomUUID()}.${image.extension}`;
        filePath = path.join(privateDirectory, fileName);
        await fs.mkdir(privateDirectory, { recursive: true });
        await fs.writeFile(filePath, req.body, { flag: 'wx', mode: 0o600 });
        const sha256 = crypto.createHash('sha256').update(req.body).digest('hex');
        await connection.execute('INSERT INTO delivery_proofs (order_id,file_name,mime_type,sha256,uploaded_by) VALUES (?,?,?,?,?)',
            [order.id, fileName, image.mime, sha256, req.user.id]);
        await connection.commit();
        return res.status(201).json({ success: true, data: { orderId: String(order.id), mimeType: image.mime, sha256 } });
    } catch (error) {
        await connection.rollback();
        if (filePath) await fs.unlink(filePath).catch(() => {});
        return next(error);
    } finally { connection.release(); }
}

async function getDeliveryProof(req, res, next) {
    if (!/^\d{1,20}$/.test(String(req.params.orderId || ''))) return res.status(400).json({ success: false, message: 'Mã đơn hàng không hợp lệ.' });
    try {
        const [[proof]] = await pool.execute(`SELECT o.user_id,o.shipper_user_id,d.file_name,d.mime_type
            FROM orders o JOIN delivery_proofs d ON d.order_id=o.id WHERE o.id=?`, [req.params.orderId]);
        if (!proof) return res.status(404).json({ success: false, message: 'Chưa có ảnh giao hàng.' });
        const allowed = req.user.role === 'ADMIN' || req.user.role === 'SHIPPER' || String(req.user.id) === String(proof.user_id);
        if (!allowed) return res.status(403).json({ success: false, message: 'Không có quyền xem ảnh giao hàng này.' });
        if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/i.test(proof.file_name)) return res.status(404).json({ success: false, message: 'Không tìm thấy ảnh giao hàng.' });
        res.set('Cache-Control', 'private, no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        res.type(proof.mime_type);
        return res.sendFile(path.join(privateDirectory, proof.file_name), (error) => { if (error && !res.headersSent) next(error); });
    } catch (error) { return next(error); }
}

module.exports = { uploadDeliveryProof, getDeliveryProof, sniffImage, MAX_PROOF_BYTES };
