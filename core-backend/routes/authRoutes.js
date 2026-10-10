const express = require('express');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
const loginAttempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function limitLoginAttempts(req, res, next) {
    const now = Date.now();
    if (loginAttempts.size > 5000) {
        for (const [ip, attempt] of loginAttempts) {
            if (now - attempt.startedAt >= WINDOW_MS) loginAttempts.delete(ip);
        }
    }
    const key = req.ip;
    let record = loginAttempts.get(key);
    if (!record || now - record.startedAt >= WINDOW_MS) {
        record = { startedAt: now, count: 0 };
        loginAttempts.set(key, record);
    }
    if (record.count >= MAX_ATTEMPTS) {
        res.set('Retry-After', String(Math.ceil((WINDOW_MS - (now - record.startedAt)) / 1000)));
        return res.status(429).json({ success: false, message: 'Too many login attempts. Please try again later.' });
    }
    record.count += 1;
    return next();
}

router.post('/register', authController.register);
router.post('/login', limitLoginAttempts, authController.login);
router.get('/me', requireAuth, authController.me);
router.post('/logout', requireAuth, authController.logout);

module.exports = router;
