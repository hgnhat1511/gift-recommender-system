const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');

async function requireAuth(req, res, next) {
    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    if (!match) return res.status(401).json({ success: false, message: 'Authentication required' });

    try {
        const claims = jwt.verify(match[1], process.env.JWT_SECRET, {
            algorithms: ['HS256'], issuer: 'giftly-api', audience: 'giftly-client'
        });
        if (typeof claims.sub !== 'string' || !claims.sub) {
            return res.status(401).json({ success: false, message: 'Invalid or expired token' });
        }
        const user = await userModel.findPublicById(claims.sub);
        if (!user || user.status !== 'ACTIVE') {
            return res.status(401).json({ success: false, message: 'Invalid or expired token' });
        }
        req.user = user;
        return next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' || error.name === 'NotBeforeError') {
            return res.status(401).json({ success: false, message: 'Invalid or expired token' });
        }
        return next(error);
    }
}

async function optionalAuth(req, res, next) {
    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    if (!match) return next();
    try {
        const claims = jwt.verify(match[1], process.env.JWT_SECRET, {
            algorithms: ['HS256'], issuer: 'giftly-api', audience: 'giftly-client'
        });
        if (typeof claims.sub === 'string') {
            const user = await userModel.findPublicById(claims.sub);
            if (user?.status === 'ACTIVE') req.user = user;
        }
    } catch {
        // Public catalog stays available when an optional token is missing or invalid.
    }
    return next();
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
        if (!roles.includes(req.user.role)) return res.status(403).json({ success: false, message: 'Insufficient permissions' });
        return next();
    };
}

module.exports = { requireAuth, optionalAuth, requireRole };
