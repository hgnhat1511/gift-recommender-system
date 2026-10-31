'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('DB Guard: TEST_DB_NAME bắt buộc phải kết thúc bằng _test để bảo vệ DB dev', () => {
  const validateTestDb = (name) => {
    if (name == null) return null;
    const trimmed = String(name).trim();
    if (!trimmed) return null;
    if (!/^[a-z0-9_]+_test$/i.test(trimmed)) {
      throw new Error(`TEST_DB_NAME must end with _test to ensure isolation (got "${trimmed}")`);
    }
    return trimmed;
  };

  // 1. Từ chối DB dev và các tên không kết thúc bằng _test
  assert.throws(() => validateTestDb('gift_ecommerce'), /TEST_DB_NAME must end with _test/);
  assert.throws(() => validateTestDb('giftly_production'), /TEST_DB_NAME must end with _test/);
  assert.throws(() => validateTestDb('giftly_dev'), /TEST_DB_NAME must end with _test/);
  assert.throws(() => validateTestDb('test_database'), /TEST_DB_NAME must end with _test/);
  assert.throws(() => validateTestDb('invalid-test'), /TEST_DB_NAME must end with _test/);

  // 2. Chấp nhận các tên DB test hợp lệ kết thúc bằng _test
  assert.equal(validateTestDb('giftly_verification_test'), 'giftly_verification_test');
  assert.equal(validateTestDb('gift_ecommerce_test'), 'gift_ecommerce_test');
  assert.equal(validateTestDb('ci_run_123_test'), 'ci_run_123_test');
});
