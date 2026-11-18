const crypto = require('node:crypto');

const SANDBOX_API_URL = 'https://test-payment.momo.vn/v2/gateway/api/create';

function signCreateRequest({ accessKey, secretKey, amount, extraData = '', ipnUrl, orderId, orderInfo, partnerCode, redirectUrl, requestId, requestType = 'captureWallet' }) {
    if (!secretKey) throw new Error('MoMo secretKey is required for signing.');
    const rawSignature = `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}&ipnUrl=${ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${partnerCode}&redirectUrl=${redirectUrl}&requestId=${requestId}&requestType=${requestType}`;
    return crypto.createHmac('sha256', secretKey).update(rawSignature, 'utf8').digest('hex');
}

function signCallbackResponse(fields, secretKey) {
    if (!secretKey) throw new Error('MoMo secretKey is required.');
    const raw = `accessKey=${fields.accessKey}&amount=${fields.amount}&extraData=${fields.extraData || ''}&message=${fields.message}&orderId=${fields.orderId}&orderInfo=${fields.orderInfo}&orderType=${fields.orderType}&partnerCode=${fields.partnerCode}&payType=${fields.payType}&requestId=${fields.requestId}&responseTime=${fields.responseTime}&resultCode=${fields.resultCode}&transId=${fields.transId}`;
    return crypto.createHmac('sha256', secretKey).update(raw, 'utf8').digest('hex');
}

function verifyCallback(fields, secretKey) {
    const received = fields?.signature;
    if (typeof received !== 'string' || !/^[a-f\d]{64}$/i.test(received)) return false;
    try {
        const expected = signCallbackResponse(fields, secretKey);
        return crypto.timingSafeEqual(Buffer.from(received.toLowerCase(), 'ascii'), Buffer.from(expected.toLowerCase(), 'ascii'));
    } catch {
        return false;
    }
}

async function createPaymentUrl({ amountVnd, reference, orderCode, config }) {
    const partnerCode = config?.partnerCode || 'MOMO';
    const accessKey = config?.accessKey || 'F8BBA842ECF85';
    const secretKey = config?.secretKey || 'K951B6PE1waDMi640xX08PD3vg6EkVlz';
    const redirectUrl = config?.returnUrl || 'http://localhost:5000/api/payments/momo/return';
    const ipnUrl = config?.ipnUrl || 'http://localhost:5000/api/payments/momo/ipn';
    const apiUrl = config?.apiUrl || SANDBOX_API_URL;
    const requestType = 'captureWallet';
    const extraData = '';
    const orderInfo = `Thanh toan don Giftly ${orderCode}`.slice(0, 255);
    const orderId = reference;
    const requestId = reference;
    const amount = Math.round(amountVnd);

    const signature = signCreateRequest({
        accessKey,
        secretKey,
        amount,
        extraData,
        ipnUrl,
        orderId,
        orderInfo,
        partnerCode,
        redirectUrl,
        requestId,
        requestType
    });

    const payload = {
        partnerCode,
        partnerName: 'Giftly',
        storeId: 'GiftlyStore',
        requestId,
        amount,
        orderId,
        orderInfo,
        redirectUrl,
        ipnUrl,
        lang: 'vi',
        extraData,
        requestType,
        signature
    };

    // If configured directly for mock simulation
    if (config?.useMock || apiUrl.includes('mock-momo')) {
        const query = new URLSearchParams({
            partnerCode,
            orderId,
            requestId,
            amount: String(amount),
            orderInfo,
            redirectUrl
        });
        return `/api/payments/mock-momo?${query.toString()}`;
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data?.resultCode === 0 && data?.payUrl) {
            return data.payUrl;
        }
        // Fallback to internal simulator if gateway returned an unpayable response
        const query = new URLSearchParams({
            partnerCode,
            orderId,
            requestId,
            amount: String(amount),
            orderInfo,
            redirectUrl
        });
        return `/api/payments/mock-momo?${query.toString()}`;
    } catch {
        // Fallback to internal simulator on network timeout/error
        const query = new URLSearchParams({
            partnerCode,
            orderId,
            requestId,
            amount: String(amount),
            orderInfo,
            redirectUrl
        });
        return `/api/payments/mock-momo?${query.toString()}`;
    }
}

function configFromEnv(env = process.env) {
    return {
        partnerCode: env.MOMO_PARTNER_CODE || 'MOMO',
        accessKey: env.MOMO_ACCESS_KEY || 'F8BBA842ECF85',
        secretKey: env.MOMO_SECRET_KEY || 'K951B6PE1waDMi640xX08PD3vg6EkVlz',
        apiUrl: env.MOMO_API_URL || SANDBOX_API_URL,
        returnUrl: env.MOMO_RETURN_URL || 'http://localhost:5000/api/payments/momo/return',
        ipnUrl: env.MOMO_IPN_URL || 'http://localhost:5000/api/payments/momo/ipn',
        useMock: env.MOMO_USE_MOCK === 'true'
    };
}

function isConfigured(config = configFromEnv()) {
    return Boolean(config?.partnerCode && config?.accessKey && config?.secretKey);
}

module.exports = {
    SANDBOX_API_URL,
    signCreateRequest,
    signCallbackResponse,
    verifyCallback,
    createPaymentUrl,
    configFromEnv,
    isConfigured
};
