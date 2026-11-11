const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { getDeliveryProof } = require('../controllers/deliveryProofController');

const router = express.Router();
router.use(requireAuth);
router.get('/:orderId', getDeliveryProof);
module.exports = router;
