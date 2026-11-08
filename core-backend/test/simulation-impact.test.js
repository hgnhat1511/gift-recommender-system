const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const { askMlRanker, recommendProducts } = require('../services/recommendationService');
const pool = require('../config/db');

// Ràng buộc bảo vệ: Chỉ chạy trên database test chuyên biệt
const testDbName = process.env.DB_NAME || 'giftly_e2e_test';
if (!testDbName.endsWith('_test') || testDbName === 'gift_ecommerce' || testDbName === 'giftly_verification_test') {
    throw new Error(`Từ chối chạy trên DB không an toàn: ${testDbName}. Chỉ cho phép database kết thúc bằng '_test'.`);
}

test('Kiểm chứng B: Đơn mô phỏng có ảnh hưởng gợi ý không (đơn mô phỏng không ảnh hưởng LC-1; ranker dùng snapshot tại 2020-01-15)', async (t) => {
    let conn;
    try {
        conn = await pool.getConnection();
    } catch (err) {
        t.skip(`Không thể kết nối database test ${testDbName}: ${err.message}`);
        return;
    }

    t.after(async () => {
        if (conn) conn.release();
        await pool.end();
    });

    const warmUserId = 27692594; // User có lịch sử trong snapshot validation LC-1
    const candidateIds = [5809910, 5804261, 5804262, 5885786, 5834419];
    const candidateObjects = candidateIds.map(id => ({
        product: { id, ml_product_id: id, name: `Product ${id}`, price: 100000 }
    }));

    await t.test('1. Kiểm chứng trực tiếp tại API Ranker ML (/recommend/rank): kết quả TRƯỚC và SAU khi thêm đơn mô phỏng hoàn toàn giống nhau', async () => {
        // A. Lấy kết quả xếp hạng TRƯỚC khi thêm đơn mô phỏng
        const rankBefore = await askMlRanker(warmUserId, candidateObjects, 5);
        assert.ok(rankBefore, 'ML Service phải phản hồi kết quả');
        assert.equal(rankBefore.source, 'ranker_lc1', 'Nguồn gợi ý cho user có lịch sử phải là ranker_lc1');
        assert.equal(rankBefore.items.length, 5, 'Phải xếp hạng đủ 5 ứng viên');

        const itemsBefore = rankBefore.items.map(item => ({
            id: Number(item.product.ml_product_id ?? item.product.id),
            reasons: item.reasons
        }));

        // B. Thêm 1 đơn hàng mô phỏng mới và sự kiện mô phỏng mới vào database MySQL
        const [userRows] = await conn.execute(
            "SELECT id FROM users LIMIT 1"
        );
        const [prodRows] = await conn.execute(
            "SELECT id FROM products LIMIT 1"
        );
        if (userRows.length && prodRows.length) {
            const userId = userRows[0].id;
            const productId = prodRows[0].id;

            // Chèn đơn hàng mô phỏng
            const [orderRes] = await conn.execute(
                `INSERT INTO orders (
                    user_id, order_code, recipient_name, phone,
                    shipping_address, payment_method, payment_status, status,
                    subtotal, shipping_fee, total_amount, is_simulated
                ) VALUES (
                    ?, CONCAT('SIM-TEST-', UNIX_TIMESTAMP(), '-', FLOOR(RAND()*1000)),
                    'Test Sim Impact', '0901234567', JSON_OBJECT('address_line', '123 Test St', 'city', 'Hà Nội'), 'COD',
                    'PAID', 'DELIVERED', 500000, 0, 500000, 1
                )`,
                [userId]
            );

            // Chèn chi tiết đơn hàng
            await conn.execute(
                `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
                 VALUES (?, ?, 'Sản phẩm Test Mô Phỏng', 500000, 1, 500000)`,
                [orderRes.insertId, productId]
            );

            // Chèn sự kiện tương tác PURCHASE mang is_simulated = 1
            await conn.execute(
                `INSERT INTO product_events (user_id, product_id, event_type, is_simulated, created_at)
                 VALUES (?, ?, 'PURCHASE', 1, NOW())`,
                [userId, productId]
            );
        }

        // C. Lấy kết quả xếp hạng SAU khi thêm đơn mô phỏng
        const rankAfter = await askMlRanker(warmUserId, candidateObjects, 5);
        assert.ok(rankAfter, 'ML Service phải phản hồi kết quả sau khi thêm đơn mô phỏng');
        assert.equal(rankAfter.source, 'ranker_lc1', 'Nguồn gợi ý vẫn là ranker_lc1');

        const itemsAfter = rankAfter.items.map(item => ({
            id: Number(item.product.ml_product_id ?? item.product.id),
            reasons: item.reasons
        }));

        // D. So sánh đối chiếu 1-1
        assert.deepEqual(
            itemsAfter,
            itemsBefore,
            'Thứ tự và lý do của các ứng viên xếp hạng bởi Ranker LC-1 phải TRÙNG KHỚP 100% trước và sau khi thêm đơn mô phỏng'
        );

        console.log('[XÁC MINH VIỆC 4 - BẰNG CHỨNG THỰC NGHIỆM]:');
        console.log(' - Nguồn trước:', rankBefore.source, '| Nguồn sau:', rankAfter.source);
        console.log(' - Thứ tự trước:', itemsBefore.map(i => i.id));
        console.log(' - Thứ tự sau:  ', itemsAfter.map(i => i.id));
        console.log(' => KẾT LUẬN: Đơn mô phỏng KHÔNG ảnh hưởng LC-1; ranker dùng snapshot tại 2020-01-15.');
    });

    await t.test('2. Kiểm chứng tại tầng dịch vụ Giftly (recommendProducts): các sự kiện mô phỏng bị loại trừ hoàn toàn khỏi tính toán tín hiệu người dùng và độ phổ biến', async () => {
        const [demoUsers] = await conn.execute(
            "SELECT id, ml_user_id FROM users WHERE ml_user_id IS NOT NULL LIMIT 1"
        );
        if (!demoUsers.length) {
            t.skip('Không có user demo trong database test');
            return;
        }
        const demoUserId = demoUsers[0].id;

        // Lấy gợi ý trước
        const recBefore = await recommendProducts(demoUserId, 6);

        // Thêm 10 sự kiện mô phỏng (VIEW, CART_ADD, PURCHASE)
        const [allProds] = await conn.execute("SELECT id FROM products WHERE status = 'ACTIVE' LIMIT 2");
        if (allProds.length) {
            for (let i = 0; i < 5; i++) {
                await conn.execute(
                    `INSERT INTO product_events (user_id, product_id, event_type, is_simulated, created_at)
                     VALUES (?, ?, 'PURCHASE', 1, NOW())`,
                    [demoUserId, allProds[0].id]
                );
                await conn.execute(
                    `INSERT INTO product_events (user_id, product_id, event_type, is_simulated, created_at)
                     VALUES (?, ?, 'VIEW', 1, NOW())`,
                    [demoUserId, allProds[1].id]
                );
            }
        }

        // Lấy gợi ý sau
        const recAfter = await recommendProducts(demoUserId, 6);

        // Kiểm tra thứ tự và nguồn gợi ý
        assert.equal(recBefore.source, recAfter.source);
        assert.deepEqual(
            recBefore.items.map(i => i.product.id),
            recAfter.items.map(i => i.product.id),
            'Danh sách gợi ý sản phẩm không bị thay đổi bởi sự kiện mô phỏng vì câu truy vấn lọc bỏ is_simulated = 1'
        );
    });
});
