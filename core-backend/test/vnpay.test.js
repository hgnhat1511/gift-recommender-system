const test = require('node:test');
const assert = require('node:assert/strict');
const { sign,verify,createPaymentUrl,signatureData } = require('../services/payments/vnpay');

const secret='unit-test-secret-only';

test('VNPAY signature excludes the supplied hash and verifies signed callback fields',()=>{
    const fields={vnp_TxnRef:'GLABC123',vnp_Amount:'12500000',vnp_ResponseCode:'00',vnp_SecureHashType:'HMACSHA512'};
    fields.vnp_SecureHash=sign(fields,secret);
    assert.equal(verify(fields,secret),true);
    assert.equal(verify({...fields,vnp_Amount:'12500001'},secret),false);
    assert.match(signatureData(fields),/^vnp_Amount=12500000&vnp_ResponseCode=00&vnp_TxnRef=GLABC123$/);
});

test('payment URL uses VND minor units, signed query, and a bounded expiry',()=>{
    const now=new Date('2026-10-12T12:00:00.000Z');
    const config={tmnCode:'ABCDEFGH',hashSecret:secret,returnUrl:'http://localhost:5000/api/payments/vnpay/return'};
    const url=new URL(createPaymentUrl({amountVnd:125000,txnRef:'GLABC123',orderCode:'GL-ORDER',ipAddress:'127.0.0.1',config,now}));
    const fields=Object.fromEntries(url.searchParams.entries());
    assert.equal(url.origin,'https://sandbox.vnpayment.vn');
    assert.equal(fields.vnp_Amount,'12500000');
    assert.equal(fields.vnp_CurrCode,'VND');
    assert.equal(fields.vnp_ExpireDate,'20261012191500');
    assert.equal(verify(fields,secret),true);
});

test('payment URL refuses missing credentials and non-integer VND totals',()=>{
    assert.throws(()=>createPaymentUrl({amountVnd:1000,txnRef:'GL1',orderCode:'GL1',config:{}}),/not configured/);
    const config={tmnCode:'ABCDEFGH',hashSecret:secret,returnUrl:'http://localhost/return'};
    assert.throws(()=>createPaymentUrl({amountVnd:1.5,txnRef:'GL1',orderCode:'GL1',config}),/Invalid payment/);
    assert.throws(()=>createPaymentUrl({amountVnd:1000,txnRef:'bad reference',orderCode:'GL1',config}),/Invalid payment/);
});
