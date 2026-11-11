'use strict';

function isLoopbackOrigin(origin) {
    try {
        const parsed = new URL(origin);
        return parsed.origin === origin &&
            ['http:', 'https:'].includes(parsed.protocol) &&
            ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    } catch {
        return false;
    }
}

function isAllowedOrigin(origin, { nodeEnv = process.env.NODE_ENV, allowedOrigins = [] } = {}) {
    if (!origin) return true;
    if (allowedOrigins.includes(origin)) return true;
    return nodeEnv !== 'production' && isLoopbackOrigin(origin);
}

module.exports = { isAllowedOrigin, isLoopbackOrigin };
