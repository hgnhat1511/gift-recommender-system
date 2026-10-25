const express = require('express');
const controller = require('../controllers/paymentController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
router.get('/methods',controller.methods);
router.post('/orders/:orderId/vnpay',requireAuth,controller.startVnpay);
router.get('/vnpay/ipn',controller.vnpayIpn);
router.get('/vnpay/return',controller.vnpayReturn);

module.exports = router;
