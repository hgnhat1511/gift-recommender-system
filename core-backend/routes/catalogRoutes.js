const express = require('express');
const catalog = require('../controllers/catalogController');
const reviews = require('../controllers/reviewController');
const { optionalAuth } = require('../middleware/authMiddleware');

const router = express.Router();
router.get('/categories', catalog.categories);
router.get('/lookup', catalog.lookup);
router.get('/banners', catalog.banners);
router.get('/recommendations', optionalAuth, catalog.recommendations);
router.post('/gift-finder', catalog.finder);
router.post('/events', optionalAuth, catalog.track);
router.get('/', catalog.list);
router.get('/:id/reviews', reviews.listForProduct);
router.post('/:id/reviews', require('../middleware/authMiddleware').requireAuth, reviews.create);
router.get('/:id', optionalAuth, catalog.detail);
module.exports = router;
