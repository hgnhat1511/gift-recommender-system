const test = require('node:test');
const assert = require('node:assert/strict');
const createLoginRateLimiter = require('../middleware/loginRateLimiter');

function mockResponse() {
    const listeners = new Map();
    return {
        statusCode: 200,
        headers: {},
        body: null,
        once(event, callback) { listeners.set(event, callback); return this; },
        set(name, value) { this.headers[name] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        finish() { listeners.get('finish')?.(); }
    };
}

test('successful login responses release their reserved rate-limit slot', () => {
    const limit = createLoginRateLimiter({ maxAttempts: 2 });
    for (let index = 0; index < 15; index += 1) {
        const response = mockResponse();
        let continued = false;
        limit({ ip: '192.0.2.10' }, response, () => { continued = true; });
        assert.equal(continued, true);
        response.finish();
    }
});

test('failed login responses count toward the limit and return Retry-After', () => {
    const limit = createLoginRateLimiter({ windowMs: 60_000, maxAttempts: 2 });
    for (let index = 0; index < 2; index += 1) {
        const response = mockResponse();
        limit({ ip: '192.0.2.11' }, response, () => {});
        response.status(401);
        response.finish();
    }

    const blocked = mockResponse();
    let continued = false;
    limit({ ip: '192.0.2.11' }, blocked, () => { continued = true; });
    assert.equal(continued, false);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.headers['Retry-After'], '60');
});
