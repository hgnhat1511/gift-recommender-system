'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedOrigin } = require('../utils/corsPolicy');

test('development CORS accepts localhost origins when Vite falls back to another port', () => {
    assert.equal(isAllowedOrigin('http://localhost:5174', { nodeEnv: 'development' }), true);
    assert.equal(isAllowedOrigin('http://127.0.0.1:4173', { nodeEnv: 'development' }), true);
    assert.equal(isAllowedOrigin('https://[::1]:5173', { nodeEnv: 'development' }), true);
});

test('production CORS accepts only configured origins', () => {
    const options = { nodeEnv: 'production', allowedOrigins: ['https://giftly.example'] };
    assert.equal(isAllowedOrigin('https://giftly.example', options), true);
    assert.equal(isAllowedOrigin('http://localhost:5174', options), false);
    assert.equal(isAllowedOrigin('https://attacker.example', options), false);
});

test('non-browser requests without an Origin header remain allowed', () => {
    assert.equal(isAllowedOrigin(undefined, { nodeEnv: 'production' }), true);
});
