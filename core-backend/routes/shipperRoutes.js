const express = require('express');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');
const shipper = require('../controllers/shipperController');
const { uploadDeliveryProof } = require('../controllers/deliveryProofController');

const router = express.Router();
router.use(requireAuth, requireRole('SHIPPER'));
router.get('/orders', shipper.listOrders);
router.post('/orders/:id/dispatch', shipper.dispatchOrder);
router.post('/orders/:id/deliver', shipper.deliverOrder);
router.post('/orders/:id/fail', shipper.failOrder);
router.post('/orders/:id/proof', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' }), uploadDeliveryProof);
module.exports = router;
