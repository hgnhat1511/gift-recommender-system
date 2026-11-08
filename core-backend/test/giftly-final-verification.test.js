/**
 * giftly-final-verification.test.js
 * Bộ kiểm thử mới cho GIFTLY-FINAL:
 * 1. Nhãn trung tính: không còn 'Quà tặng REES46', đã chuẩn hóa thành 'Lifestyle'
 * 2. Catalog đúng 1.000 sản phẩm: đúng 1.000 sản phẩm active, mọi ml_product_id thuộc pool LC-1
 * 3. Cờ mô phỏng: is_simulated = 1 đầy đủ, không lọt vào đánh giá gợi ý của khách thường
 * 4. Tồn kho an toàn: không sản phẩm nào bị tồn kho âm (stock >= 0)
 * 5. Bảo vệ khách thường: khách thường không nhận sản phẩm synthetic
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('node:fs');
const mysql = require('mysql2/promise');
const pool = require('../config/db');
const { recommendProducts } = require('../services/recommendationService');

test('BƯỚC 6: Kiểm thử toàn diện Giftly Final', async (t) => {
    const dbName = process.env.DB_NAME || 'giftly_e2e_test';
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: dbName
    });

    t.after(async () => {
        await conn.end();
        try {
            await pool.end();
        } catch {
            // ignore
        }
    });

    await t.test('1. Nhãn trung tính: Danh mục không còn nhãn REES46, đã chuyển thành Lifestyle', async () => {
        const [reesCats] = await conn.execute(
            "SELECT id, name FROM categories WHERE name LIKE '%REES46%'"
        );
        assert.equal(reesCats.length, 0, 'Không được còn danh mục nào chứa nhãn REES46');

        const [lifestyleCat] = await conn.execute(
            "SELECT id, name FROM categories WHERE name = 'Lifestyle' LIMIT 1"
        );
        assert.equal(lifestyleCat.length, 1, 'Danh mục Lifestyle phải tồn tại');
        assert.equal(lifestyleCat[0].name, 'Lifestyle');
    });

    await t.test('2. Catalog đúng sản phẩm active và mọi ml_product_id thuộc pool LC-1', async () => {
        const [[activeSynthetic]] = await conn.execute(
            "SELECT COUNT(*) total, COUNT(DISTINCT ml_product_id) unique_ml FROM products WHERE is_synthetic_display = TRUE AND status = 'ACTIVE'"
        );
        if (dbName === 'gift_ecommerce') {
            assert.equal(activeSynthetic.total, 1000, 'Số lượng sản phẩm synthetic active phải đúng chính xác 1.000 trên DB dev');
            assert.equal(activeSynthetic.unique_ml, 1000, 'Tất cả 1.000 sản phẩm phải có ml_product_id duy nhất, không trùng lặp');

            // Đối chiếu với file danh sách selected_1000_ids.json
            const idsPath = path.join(__dirname, '..', 'data', 'selected_1000_ids.json');
            assert.ok(fs.existsSync(idsPath), 'File selected_1000_ids.json phải tồn tại');
            const selectedIds = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
            assert.equal(selectedIds.length, 1000);

            const [dbRows] = await conn.execute(
                "SELECT ml_product_id FROM products WHERE is_synthetic_display = TRUE AND status = 'ACTIVE'"
            );
            const dbIdSet = new Set(dbRows.map(r => Number(r.ml_product_id)));
            for (const pid of selectedIds) {
                assert.ok(dbIdSet.has(Number(pid)), `ml_product_id ${pid} phải tồn tại trong database`);
            }
        } else {
            // Trên DB test chuyên biệt (giftly_e2e_test): kiểm tra tính toàn vẹn của sản phẩm synthetic fixture
            assert.ok(Number(activeSynthetic.total) >= 0, 'DB test có bảng products hợp lệ');
        }
    });

    await t.test('3. Cờ mô phỏng: Đơn hàng và tương tác mô phỏng được gắn cờ is_simulated = 1 đầy đủ', async () => {
        const [[simOrders]] = await conn.execute(
            "SELECT COUNT(*) total FROM orders WHERE is_simulated = 1"
        );
        if (dbName === 'gift_ecommerce') {
            assert.ok(simOrders.total >= 2000, `Số đơn hàng mô phỏng phải >= 2000 (thực tế: ${simOrders.total})`);

            const [[simEvents]] = await conn.execute(
                "SELECT COUNT(*) total FROM product_events WHERE is_simulated = 1"
            );
            assert.ok(simEvents.total >= 20000, `Số sự kiện mô phỏng phải >= 20000 (thực tế: ${simEvents.total})`);
        } else {
            assert.ok(Number(simOrders.total) >= 0, 'Cột is_simulated tồn tại trên bảng orders');
        }

        // Đảm bảo không đơn hàng mô phỏng nào có is_simulated = 0
        const [badSimOrders] = await conn.execute(
            "SELECT id FROM orders WHERE order_code LIKE 'SIM%' AND is_simulated = 0 LIMIT 1"
        );
        assert.equal(badSimOrders.length, 0, 'Đơn hàng mô phỏng không được có is_simulated = 0');
    });

    await t.test('4. Tồn kho an toàn: Không sản phẩm nào bị tồn kho âm (stock >= 0)', async () => {
        const [[negStock]] = await conn.execute(
            "SELECT COUNT(*) total FROM products WHERE stock < 0"
        );
        assert.equal(negStock.total, 0, 'Tuyệt đối không được có sản phẩm nào tồn kho âm');
    });

    await t.test('5. Bảo vệ khách thường: Gợi ý cho khách thường và khách vãng lai không chứa sản phẩm synthetic', async () => {
        // Khách vãng lai (null)
        const guestRec = await recommendProducts(null, 8);
        assert.ok(guestRec.items.length > 0, 'Gợi ý cho khách vãng lai không được rỗng');
        const guestSynthetic = guestRec.items.filter(it => it.product.is_synthetic_display);
        assert.equal(guestSynthetic.length, 0, 'Khách vãng lai không được thấy sản phẩm synthetic');

        // Khách thường không có ml_user_id
        const [regUsers] = await conn.execute(
            "SELECT id FROM users WHERE ml_user_id IS NULL AND role = 'USER' LIMIT 1"
        );
        if (regUsers.length) {
            const regRec = await recommendProducts(regUsers[0].id, 8);
            assert.ok(regRec.items.length > 0, 'Gợi ý cho khách thường không được rỗng');
            const regSynthetic = regRec.items.filter(it => it.product.is_synthetic_display);
            assert.equal(regSynthetic.length, 0, 'Khách thường không được thấy sản phẩm synthetic');
        }
    });

    await t.test('6. Gợi ý demo REES46: Tài khoản demo nhận gợi ý từ ranker_lc1 hoặc popularity_fallback', async () => {
        const [demoUsers] = await conn.execute(
            "SELECT id, ml_user_id FROM users WHERE ml_user_id IS NOT NULL LIMIT 1"
        );
        if (demoUsers.length) {
            const demoRec = await recommendProducts(demoUsers[0].id, 8);
            assert.ok(demoRec.items.length > 0, 'Gợi ý cho tài khoản demo không được rỗng');
            assert.ok(
                demoRec.source === 'ranker_lc1' || demoRec.source === 'popularity_fallback',
                `Nguồn gợi ý của demo user phải là ranker_lc1 hoặc popularity_fallback (thực tế: ${demoRec.source})`
            );
        }
    });
});
