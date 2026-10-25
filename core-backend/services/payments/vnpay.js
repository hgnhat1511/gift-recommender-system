const crypto = require('node:crypto');

const SANDBOX_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';

function sortedFields(input) {
    return Object.fromEntries(Object.entries(input)
        .filter(([key, value]) => key.startsWith('vnp_') && key !== 'vnp_SecureHash' && key !== 'vnp_SecureHashType' && value != null && value !== '')
        .map(([key, value]) => {
            if (Array.isArray(value) || typeof value === 'object') throw new TypeError('Invalid VNPAY parameter.');
            return [key, String(value)];
        })
        .sort(([left], [right]) => left.localeCompare(right)));
}

function signatureData(fields) {
    return Object.entries(sortedFields(fields)).map(([key, value]) => `${key}=${value}`).join('&');
}

function sign(fields, secret) {
    if (typeof secret !== 'string' || !secret) throw new Error('VNPAY hash secret is not configured.');
    return crypto.createHmac('sha512', secret).update(signatureData(fields), 'utf8').digest('hex');
}

function verify(fields, secret) {
    const received = fields?.vnp_SecureHash;
    if (typeof received !== 'string' || !/^[a-f\d]{128}$/i.test(received)) return false;
    try {
        const expected = sign(fields, secret);
        return crypto.timingSafeEqual(Buffer.from(received.toLowerCase(), 'ascii'), Buffer.from(expected, 'ascii'));
    } catch { return false; }
}

function vnDate(date) {
    const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    return shifted.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

function createPaymentUrl({ amountVnd, txnRef, orderCode, ipAddress, config, now = new Date() }) {
    if (!config?.tmnCode || !config?.hashSecret || !config?.returnUrl) throw new Error('VNPAY sandbox is not configured.');
    if (!Number.isSafeInteger(amountVnd) || amountVnd < 1 || amountVnd * 100 > 999999999999 || !/^[A-Za-z0-9_-]{1,100}$/.test(txnRef)) throw new TypeError('Invalid payment details.');
    const fields = {
        vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: config.tmnCode,
        vnp_Amount: String(amountVnd * 100), vnp_CurrCode: 'VND', vnp_TxnRef: txnRef,
        vnp_OrderInfo: `Thanh toan don Giftly ${orderCode}`.slice(0, 255), vnp_OrderType: 'other',
        vnp_Locale: 'vn', vnp_ReturnUrl: config.returnUrl,
        vnp_IpAddr: typeof ipAddress === 'string' && ipAddress.length <= 45 ? ipAddress : '127.0.0.1',
        vnp_CreateDate: vnDate(now), vnp_ExpireDate: vnDate(new Date(now.getTime() + 15 * 60 * 1000))
    };
    const ordered = sortedFields(fields);
    const query = new URLSearchParams(ordered);
    query.set('vnp_SecureHash', sign(fields, config.hashSecret));
    return `${config.paymentUrl || SANDBOX_URL}?${query.toString()}`;
}

function configFromEnv(env = process.env) {
    return {
        tmnCode: env.VNPAY_TMN_CODE,
        hashSecret: env.VNPAY_HASH_SECRET,
        returnUrl: env.VNPAY_RETURN_URL,
        paymentUrl: env.VNPAY_PAYMENT_URL || SANDBOX_URL
    };
}

function isConfigured(config = configFromEnv()) {
    return Boolean(config.tmnCode && config.hashSecret && config.returnUrl);
}

module.exports = { SANDBOX_URL, sortedFields, signatureData, sign, verify, createPaymentUrl, configFromEnv, isConfigured };
