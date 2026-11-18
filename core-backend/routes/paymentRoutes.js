const express = require('express');
const controller = require('../controllers/paymentController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
router.get('/methods', controller.methods);

// VNPAY routes
router.post('/orders/:orderId/vnpay', requireAuth, controller.startVnpay);
router.get('/vnpay/ipn', controller.vnpayIpn);
router.get('/vnpay/return', controller.vnpayReturn);
router.get('/mock-vnpay', controller.mockVnpayPage);
router.post('/mock-vnpay/process', express.urlencoded({ extended: true }), controller.mockVnpayProcess);

// MoMo routes
router.post('/orders/:orderId/momo', requireAuth, controller.startMomo);
router.get('/momo/return', controller.momoReturn);
router.post('/momo/ipn', express.json(), controller.momoIpn);
router.get('/mock-momo', controller.mockMomoPage);
router.post('/mock-momo/process', express.urlencoded({ extended: true }), controller.mockMomoProcess);

module.exports = router;
