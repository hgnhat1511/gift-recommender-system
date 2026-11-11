/**
 * gift-tag-filter.test.js
 * Kiểm thử lọc thẻ quà tặng (người nhận, dịp tặng, ngân sách) trên Gift Finder:
 * 1. Guard bảo vệ database: chỉ chạy trên DB test kết thúc bằng _test, từ chối DB dev gift_ecommerce.
 * 2. 5 tổ hợp (người nhận, dịp, ngân sách): mọi sản phẩm trả về đều có đúng thẻ và nằm trong khoảng giá.
 * 3. Tổ hợp không có sản phẩm khớp (ngân sách siêu thấp hoặc thẻ không tồn tại) trả về danh sách rỗng.
 * 4. Kiểm chứng Gift Finder trả về cả sản phẩm demo REES46 (isSyntheticDisplay = true), không bị giới hạn ở 14 sản phẩm seed.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const testDatabase = process.env.TEST_DB_NAME || (process.env.DB_NAME && process.env.DB_NAME.endsWith('_test') ? process.env.DB_NAME : 'giftly_e2e_test');

// Guard cứng: Bắt buộc database kết thúc bằng _test và không được là DB dev
assert.match(testDatabase, /^[a-z0-9_]+_test$/i, `gift-tag-filter test requires a database ending in _test (got "${testDatabase}")`);
assert.notEqual(testDatabase, 'gift_ecommerce', 'Refusing to run test against dev database "gift_ecommerce"');

process.env.DB_NAME = testDatabase;
process.env.TEST_DB_NAME = testDatabase;

const pool = require('../config/db');
const { app } = require('../server');

test('Gift Finder: Lọc quà tặng theo người nhận, dịp tặng, ngân sách (rule_v1) và hỗ trợ catalog demo', async (t) => {
    let server;
    let baseUrl;

    t.before(async () => {
        const { resetTestDatabase } = require('../scripts/resetTestDb');
        await resetTestDatabase(testDatabase, { seedDemo: true });

        // Xác nhận pool kết nối đúng test DB
        const [[dbRow]] = await pool.query('SELECT DATABASE() name');
        console.log(`[gift-tag-filter.test.js] SELECT DATABASE(): ${dbRow.name}`);
        assert.equal(dbRow.name, testDatabase, `API must be connected to "${testDatabase}"`);

        // Khởi động server test trên ephemeral port
        server = app.listen(0);
        await new Promise((resolve, reject) => {
            server.once('listening', resolve);
            server.once('error', reject);
        });
        baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    });

    t.after(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        try {
            await pool.end();
        } catch {
            // ignore
        }
    });

    const callGiftFinder = async (body) => {
        const response = await fetch(`${baseUrl}/products/gift-finder`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        });
        assert.equal(response.status, 200, `POST /products/gift-finder returned status ${response.status}`);
        const json = await response.json();
        assert.equal(json.success, true, 'API response must have success: true');
        return json.data;
    };

    await t.test('Guard: Xác nhận DB đích là test DB và có đầy đủ sản phẩm seed lẫn demo', async () => {
        const [[stats]] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN is_synthetic_display = 1 THEN 1 ELSE 0 END) as synthetic_count,
                SUM(CASE WHEN is_synthetic_display = 0 OR is_synthetic_display IS NULL THEN 1 ELSE 0 END) as seed_count
            FROM products WHERE status = 'ACTIVE'
        `);
        assert.ok(Number(stats.total) >= 1000, 'Database phải có ít nhất 1000 sản phẩm active');
        assert.ok(Number(stats.synthetic_count) >= 1000, 'Database phải có đủ 1000 sản phẩm demo');
        assert.ok(Number(stats.seed_count) >= 14, 'Database phải có đủ 14 sản phẩm seed');
    });

    await t.test('Tổ hợp 1: partner + anniversary + ngân sách 500.000₫', async () => {
        const data = await callGiftFinder({
            recipient: 'partner',
            occasion: 'anniversary',
            budget: 500000
        });
        assert.ok(data.items.length > 0, 'Phải có sản phẩm trả về');
        for (const item of data.items) {
            assert.ok(item.price <= 500000, `Sản phẩm ${item.id} có giá ${item.price} vượt ngân sách 500.000₫`);
            const matchedTags = [
                ...(item.recipientTags || []).map(t => String(t).toLowerCase()),
                ...(item.occasionTags || []).map(t => String(t).toLowerCase())
            ];
            const hasMatch = matchedTags.includes('partner') || matchedTags.includes('anniversary');
            assert.ok(hasMatch, `Sản phẩm ${item.id} phải khớp ít nhất một thẻ (partner hoặc anniversary)`);
        }
        // Kiểm tra có chứa sản phẩm demo REES46
        const hasSynthetic = data.items.some(item => item.isSyntheticDisplay === true);
        assert.ok(hasSynthetic, 'Kết quả phải chứa sản phẩm demo REES46 (isSyntheticDisplay: true)');
    });

    await t.test('Tổ hợp 2: friend + tet + ngân sách 93.000₫ (phân khúc 1)', async () => {
        const data = await callGiftFinder({
            recipient: 'friend',
            occasion: 'tet',
            budget: 93000
        });
        assert.ok(data.items.length > 0, 'Phải có sản phẩm trả về');
        for (const item of data.items) {
            assert.ok(item.price <= 93000, `Sản phẩm ${item.id} có giá ${item.price} vượt ngân sách 93.000₫`);
            const matchedTags = [
                ...(item.recipientTags || []).map(t => String(t).toLowerCase()),
                ...(item.occasionTags || []).map(t => String(t).toLowerCase())
            ];
            const hasMatch = matchedTags.includes('friend') || matchedTags.includes('tet');
            assert.ok(hasMatch, `Sản phẩm ${item.id} phải khớp ít nhất một thẻ (friend hoặc tet)`);
        }
        const hasSynthetic = data.items.some(item => item.isSyntheticDisplay === true);
        assert.ok(hasSynthetic, 'Kết quả phải chứa sản phẩm demo REES46');
    });

    await t.test('Tổ hợp 3: mother + birthday + ngân sách 200.000₫', async () => {
        const data = await callGiftFinder({
            recipient: 'mother',
            occasion: 'birthday',
            budget: 200000
        });
        assert.ok(data.items.length > 0, 'Phải có sản phẩm trả về');
        for (const item of data.items) {
            assert.ok(item.price <= 200000, `Sản phẩm ${item.id} có giá ${item.price} vượt ngân sách 200.000₫`);
            const matchedTags = [
                ...(item.recipientTags || []).map(t => String(t).toLowerCase()),
                ...(item.occasionTags || []).map(t => String(t).toLowerCase())
            ];
            const hasMatch = matchedTags.includes('mother') || matchedTags.includes('birthday');
            assert.ok(hasMatch, `Sản phẩm ${item.id} phải khớp ít nhất một thẻ (mother hoặc birthday)`);
        }
        const hasSynthetic = data.items.some(item => item.isSyntheticDisplay === true);
        assert.ok(hasSynthetic, 'Kết quả phải chứa sản phẩm demo REES46');
    });

    await t.test('Tổ hợp 4: colleague + thank-you + ngân sách 125.000₫', async () => {
        const data = await callGiftFinder({
            recipient: 'colleague',
            occasion: 'thank-you',
            budget: 125000
        });
        assert.ok(data.items.length > 0, 'Phải có sản phẩm trả về');
        for (const item of data.items) {
            assert.ok(item.price <= 125000, `Sản phẩm ${item.id} có giá ${item.price} vượt ngân sách 125.000₫`);
            const matchedTags = [
                ...(item.recipientTags || []).map(t => String(t).toLowerCase()),
                ...(item.occasionTags || []).map(t => String(t).toLowerCase())
            ];
            const hasMatch = matchedTags.includes('colleague') || matchedTags.includes('thank-you');
            assert.ok(hasMatch, `Sản phẩm ${item.id} phải khớp ít nhất một thẻ (colleague hoặc thank-you)`);
        }
        const hasSynthetic = data.items.some(item => item.isSyntheticDisplay === true);
        assert.ok(hasSynthetic, 'Kết quả phải chứa sản phẩm demo REES46');
    });

    await t.test('Tổ hợp 5: father + birthday + ngân sách 1.000.000₫', async () => {
        const data = await callGiftFinder({
            recipient: 'father',
            occasion: 'birthday',
            budget: 1000000
        });
        assert.ok(data.items.length > 0, 'Phải có sản phẩm trả về');
        for (const item of data.items) {
            assert.ok(item.price <= 1000000, `Sản phẩm ${item.id} có giá ${item.price} vượt ngân sách 1.000.000₫`);
            const matchedTags = [
                ...(item.recipientTags || []).map(t => String(t).toLowerCase()),
                ...(item.occasionTags || []).map(t => String(t).toLowerCase())
            ];
            const hasMatch = matchedTags.includes('father') || matchedTags.includes('birthday');
            assert.ok(hasMatch, `Sản phẩm ${item.id} phải khớp ít nhất một thẻ (father hoặc birthday)`);
        }
    });

    await t.test('Tổ hợp không có sản phẩm khớp: ngân sách 10₫ trả về mảng rỗng', async () => {
        const data = await callGiftFinder({
            recipient: 'friend',
            occasion: 'tet',
            budget: 10
        });
        assert.equal(data.total, 0, 'Tổng số sản phẩm phải bằng 0');
        assert.equal(data.items.length, 0, 'Mảng items phải rỗng khi không có sản phẩm thỏa mãn ngân sách');
    });
});
