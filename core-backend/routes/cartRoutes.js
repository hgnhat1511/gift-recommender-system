const express = require('express');
const cart = require('../controllers/cartController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);
router.get('/', cart.list);
router.post('/items', cart.add);
router.post('/merge', cart.merge);
router.patch('/items/:itemId', cart.update);
router.patch('/items/:itemId/selection', cart.updateSelection);
router.delete('/items/:itemId', cart.remove);
router.delete('/', cart.clear);
module.exports = router;
