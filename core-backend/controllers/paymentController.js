const crypto = require('node:crypto');
const pool = require('../config/db');
const vnpay = require('../services/payments/vnpay');
const momo = require('../services/payments/momo');

const paymentConfig = () => vnpay.configFromEnv();
const momoConfig = () => momo.configFromEnv();
const safeAmountMinor = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER / 100) return null;
    const minor = Math.round(amount * 100);
    return Number.isSafeInteger(minor) ? minor : null;
};

function methods(req, res) {
    return res.json({
        success: true,
        data: {
            COD: true,
            VNPAY: vnpay.isConfigured(paymentConfig()),
            MOMO: momo.isConfigured(momoConfig())
        }
    });
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
        const [[attempt]] = await pool.execute("SELECT id, order_id, status FROM payment_attempts WHERE provider='VNPAY' AND reference=?",[fields.vnp_TxnRef]);
        if (!attempt) return res.redirect(`${frontend.replace(/\/$/,'')}/payment-result?result=unverified`);
        const isSuccess = fields.vnp_ResponseCode === '00' && fields.vnp_TransactionStatus === '00';
        if (isSuccess && attempt.status === 'PENDING') {
            const transactionId = String(fields.vnp_TransactionNo || fields.vnp_TxnRef || '');
            await pool.execute("UPDATE payment_attempts SET status='SUCCEEDED',provider_transaction_id=?,provider_response_code='00',confirmed_at=COALESCE(confirmed_at,NOW()) WHERE id=?",[transactionId, attempt.id]);
            await pool.execute("UPDATE orders SET payment_status='PAID', status=IF(status='PENDING','PROCESSING',status) WHERE id=? AND payment_method='VNPAY'",[attempt.order_id]);
            await pool.execute("INSERT INTO notifications (user_id,type,title,body,order_id) SELECT user_id,'PAYMENT','Thanh toán thành công',CONCAT('Thanh toán đơn ',order_code,' đã được VNPAY xác nhận.'),id FROM orders WHERE id=?",[attempt.order_id]);
        }
        const result = isSuccess ? 'awaiting-confirmation' : 'not-completed';
        return res.redirect(`${frontend.replace(/\/$/,'')}/orders/${attempt.order_id}?paymentReturn=${result}`);
    } catch { return res.redirect(`${frontend.replace(/\/$/,'')}/payment-result?result=unverified`); }
}

function mockVnpayPage(req, res) {
    const fields = req.query || {};
    const amount = Number(fields.vnp_Amount || 0) / 100;
    const amountFormatted = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
    const orderInfo = fields.vnp_OrderInfo || 'Thanh toán đơn hàng';
    const txnRef = fields.vnp_TxnRef || '';
    const tmnCode = fields.vnp_TmnCode || '';

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cổng Thanh Toán VNPAY-QR (Sandbox)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: #f1f5f9; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 16px; }
    .card { background: #fff; width: 100%; max-width: 520px; border-radius: 16px; box-shadow: 0 12px 30px -8px rgba(0,0,0,0.12); overflow: hidden; border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #005baa, #0072bc); color: #fff; padding: 22px 20px; text-align: center; }
    .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .header p { font-size: 13px; opacity: 0.9; }
    .badge { display: inline-block; background: #e0f2fe; color: #0369a1; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; margin-top: 6px; }
    .body { padding: 20px; }
    .info-summary { background: #f8fafc; border-radius: 10px; padding: 14px; margin-bottom: 18px; border: 1px solid #e2e8f0; }
    .info-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13.5px; color: #475569; }
    .info-row b { color: #0f172a; word-break: break-all; }
    .amount-highlight { color: #005baa; font-size: 20px; font-weight: 700; }
    .tabs { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 2px solid #e2e8f0; }
    .tab-btn { flex: 1; padding: 10px; border: none; background: none; font-size: 13.5px; font-weight: 600; color: #64748b; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.2s; }
    .tab-btn.active { color: #005baa; border-bottom-color: #005baa; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .form-group { margin-bottom: 12px; }
    .form-group label { display: block; font-size: 12.5px; font-weight: 600; color: #334155; margin-bottom: 5px; }
    .form-control { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; outline: none; transition: border-color 0.2s; }
    .form-control:focus { border-color: #005baa; box-shadow: 0 0 0 2px rgba(0,91,170,0.15); }
    .form-row { display: flex; gap: 10px; }
    .form-row .form-group { flex: 1; }
    .quick-fill { display: inline-flex; align-items: center; gap: 4px; background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-size: 11.5px; font-weight: 600; padding: 4px 8px; border-radius: 6px; cursor: pointer; margin-bottom: 12px; }
    .quick-fill:hover { background: #bae6fd; }
    .qr-container { text-align: center; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .qr-code { width: 150px; height: 150px; margin: 0 auto 10px; background: #fff; border-radius: 8px; padding: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.06); display: flex; align-items: center; justify-content: center; }
    .qr-details { text-align: left; background: #fff; border-radius: 8px; padding: 12px; font-size: 13px; border: 1px solid #e2e8f0; margin-top: 10px; }
    .qr-details div { display: flex; justify-content: space-between; padding: 4px 0; }
    .qr-details b { color: #0f172a; }
    .actions { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
    .btn { display: block; width: 100%; padding: 12px; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; transition: all 0.2s; }
    .btn-primary { background: #005baa; color: #fff; }
    .btn-primary:hover { background: #004684; }
    .btn-cancel { background: #fff; color: #ef4444; border: 1px solid #fecaca; }
    .btn-cancel:hover { background: #fee2e2; }
    .success-modal { display: none; text-align: center; padding: 30px 10px; }
    .checkmark { width: 64px; height: 64px; margin: 0 auto 16px; background: #10b981; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>VNPAY Sandbox</h1>
      <p>Cổng mô phỏng thanh toán trực tuyến</p>
      <span class="badge">MÔI TRƯỜNG THỬ NGHIỆM ĐỒ ÁN</span>
    </div>
    <div class="body">
      <div id="paymentView">
        <div class="info-summary">
          <div class="info-row"><span>Mã giao dịch:</span><b>${txnRef}</b></div>
          <div class="info-row"><span>Nội dung:</span><b>${orderInfo}</b></div>
          <div class="info-row"><span>Số tiền:</span><b class="amount-highlight">${amountFormatted}</b></div>
        </div>

        <div class="tabs">
          <button type="button" class="tab-btn active" onclick="switchTab('card')">💳 Nhập thẻ ATM / Visa</button>
          <button type="button" class="tab-btn" onclick="switchTab('qr')">📱 Chuyển khoản VietQR</button>
        </div>

        <form id="paymentForm" method="POST" action="/api/payments/mock-vnpay/process">
          ${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, '')}">`).join('\n          ')}
          <input type="hidden" id="formAction" name="action" value="success">

          <!-- TAB 1: NHẬP THẺ -->
          <div id="tabCard" class="tab-content active">
            <button type="button" class="quick-fill" onclick="autoFillCard()">⚡ Điền nhanh thẻ test mẫu (NCB)</button>
            <div class="form-group">
              <label for="cardNumber">Số thẻ ngân hàng</label>
              <input type="text" id="cardNumber" class="form-control" placeholder="9704 1985 2619 1432" value="9704 1985 2619 1432">
            </div>
            <div class="form-group">
              <label for="cardHolder">Tên chủ thẻ (không dấu)</label>
              <input type="text" id="cardHolder" class="form-control" placeholder="NGUYEN VAN A" value="NGUYEN VAN A" style="text-transform: uppercase;">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="cardDate">Ngày phát hành</label>
                <input type="text" id="cardDate" class="form-control" placeholder="07/15" value="07/15">
              </div>
              <div class="form-group">
                <label for="cardOtp">Mã xác thực OTP</label>
                <input type="text" id="cardOtp" class="form-control" placeholder="123456" value="123456">
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-primary" onclick="confirmPayment('card')">
                ✓ Xác nhận thanh toán bằng Thẻ
              </button>
            </div>
          </div>

          <!-- TAB 2: CHUYỂN KHOẢN QR -->
          <div id="tabQr" class="tab-content">
            <div class="qr-container">
              <div class="qr-code">
                <svg width="130" height="130" viewBox="0 0 130 130">
                  <rect width="130" height="130" fill="#fff"/>
                  <rect x="10" y="10" width="35" height="35" fill="#005baa"/>
                  <rect x="17" y="17" width="21" height="21" fill="#fff"/>
                  <rect x="22" y="22" width="11" height="11" fill="#005baa"/>
                  <rect x="85" y="10" width="35" height="35" fill="#005baa"/>
                  <rect x="92" y="17" width="21" height="21" fill="#fff"/>
                  <rect x="97" y="22" width="11" height="11" fill="#005baa"/>
                  <rect x="10" y="85" width="35" height="35" fill="#005baa"/>
                  <rect x="17" y="92" width="21" height="21" fill="#fff"/>
                  <rect x="22" y="97" width="11" height="11" fill="#005baa"/>
                  <rect x="55" y="20" width="20" height="15" fill="#005baa"/>
                  <rect x="20" y="55" width="15" height="20" fill="#005baa"/>
                  <rect x="55" y="55" width="25" height="25" fill="#005baa"/>
                  <rect x="90" y="55" width="18" height="15" fill="#005baa"/>
                  <rect x="55" y="90" width="18" height="25" fill="#005baa"/>
                  <rect x="90" y="90" width="25" height="18" fill="#005baa"/>
                </svg>
              </div>
              <p style="font-size:12px; color:#64748b; font-weight:600;">Quét mã bằng ứng dụng ngân hàng bất kỳ</p>
              <div class="qr-details">
                <div><span>Ngân hàng:</span><b>VietinBank (ICB)</b></div>
                <div><span>Số tài khoản:</span><b>1028 9988 7766</b></div>
                <div><span>Chủ tài khoản:</span><b>HE THONG GIFTLY VN</b></div>
                <div><span>Số tiền:</span><b style="color:#005baa;">${amountFormatted}</b></div>
                <div><span>Nội dung CK:</span><b>${txnRef}</b></div>
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-primary" onclick="confirmPayment('transfer')">
                ✓ Tôi đã chuyển khoản thành công
              </button>
            </div>
          </div>

          <div class="actions" style="margin-top: 10px;">
            <button type="button" class="btn btn-cancel" onclick="cancelPayment()">
              ✕ Thử nghiệm thanh toán thất bại (Hủy / Không đủ số dư)
            </button>
          </div>
        </form>
      </div>

      <!-- MÀN HÌNH XÁC NHẬN CHUYỂN KHOẢN THÀNH CÔNG -->
      <div id="successView" class="success-modal">
        <div class="checkmark">✓</div>
        <h2 style="font-size: 20px; color: #0f172a; margin-bottom: 8px;">Xác nhận thanh toán thành công!</h2>
        <p style="font-size: 13.5px; color: #64748b; margin-bottom: 12px;">Hệ thống ngân hàng đã ghi nhận chuyển khoản cho đơn hàng.</p>
        <p style="font-size: 12.5px; color: #005baa; font-weight: 600;">Đang tự động chuyển hướng về Giftly...</p>
      </div>

      <!-- MÀN HÌNH BÁO LỖI THANH TOÁN THẤT BẠI -->
      <div id="failedView" class="success-modal">
        <div class="checkmark" style="background: #ef4444;">✕</div>
        <h2 style="font-size: 20px; color: #991b1b; margin-bottom: 8px;">Giao dịch thanh toán không thành công!</h2>
        <p style="font-size: 13.5px; color: #64748b; margin-bottom: 12px;">Lý do: Khách hàng hủy giao dịch hoặc tài khoản không đủ số dư.</p>
        <p style="font-size: 12.5px; color: #dc2626; font-weight: 600;">Đang quay về đơn hàng Giftly để bạn có thể thử lại...</p>
      </div>
    </div>
  </div>

  <script>
    function switchTab(type) {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
      if (type === 'card') {
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        document.getElementById('tabCard').classList.add('active');
      } else {
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
        document.getElementById('tabQr').classList.add('active');
      }
    }

    function autoFillCard() {
      document.getElementById('cardNumber').value = '9704 1985 2619 1432';
      document.getElementById('cardHolder').value = 'NGUYEN VAN A';
      document.getElementById('cardDate').value = '07/15';
      document.getElementById('cardOtp').value = '123456';
    }

    function confirmPayment(type) {
      document.getElementById('formAction').value = 'success';
      document.getElementById('paymentView').style.display = 'none';
      document.getElementById('successView').style.display = 'block';
      setTimeout(() => {
        document.getElementById('paymentForm').submit();
      }, 1200);
    }

    function cancelPayment() {
      document.getElementById('formAction').value = 'cancel';
      document.getElementById('paymentView').style.display = 'none';
      document.getElementById('failedView').style.display = 'block';
      setTimeout(() => {
        document.getElementById('paymentForm').submit();
      }, 1200);
    }
  </script>
</body>
</html>`;
    return res.type('html').send(html);
}

function mockVnpayProcess(req, res) {
    const config = paymentConfig();
    const action = req.body?.action || 'success';
    const fields = { ...req.body };
    delete fields.action;

    const returnUrl = fields.vnp_ReturnUrl || config.returnUrl;
    const isSuccess = action === 'success';

    const responseFields = {
        vnp_TmnCode: fields.vnp_TmnCode || config.tmnCode || 'DEMO',
        vnp_Amount: fields.vnp_Amount || '0',
        vnp_BankCode: 'NCB',
        vnp_BankTranNo: `VNP${Date.now()}`,
        vnp_CardType: 'ATM',
        vnp_PayDate: new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14),
        vnp_OrderInfo: fields.vnp_OrderInfo || '',
        vnp_TransactionNo: String(Date.now()).slice(-8),
        vnp_ResponseCode: isSuccess ? '00' : '24',
        vnp_TransactionStatus: isSuccess ? '00' : '02',
        vnp_TxnRef: fields.vnp_TxnRef || ''
    };

    const hashSecret = config.hashSecret || 'mock_secret';
    const signature = vnpay.sign(responseFields, hashSecret);
    responseFields.vnp_SecureHash = signature;

    const query = new URLSearchParams(responseFields);
    return res.redirect(`${returnUrl}?${query.toString()}`);
}

async function startMomo(req, res, next) {
    if (!/^\d{1,20}$/.test(String(req.params.orderId || ''))) return res.status(400).json({ success:false,message:'Invalid order id.' });
    const config = momoConfig();
    if (!momo.isConfigured(config)) return res.status(503).json({ success:false,message:'Online payment is not configured for this environment.' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [[order]] = await connection.execute('SELECT id,user_id,order_code,status,payment_method,payment_status,total_amount FROM orders WHERE id=? AND user_id=? FOR UPDATE',[req.params.orderId,req.user.id]);
        if (!order) { await connection.rollback(); return res.status(404).json({ success:false,message:'Order not found.' }); }
        if (order.payment_method !== 'MOMO' || order.payment_status === 'PAID' || order.status === 'CANCELLED' || order.status === 'DELIVERED') {
            await connection.rollback(); return res.status(409).json({ success:false,message:'This order is not available for online payment.' });
        }
        const amountMinor = safeAmountMinor(order.total_amount);
        if (amountMinor == null || amountMinor === 0 || amountMinor % 100 !== 0) {
            await connection.rollback(); return res.status(409).json({ success:false,message:'Order total cannot be represented as VND.' });
        }
        await connection.execute("UPDATE payment_attempts SET status='EXPIRED' WHERE order_id=? AND provider='MOMO' AND status='PENDING' AND expires_at<=NOW()",[order.id]);
        const [[pending]] = await connection.execute("SELECT reference,amount,expires_at FROM payment_attempts WHERE order_id=? AND provider='MOMO' AND status='PENDING' AND expires_at>NOW() ORDER BY id DESC LIMIT 1 FOR UPDATE",[order.id]);
        let reference = pending?.reference;
        let expiry = pending?.expires_at ? new Date(pending.expires_at) : null;
        if (pending && safeAmountMinor(pending.amount) !== amountMinor) {
            await connection.execute("UPDATE payment_attempts SET status='EXPIRED' WHERE order_id=? AND provider='MOMO' AND status='PENDING'",[order.id]);
            reference = null;
        }
        if (!reference) {
            reference = `MM${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
            expiry = new Date(Date.now() + 15 * 60 * 1000);
            await connection.execute("INSERT INTO payment_attempts (order_id,provider,reference,amount,currency,status,expires_at) VALUES (?,'MOMO',?,?,'VND','PENDING',?)",[order.id,reference,Number(order.total_amount),expiry]);
        }
        const paymentUrl = await momo.createPaymentUrl({ amountVnd: amountMinor / 100, reference, orderCode: order.order_code, config });
        await connection.commit();
        return res.json({ success:true, data:{ provider:'MOMO', reference, paymentUrl, expiresAt: expiry } });
    } catch (error) { await connection.rollback(); return next(error); }
    finally { connection.release(); }
}

async function momoReturn(req, res) {
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
    const fields = req.query || {};
    const orderIdRef = fields.orderId || fields.requestId;
    if (!orderIdRef) {
        return res.redirect(`${frontend.replace(/\/$/,'')}/payment-result?result=unverified`);
    }
    try {
        const [[attempt]] = await pool.execute("SELECT id, order_id, status FROM payment_attempts WHERE provider='MOMO' AND reference=?",[orderIdRef]);
        if (!attempt) return res.redirect(`${frontend.replace(/\/$/,'')}/payment-result?result=unverified`);
        const isSuccess = String(fields.resultCode) === '0';
        if (isSuccess && attempt.status === 'PENDING') {
            const transactionId = String(fields.transId || orderIdRef || '');
            await pool.execute("UPDATE payment_attempts SET status='SUCCEEDED',provider_transaction_id=?,provider_response_code='0',confirmed_at=COALESCE(confirmed_at,NOW()) WHERE id=?",[transactionId, attempt.id]);
            await pool.execute("UPDATE orders SET payment_status='PAID', status=IF(status='PENDING','PROCESSING',status) WHERE id=? AND payment_method='MOMO'",[attempt.order_id]);
            await pool.execute("INSERT INTO notifications (user_id,type,title,body,order_id) SELECT user_id,'PAYMENT','Thanh toán thành công',CONCAT('Thanh toán đơn ',order_code,' đã được MoMo xác nhận.'),id FROM orders WHERE id=?",[attempt.order_id]);
        }
        const result = isSuccess ? 'awaiting-confirmation' : 'not-completed';
        return res.redirect(`${frontend.replace(/\/$/,'')}/orders/${attempt.order_id}?paymentReturn=${result}&provider=momo`);
    } catch {
        return res.redirect(`${frontend.replace(/\/$/,'')}/payment-result?result=unverified`);
    }
}

async function momoIpn(req, res) {
    const config = momoConfig();
    const fields = req.body || {};
    if (!momo.verifyCallback(fields, config.secretKey)) {
        return res.status(400).json({ message: 'Invalid signature' });
    }
    const reference = fields.orderId;
    const isSuccess = String(fields.resultCode) === '0';
    try {
        const [[attempt]] = await pool.execute("SELECT id, order_id, status FROM payment_attempts WHERE provider='MOMO' AND reference=?",[reference]);
        if (attempt && isSuccess && attempt.status === 'PENDING') {
            await pool.execute("UPDATE payment_attempts SET status='SUCCEEDED',provider_transaction_id=?,provider_response_code='0',confirmed_at=COALESCE(confirmed_at,NOW()) WHERE id=?",[String(fields.transId || reference), attempt.id]);
            await pool.execute("UPDATE orders SET payment_status='PAID', status=IF(status='PENDING','PROCESSING',status) WHERE id=? AND payment_method='MOMO'",[attempt.order_id]);
            await pool.execute("INSERT INTO notifications (user_id,type,title,body,order_id) SELECT user_id,'PAYMENT','Thanh toán thành công',CONCAT('Thanh toán đơn ',order_code,' đã được MoMo xác nhận.'),id FROM orders WHERE id=?",[attempt.order_id]);
        }
        return res.status(204).end();
    } catch {
        return res.status(500).json({ message: 'Internal error' });
    }
}

function mockMomoPage(req, res) {
    const fields = req.query || {};
    const amount = Number(fields.amount || 0);
    const amountFormatted = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
    const orderInfo = fields.orderInfo || 'Thanh toán đơn hàng';
    const orderId = fields.orderId || fields.requestId || '';

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ví MoMo Sandbox - Cổng Thanh Toán Thử Nghiệm</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: #fce7f3; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 16px; }
    .card { background: #fff; width: 100%; max-width: 520px; border-radius: 16px; box-shadow: 0 12px 30px -8px rgba(165,0,100,0.18); overflow: hidden; border: 1px solid #fbcfe8; }
    .header { background: linear-gradient(135deg, #a50064, #d82d8b); color: #fff; padding: 22px 20px; text-align: center; }
    .header h1 { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 4px; }
    .header p { font-size: 13px; opacity: 0.95; }
    .badge { display: inline-block; background: #fff; color: #a50064; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; margin-top: 6px; }
    .body { padding: 20px; }
    .info-summary { background: #fdf2f8; border-radius: 10px; padding: 14px; margin-bottom: 18px; border: 1px solid #fce7f3; }
    .info-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13.5px; color: #475569; }
    .info-row b { color: #0f172a; word-break: break-all; }
    .amount-highlight { color: #a50064; font-size: 20px; font-weight: 800; }
    .tabs { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 2px solid #fce7f3; }
    .tab-btn { flex: 1; padding: 10px; border: none; background: none; font-size: 13.5px; font-weight: 600; color: #64748b; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.2s; }
    .tab-btn.active { color: #a50064; border-bottom-color: #a50064; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .form-group { margin-bottom: 12px; }
    .form-group label { display: block; font-size: 12.5px; font-weight: 600; color: #334155; margin-bottom: 5px; }
    .form-control { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; outline: none; transition: border-color 0.2s; }
    .form-control:focus { border-color: #a50064; box-shadow: 0 0 0 2px rgba(165,0,100,0.15); }
    .form-row { display: flex; gap: 10px; }
    .form-row .form-group { flex: 1; }
    .quick-fill { display: inline-flex; align-items: center; gap: 4px; background: #fce7f3; color: #a50064; border: 1px solid #fbcfe8; font-size: 11.5px; font-weight: 600; padding: 4px 8px; border-radius: 6px; cursor: pointer; margin-bottom: 12px; }
    .quick-fill:hover { background: #fbcfe8; }
    .qr-container { text-align: center; background: #fdf2f8; border: 1px dashed #f472b6; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .qr-code { width: 140px; height: 140px; margin: 0 auto 10px; background: #fff; border-radius: 8px; padding: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.06); display: flex; align-items: center; justify-content: center; }
    .qr-details { text-align: left; background: #fff; border-radius: 8px; padding: 12px; font-size: 13px; border: 1px solid #fce7f3; margin-top: 10px; }
    .qr-details div { display: flex; justify-content: space-between; padding: 4px 0; }
    .qr-details b { color: #0f172a; }
    .actions { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
    .btn { display: block; width: 100%; padding: 12px; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; text-align: center; text-decoration: none; transition: all 0.2s; }
    .btn-momo { background: #a50064; color: #fff; }
    .btn-momo:hover { background: #880052; }
    .btn-cancel { background: #fff; color: #ef4444; border: 1px solid #fecaca; }
    .btn-cancel:hover { background: #fee2e2; }
    .success-modal { display: none; text-align: center; padding: 30px 10px; }
    .checkmark { width: 64px; height: 64px; margin: 0 auto 16px; background: #10b981; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>momo sandbox</h1>
      <p>Cổng mô phỏng thanh toán Ví MoMo</p>
      <span class="badge">MÔI TRƯỜNG THỬ NGHIỆM ĐỒ ÁN</span>
    </div>
    <div class="body">
      <div id="paymentView">
        <div class="info-summary">
          <div class="info-row"><span>Mã đơn MoMo:</span><b>${orderId}</b></div>
          <div class="info-row"><span>Nội dung:</span><b>${orderInfo}</b></div>
          <div class="info-row"><span>Số tiền:</span><b class="amount-highlight">${amountFormatted}</b></div>
        </div>

        <div class="tabs">
          <button type="button" class="tab-btn active" onclick="switchMomoTab('qr')">📱 Quét mã Ví MoMo</button>
          <button type="button" class="tab-btn" onclick="switchMomoTab('card')">💳 Nhập thẻ ATM test</button>
        </div>

        <form id="momoForm" method="POST" action="/api/payments/mock-momo/process">
          ${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, '')}">`).join('\n          ')}
          <input type="hidden" id="momoFormAction" name="action" value="success">

          <!-- TAB 1: QUÉT QR MOMO -->
          <div id="momoTabQr" class="tab-content active">
            <div class="qr-container">
              <div class="qr-code">
                <svg width="120" height="120" viewBox="0 0 120 120">
                  <rect width="120" height="120" fill="#fff"/>
                  <rect x="10" y="10" width="30" height="30" fill="#a50064"/>
                  <rect x="16" y="16" width="18" height="18" fill="#fff"/>
                  <rect x="20" y="20" width="10" height="10" fill="#a50064"/>
                  <rect x="80" y="10" width="30" height="30" fill="#a50064"/>
                  <rect x="86" y="16" width="18" height="18" fill="#fff"/>
                  <rect x="90" y="20" width="10" height="10" fill="#a50064"/>
                  <rect x="10" y="80" width="30" height="30" fill="#a50064"/>
                  <rect x="16" y="86" width="18" height="18" fill="#fff"/>
                  <rect x="20" y="90" width="10" height="10" fill="#a50064"/>
                  <rect x="50" y="20" width="15" height="10" fill="#a50064"/>
                  <rect x="20" y="50" width="10" height="15" fill="#a50064"/>
                  <rect x="50" y="50" width="20" height="20" fill="#a50064"/>
                  <rect x="80" y="50" width="15" height="10" fill="#a50064"/>
                  <rect x="50" y="80" width="15" height="20" fill="#a50064"/>
                  <rect x="80" y="80" width="20" height="15" fill="#a50064"/>
                </svg>
              </div>
              <p style="font-size:12px; color:#9d174d; font-weight:600;">Mô phỏng chuyển tiền qua Ví MoMo</p>
              <div class="qr-details">
                <div><span>Ví nhận:</span><b>0909 888 999</b></div>
                <div><span>Chủ ví:</span><b>HE THONG GIFTLY VN</b></div>
                <div><span>Số tiền:</span><b style="color:#a50064;">${amountFormatted}</b></div>
                <div><span>Lời nhắn:</span><b>${orderId}</b></div>
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-momo" onclick="confirmMomoPayment('qr')">
                ✓ Tôi đã chuyển tiền qua Ví MoMo
              </button>
            </div>
          </div>

          <!-- TAB 2: NHẬP THẺ ATM TEST -->
          <div id="momoTabCard" class="tab-content">
            <button type="button" class="quick-fill" onclick="autoFillMomoCard()">⚡ Điền nhanh thẻ test mẫu (NCB)</button>
            <div class="form-group">
              <label for="momoCardNumber">Số thẻ ngân hàng</label>
              <input type="text" id="momoCardNumber" class="form-control" placeholder="9704 1985 2619 1432" value="9704 1985 2619 1432">
            </div>
            <div class="form-group">
              <label for="momoCardHolder">Tên chủ thẻ</label>
              <input type="text" id="momoCardHolder" class="form-control" placeholder="NGUYEN VAN A" value="NGUYEN VAN A" style="text-transform: uppercase;">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="momoCardDate">Ngày phát hành</label>
                <input type="text" id="momoCardDate" class="form-control" placeholder="07/15" value="07/15">
              </div>
              <div class="form-group">
                <label for="momoCardOtp">Mã OTP</label>
                <input type="text" id="momoCardOtp" class="form-control" placeholder="123456" value="123456">
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-momo" onclick="confirmMomoPayment('card')">
                ✓ Xác nhận thanh toán bằng Thẻ
              </button>
            </div>
          </div>

          <div class="actions" style="margin-top: 10px;">
            <button type="button" class="btn btn-cancel" onclick="cancelMomoPayment()">
              ✕ Thử nghiệm thanh toán thất bại (Hủy / Không đủ số dư)
            </button>
          </div>
        </form>
      </div>

      <!-- MÀN HÌNH XÁC NHẬN MOMO THÀNH CÔNG -->
      <div id="momoSuccessView" class="success-modal">
        <div class="checkmark">✓</div>
        <h2 style="font-size: 20px; color: #0f172a; margin-bottom: 8px;">Xác nhận thanh toán MoMo thành công!</h2>
        <p style="font-size: 13.5px; color: #64748b; margin-bottom: 12px;">Giao dịch đã được hệ thống Ví MoMo xác thực và chuyển khoản.</p>
        <p style="font-size: 12.5px; color: #a50064; font-weight: 600;">Đang tự động chuyển hướng về Giftly...</p>
      </div>

      <!-- MÀN HÌNH BÁO LỖI MOMO THẤT BẠI -->
      <div id="momoFailedView" class="success-modal">
        <div class="checkmark" style="background: #ef4444;">✕</div>
        <h2 style="font-size: 20px; color: #991b1b; margin-bottom: 8px;">Giao dịch MoMo không thành công!</h2>
        <p style="font-size: 13.5px; color: #64748b; margin-bottom: 12px;">Lý do: Khách hàng hủy giao dịch hoặc số dư ví không đủ.</p>
        <p style="font-size: 12.5px; color: #dc2626; font-weight: 600;">Đang quay về đơn hàng Giftly để bạn có thể thử lại...</p>
      </div>
    </div>
  </div>

  <script>
    function switchMomoTab(type) {
      document.querySelectorAll('#paymentView .tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('#paymentView .tab-content').forEach(content => content.classList.remove('active'));
      if (type === 'qr') {
        document.querySelectorAll('#paymentView .tab-btn')[0].classList.add('active');
        document.getElementById('momoTabQr').classList.add('active');
      } else {
        document.querySelectorAll('#paymentView .tab-btn')[1].classList.add('active');
        document.getElementById('momoTabCard').classList.add('active');
      }
    }

    function autoFillMomoCard() {
      document.getElementById('momoCardNumber').value = '9704 1985 2619 1432';
      document.getElementById('momoCardHolder').value = 'NGUYEN VAN A';
      document.getElementById('momoCardDate').value = '07/15';
      document.getElementById('momoCardOtp').value = '123456';
    }

    function confirmMomoPayment(type) {
      document.getElementById('momoFormAction').value = 'success';
      document.getElementById('paymentView').style.display = 'none';
      document.getElementById('momoSuccessView').style.display = 'block';
      setTimeout(() => {
        document.getElementById('momoForm').submit();
      }, 1200);
    }

    function cancelMomoPayment() {
      document.getElementById('momoFormAction').value = 'cancel';
      document.getElementById('paymentView').style.display = 'none';
      document.getElementById('momoFailedView').style.display = 'block';
      setTimeout(() => {
        document.getElementById('momoForm').submit();
      }, 1200);
    }
  </script>
</body>
</html>`;
    return res.type('html').send(html);
}

function mockMomoProcess(req, res) {
    const config = momoConfig();
    const action = req.body?.action || 'success';
    const fields = { ...req.body };
    delete fields.action;

    const returnUrl = fields.redirectUrl || config.returnUrl;
    const isSuccess = action === 'success';

    const responseFields = {
        partnerCode: fields.partnerCode || config.partnerCode || 'MOMO',
        orderId: fields.orderId || fields.requestId || '',
        requestId: fields.requestId || fields.orderId || '',
        amount: fields.amount || '0',
        orderInfo: fields.orderInfo || 'Thanh toan don Giftly',
        orderType: 'momo_wallet',
        transId: String(Date.now()),
        resultCode: isSuccess ? '0' : '1006',
        message: isSuccess ? 'Giao dịch thành công.' : 'Người dùng hủy giao dịch.',
        payType: 'qr',
        responseTime: String(Date.now()),
        extraData: fields.extraData || '',
        accessKey: config.accessKey || 'F8BBA842ECF85'
    };

    const signature = momo.signCallbackResponse(responseFields, config.secretKey || 'mock_secret');
    responseFields.signature = signature;

    const query = new URLSearchParams(responseFields);
    return res.redirect(`${returnUrl}?${query.toString()}`);
}

module.exports = {
    methods,
    startVnpay,
    vnpayIpn,
    vnpayReturn,
    mockVnpayPage,
    mockVnpayProcess,
    startMomo,
    momoReturn,
    momoIpn,
    mockMomoPage,
    mockMomoProcess
};
