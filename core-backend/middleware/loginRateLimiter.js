function createLoginRateLimiter({ windowMs = 15 * 60 * 1000, maxAttempts = 10 } = {}) {
    const attempts = new Map();

    return function limitLoginAttempts(req, res, next) {
        const now = Date.now();
        if (attempts.size > 5000) {
            for (const [ip, record] of attempts) {
                if (now - record.startedAt >= windowMs || record.count <= 0) attempts.delete(ip);
            }
        }

        const key = req.ip;
        let record = attempts.get(key);
        if (!record || now - record.startedAt >= windowMs) {
            record = { startedAt: now, count: 0 };
            attempts.set(key, record);
        }
        if (record.count >= maxAttempts) {
            res.set('Retry-After', String(Math.ceil((windowMs - (now - record.startedAt)) / 1000)));
            return res.status(429).json({ success: false, message: 'Too many login attempts. Please try again later.' });
        }

        record.count += 1;
        res.once('finish', () => {
            if (res.statusCode >= 400 || attempts.get(key) !== record) return;
            record.count = Math.max(0, record.count - 1);
            if (record.count === 0) attempts.delete(key);
        });
        return next();
    };
}

module.exports = createLoginRateLimiter;
