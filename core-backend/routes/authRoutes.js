const express = require('express');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');
const createLoginRateLimiter = require('../middleware/loginRateLimiter');

const router = express.Router();
const limitLoginAttempts = createLoginRateLimiter();

router.post('/register', authController.register);
router.post('/login', limitLoginAttempts, authController.login);
router.get('/me', requireAuth, authController.me);
router.post('/logout', requireAuth, authController.logout);

module.exports = router;
