const crypto = require('node:crypto');
const pool = require('../config/db');
const vnpay = require('../services/payments/vnpay');

const paymentConfig = () => vnpay.configFromEnv();
const safeAmountMinor = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER / 100) return null;
    const minor = Math.round(amount * 100);
    return Number.isSafeInteger(minor) ? minor : null;
};

function methods(req, res) {
    return res.json({ success: true, data: { COD: true, VNPAY: vnpay.isConfigured(paymentConfig()) } });
}

async function startVnpay(req, res, next) {
    if (!/^\d{1,20}$/.test(String(req.params.orderId || ''))) return res.status(400).json({ success:false,message:'Invalid order id.' });
    const config = paymentConfig();
    if (!vnpay.isConfigured(config)) return res.status(503).json({ success:false,message:'Online payment is not configured for this environment.' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [[order]] = await connection.execute('SELECT id,user_id,order_code,status,payment_method,payment_status,total_amount FROM orders WHERE id=? AND user_id=? FOR UPDATE',[req.params.orderId,req.user.id]);
        if (!order) { await connection.rollback(); return res.status(404).json({ success:false,message:'Order not found.' }); }
        if (order.payment_method !== 'VNPAY' || order.payment_status === 'PAID' || order.status === 'CANCELLED' || order.status === 'DELIVERED') {
            await connection.rollback(); return res.status(409).json({ success:false,message:'This order is not available for online payment.' });
        }
        const amountMinor = safeAmountMinor(order.total_amount);
        if (amountMinor == null || amountMinor === 0 || amountMinor % 100 !== 0) {
            await connection.rollback(); return res.status(409).json({ success:false,message:'Order total cannot be represented as VND.' });
        }
        await connection.execute("UPDATE payment_attempts SET status='EXPIRED' WHERE order_id=? AND provider='VNPAY' AND status='PENDING' AND expires_at<=NOW()",[order.id]);
        const [[pending]] = await connection.execute("SELECT reference,amount,expires_at FROM payment_attempts WHERE order_id=? AND provider='VNPAY' AND status='PENDING' AND expires_at>NOW() ORDER BY id DESC LIMIT 1 FOR UPDATE",[order.id]);
        let reference = pending?.reference;
        let expiry = pending?.expires_at ? new Date(pending.expires_at) : null;
        if (pending && safeAmountMinor(pending.amount) !== amountMinor) {
            await connection.execute("UPDATE payment_attempts SET status='EXPIRED' WHERE order_id=? AND provider='VNPAY' AND status='PENDING'",[order.id]);
            reference = null;
        }
        if (!reference) {
            reference = `GL${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
            expiry = new Date(Date.now() + 15 * 60 * 1000);
            await connection.execute("INSERT INTO payment_attempts (order_id,provider,reference,amount,currency,status,expires_at) VALUES (?,'VNPAY',?,?,'VND','PENDING',?)",[order.id,reference,Number(order.total_amount),expiry]);
        }
        const paymentUrl = vnpay.createPaymentUrl({ amountVnd: amountMinor / 100, txnRef:reference, orderCode:order.order_code, ipAddress:req.ip, config });
        await connection.commit();
        return res.json({ success:true,data:{ provider:'VNPAY',reference,paymentUrl,expiresAt:expiry } });
    } catch (error) { await connection.rollback(); return next(error); }
    finally { connection.release(); }
}

function ipnReply(res, code, message) { return res.status(200).json({ RspCode:code, Message:message }); }

async function vnpayIpn(req, res, next) {
    const config = paymentConfig();
    if (!vnpay.isConfigured(config)) return ipnReply(res,'99','Payment provider is not configured');
    const fields = req.query || {};
    if (!vnpay.verify(fields,config.hashSecret) || fields.vnp_TmnCode !== config.tmnCode) return ipnReply(res,'97','Invalid checksum');
    if (typeof fields.vnp_TxnRef !== 'string' || typeof fields.vnp_Amount !== 'string' || !/^\d+$/.test(fields.vnp_Amount)) return ipnReply(res,'01','Order not found');
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [[attempt]] = await connection.execute("SELECT *,expires_at<=NOW() AS is_expired FROM payment_attempts WHERE provider='VNPAY' AND reference=? FOR UPDATE",[fields.vnp_TxnRef]);
        if (!attempt) { await connection.rollback(); return ipnReply(res,'01','Order not found'); }
        const [[order]] = await connection.execute('SELECT id,user_id,order_code,status,payment_method,payment_status,total_amount FROM orders WHERE id=? FOR UPDATE',[attempt.order_id]);
        if (!order) { await connection.rollback(); return ipnReply(res,'01','Order not found'); }
        const expectedAmount = safeAmountMinor(attempt.amount);
        if (fields.vnp_CurrCode !== attempt.currency || expectedAmount == null || fields.vnp_Amount !== String(expectedAmount) || safeAmountMinor(order.total_amount) !== expectedAmount) {
            await connection.rollback(); return ipnReply(res,'04','Invalid amount');
        }
        if (attempt.status !== 'PENDING' && attempt.status !== 'EXPIRED') {
            await connection.commit(); return ipnReply(res,'02','Order already confirmed');
        }
        const providerSaysSuccess = fields.vnp_ResponseCode === '00' && fields.vnp_TransactionStatus === '00';
        if (!providerSaysSuccess) {
            await connection.execute("UPDATE payment_attempts SET status='FAILED',provider_response_code=? WHERE id=? AND status='PENDING'",[String(fields.vnp_ResponseCode || 'UNKNOWN').slice(0,20),attempt.id]);
            await connection.commit(); return ipnReply(res,'00','Payment result recorded');
        }
        if (attempt.status === 'EXPIRED' || Number(attempt.is_expired) === 1 || order.status === 'CANCELLED' || order.status === 'DELIVERED' || order.payment_method !== 'VNPAY' || order.payment_status !== 'UNPAID') {
            await connection.execute("UPDATE payment_attempts SET status='REVIEW',provider_transaction_id=?,provider_response_code='00' WHERE id=? AND status IN ('PENDING','EXPIRED')",[String(fields.vnp_TransactionNo || '').slice(0,100)||null,attempt.id]);
            await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (NULL,\'PAYMENT_REVIEW\',\'order\',?,CAST(? AS JSON))',[order.id,JSON.stringify({provider:'VNPAY',reference:attempt.reference,reason:'Successful callback arrived after the order or payment attempt became ineligible.'})]);
            await connection.execute("INSERT INTO notifications (user_id,type,title,body,order_id) VALUES (?,'PAYMENT','Cần kiểm tra thanh toán',?,?)",[order.user_id,`VNPAY báo đã nhận tiền cho đơn ${order.order_code}, nhưng đơn cần cửa hàng kiểm tra trước khi xác nhận.`,order.id]);
            await connection.commit(); return ipnReply(res,'00','Payment received and flagged for review');
        }
        const transactionId = String(fields.vnp_TransactionNo || '');
        if (!/^\d{1,15}$/.test(transactionId)) { await connection.rollback(); return ipnReply(res,'99','Invalid transaction reference'); }
        await connection.execute("UPDATE payment_attempts SET status='SUCCEEDED',provider_transaction_id=?,provider_response_code='00',confirmed_at=NOW() WHERE id=? AND status='PENDING'",[transactionId,attempt.id]);
        await connection.execute("UPDATE orders SET payment_status='PAID' WHERE id=? AND payment_status='UNPAID' AND payment_method='VNPAY'",[order.id]);
        await connection.execute("INSERT INTO notifications (user_id,type,title,body,order_id) SELECT user_id,'PAYMENT','Thanh toán thành công',CONCAT('Thanh toán đơn ',order_code,' đã được VNPAY xác nhận.'),id FROM orders WHERE id=?",[order.id]);
        await connection.commit();
        return ipnReply(res,'00','Confirm Success');
    } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') return ipnReply(res,'02','Order already confirmed');
        return next(error);
    } finally { connection.release(); }
}

async function vnpayReturn(req, res) {
    const config = paymentConfig();
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
    const fields = req.query || {};
    if (!vnpay.isConfigured(config) || !vnpay.verify(fields,config.hashSecret) || fields.vnp_TmnCode !== config.tmnCode || typeof fields.vnp_TxnRef !== 'string') {
        return res.redirect(`${frontend.replace(/\/$/,'')}/payment-result?result=unverified`);
    }
    try {
        const [[attempt]] = await pool.execute("SELECT order_id FROM payment_attempts WHERE provider='VNPAY' AND reference=?",[fields.vnp_TxnRef]);
        if (!attempt) return res.redirect(`${frontend.replace(/\/$/,'')}/payment-result?result=unverified`);
        const result = fields.vnp_ResponseCode === '00' && fields.vnp_TransactionStatus === '00' ? 'awaiting-confirmation' : 'not-completed';
        return res.redirect(`${frontend.replace(/\/$/,'')}/orders/${attempt.order_id}?paymentReturn=${result}`);
    } catch { return res.redirect(`${frontend.replace(/\/$/,'')}/payment-result?result=unverified`); }
}

module.exports = { methods,startVnpay,vnpayIpn,vnpayReturn };
