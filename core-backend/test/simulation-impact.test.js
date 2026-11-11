/**
 * simulation-impact.test.js
 * Kiểm chứng thực nghiệm tác động của dữ liệu mô phỏng đối với hệ thống gợi ý.
 *
 * ĐỊA CHỈ ĐỌC DỮ LIỆU CỦA MÔ HÌNH HỌC MÁY VÀ HỆ THỐNG GỢI Ý:
 * 1. Nơi mô hình Ranker LC-1 đọc đặc trưng:
 *    Mô hình Ranker LC-1 đọc đặc trưng tĩnh offline từ file snapshot parquet:
 *    - Đường dẫn: ml-service/data/processed/ranker_val_full.parquet
 *    - Mã nguồn nạp: RankerService.__init__ tại ml-service/app/services/ranker_service.py (dòng 45-50)
 *    - Mã nguồn suy luận: RankerService.rank tại ml-service/app/services/ranker_service.py (dòng 110-128)
 *    - Kết luận kiến trúc: Ranker LC-1 KHÔNG đọc cơ sở dữ liệu MySQL, chỉ đọc snapshot đóng băng tại mốc cutoff 2020-01-15.
 *
 * 2. Nơi tập ứng viên được lấy:
 *    Tập sản phẩm ứng viên gửi sang Ranker lấy trực tiếp từ bảng `products` của MySQL:
 *    - Mã nguồn truy vấn: hàm recommendProducts tại core-backend/services/recommendationService.js (dòng 241-262)
 *    - Điều kiện lọc: p.status = 'ACTIVE' AND p.stock > 0
 *
 * 3. Nơi đọc lịch sử sự kiện người dùng:
 *    Lịch sử tương tác người dùng được đọc từ bảng `product_events` trong MySQL:
 *    - Mã nguồn truy vấn: hàm recommendProducts tại core-backend/services/recommendationService.js (dòng 193-204)
 *    - Điều kiện lọc: AND (e.is_simulated = 0 OR e.is_simulated IS NULL) -> chủ động loại bỏ sự kiện mô phỏng.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Ràng buộc bảo vệ: Chỉ chạy trên database test chuyên biệt kết thúc bằng '_test'
if (!process.env.TEST_DB_NAME) {
    process.env.TEST_DB_NAME = 'giftly_e2e_test';
}
const testDbName = process.env.TEST_DB_NAME;
if (!testDbName.endsWith('_test') || testDbName === 'gift_ecommerce' || testDbName === 'giftly_verification_test') {
    throw new Error(`Từ chối chạy trên DB không an toàn: ${testDbName}. Chỉ cho phép database kết thúc bằng '_test'.`);
}

const { askMlRanker, recommendProducts } = require('../services/recommendationService');
const pool = require('../config/db');

test('Kiểm chứng B: Đơn mô phỏng có ảnh hưởng gợi ý không (đơn mô phỏng không ảnh hưởng LC-1; ranker dùng snapshot tại 2020-01-15)', async (t) => {
    let conn;
    try {
        conn = await pool.getConnection();
    } catch (err) {
        t.skip(`Không thể kết nối database test ${testDbName}: ${err.message}`);
        return;
    }

    // Đảm bảo tồn tại user có ĐÚNG ml_user_id = 27692594
    const [[database]] = await conn.query('SELECT DATABASE() name');
    console.log(`[simulation-impact.test.js] SELECT DATABASE(): ${database.name}`);

    const TARGET_ML_USER_ID = 27692594;
    let targetUserId;
    let createdUser = false;

    const [uRows] = await conn.execute(
        'SELECT id FROM users WHERE ml_user_id = ? LIMIT 1',
        [TARGET_ML_USER_ID]
    );

    if (uRows.length) {
        targetUserId = uRows[0].id;
    } else {
        const [uIns] = await conn.execute(
            `INSERT INTO users (full_name, email, password_hash, role, status, ml_user_id)
             VALUES ('User Test ML 27692594', 'ml_test_27692594@giftly.test', '$2a$10$dummyhashfortestonly1234567890', 'USER', 'ACTIVE', ?)`,
            [TARGET_ML_USER_ID]
        );
        targetUserId = uIns.insertId;
        createdUser = true;
    }

    t.after(async () => {
        try {
            if (createdUser && targetUserId) {
                await conn.execute('DELETE FROM users WHERE id = ?', [targetUserId]);
            }
        } finally {
            if (conn) conn.release();
            try {
                await pool.end();
            } catch {
                // ignore
            }
        }
    });

    // Lấy 1 sản phẩm thật để tạo sự kiện tương tác
    const [realProds] = await conn.execute(
        "SELECT id, category_id FROM products WHERE status = 'ACTIVE' AND (is_synthetic_display = FALSE OR is_synthetic_display IS NULL) LIMIT 1"
    );
    assert.ok(realProds.length > 0, 'Phải có ít nhất 1 sản phẩm cơ sở active trong DB test');
    const targetProductId = realProds[0].id;

    await t.test('1. Đối chứng dương: Sự kiện KHÔNG mô phỏng (is_simulated = 0) làm thay đổi tín hiệu người dùng từ popular_cold_start sang personalized_activity', async () => {
        let insertedEventId = null;
        try {
            // A. Đọc tín hiệu ban đầu (khi chưa có sự kiện thật nào)
            const recInitial = await recommendProducts(targetUserId, 8);
            assert.equal(recInitial.method, 'popular_cold_start', 'User chưa có tương tác phải ở trạng thái cold-start');

            // B. Thêm 1 sự kiện tương tác THẬT (is_simulated = 0) vào bảng product_events
            const [evRes] = await conn.execute(
                `INSERT INTO product_events (user_id, product_id, event_type, is_simulated, created_at)
                 VALUES (?, ?, 'PURCHASE', 0, NOW())`,
                [targetUserId, targetProductId]
            );
            insertedEventId = evRes.insertId;

            // C. Đọc lại gợi ý sau khi thêm sự kiện thật
            const recWithRealEvent = await recommendProducts(targetUserId, 8);

            // D. Xác nhận đầu ra THAY ĐỔI ở đúng nơi đọc tín hiệu người dùng
            assert.equal(
                recWithRealEvent.method,
                'personalized_activity',
                'Sự kiện thật (is_simulated = 0) phải được câu truy vấn SQL đọc và chuyển trạng thái sang personalized_activity'
            );
            assert.notEqual(
                recWithRealEvent.method,
                recInitial.method,
                'Đầu ra tín hiệu người dùng phải thay đổi khi có sự kiện thật (đối chứng dương)'
            );
        } finally {
            // Dọn dẹp dữ liệu test ngay sau khi chạy
            if (insertedEventId) {
                await conn.execute('DELETE FROM product_events WHERE id = ?', [insertedEventId]);
            }
        }
    });

    await t.test('2. Đối chiếu: Sự kiện mô phỏng (is_simulated = 1) KHÔNG làm thay đổi tín hiệu người dùng ở cùng vị trí đó', async () => {
        let insertedEventId = null;
        let insertedOrderId = null;
        try {
            // A. Đọc tín hiệu ban đầu
            const recBeforeSim = await recommendProducts(targetUserId, 8);
            assert.equal(recBeforeSim.method, 'popular_cold_start', 'User ở trạng thái cold-start trước khi thêm mô phỏng');

            // B. Thêm 1 sự kiện mô phỏng (is_simulated = 1) và 1 đơn hàng mô phỏng cho ĐÚNG user này
            const [evRes] = await conn.execute(
                `INSERT INTO product_events (user_id, product_id, event_type, is_simulated, created_at)
                 VALUES (?, ?, 'PURCHASE', 1, NOW())`,
                [targetUserId, targetProductId]
            );
            insertedEventId = evRes.insertId;

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
                [targetUserId]
            );
            insertedOrderId = orderRes.insertId;

            await conn.execute(
                `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
                 VALUES (?, ?, 'Sản phẩm Test Mô Phỏng', 500000, 1, 500000)`,
                [insertedOrderId, targetProductId]
            );

            // C. Đọc lại gợi ý sau khi thêm đơn và sự kiện mô phỏng
            const recAfterSim = await recommendProducts(targetUserId, 8);

            // D. Xác nhận đầu ra HOÀN TOÀN KHÔNG ĐỔI ở cùng vị trí đo
            assert.equal(
                recAfterSim.method,
                'popular_cold_start',
                'Sự kiện mô phỏng bị loại trừ khỏi SQL nên phương pháp gợi ý vẫn giữ nguyên popular_cold_start'
            );
            assert.equal(
                recAfterSim.method,
                recBeforeSim.method,
                'Phương thức gợi ý không bị thay đổi bởi sự kiện mô phỏng'
            );
            assert.deepEqual(
                recAfterSim.items.map(i => i.product.id),
                recBeforeSim.items.map(i => i.product.id),
                'Danh sách sản phẩm gợi ý trước và sau khi thêm đơn mô phỏng phải trùng khớp 100%'
            );
        } finally {
            // Dọn dẹp dữ liệu test ngay sau khi chạy
            if (insertedOrderId) {
                await conn.execute('DELETE FROM order_items WHERE order_id = ?', [insertedOrderId]);
                await conn.execute('DELETE FROM orders WHERE id = ?', [insertedOrderId]);
            }
            if (insertedEventId) {
                await conn.execute('DELETE FROM product_events WHERE id = ?', [insertedEventId]);
            }
        }
    });

    await t.test('3. Kiểm chứng tại API Ranker ML (/recommend/rank): Ranker đọc đặc trưng tĩnh offline nên kết quả xếp hạng độc lập với dữ liệu mô phỏng trong MySQL', async () => {
        let insertedOrderId = null;
        let insertedEventId = null;
        try {
            const candidateIds = [5809910, 5804261, 5804262, 5885786, 5834419];
            const candidateObjects = candidateIds.map(id => ({
                product: { id, ml_product_id: id, name: `Product ${id}`, price: 100000 }
            }));

            // A. Xếp hạng ban đầu qua Ranker LC-1
            const rankBefore = await askMlRanker(TARGET_ML_USER_ID, candidateObjects, 5);
            assert.ok(rankBefore, 'ML Service phải phản hồi kết quả');
            assert.equal(rankBefore.source, 'ranker_lc1', 'Nguồn gợi ý cho user có lịch sử offline phải là ranker_lc1');
            assert.equal(rankBefore.items.length, 5, 'Phải xếp hạng đủ 5 ứng viên');

            // B. Thêm đơn hàng mô phỏng và sự kiện mô phỏng cho user này trong MySQL
            const [orderRes] = await conn.execute(
                `INSERT INTO orders (
                    user_id, order_code, recipient_name, phone,
                    shipping_address, payment_method, payment_status, status,
                    subtotal, shipping_fee, total_amount, is_simulated
                ) VALUES (
                    ?, CONCAT('SIM-TEST-', UNIX_TIMESTAMP(), '-', FLOOR(RAND()*1000)),
                    'Test Sim Impact ML', '0901234567', JSON_OBJECT('address_line', '123 Test St', 'city', 'Hà Nội'), 'COD',
                    'PAID', 'DELIVERED', 500000, 0, 500000, 1
                )`,
                [targetUserId]
            );
            insertedOrderId = orderRes.insertId;

            const [evRes] = await conn.execute(
                `INSERT INTO product_events (user_id, product_id, event_type, is_simulated, created_at)
                 VALUES (?, ?, 'PURCHASE', 1, NOW())`,
                [targetUserId, targetProductId]
            );
            insertedEventId = evRes.insertId;

            // C. Xếp hạng lại qua Ranker LC-1 sau khi thêm đơn mô phỏng vào MySQL
            const rankAfter = await askMlRanker(TARGET_ML_USER_ID, candidateObjects, 5);
            assert.ok(rankAfter, 'ML Service phải phản hồi kết quả');
            assert.equal(rankAfter.source, 'ranker_lc1');

            // D. Xác nhận thứ tự và điểm số xếp hạng hoàn toàn trùng khớp
            const itemsBefore = rankBefore.items.map(item => ({
                id: Number(item.product.ml_product_id ?? item.product.id),
                reasons: item.reasons
            }));
            const itemsAfter = rankAfter.items.map(item => ({
                id: Number(item.product.ml_product_id ?? item.product.id),
                reasons: item.reasons
            }));

            assert.deepEqual(
                itemsAfter,
                itemsBefore,
                'Thứ tự và lý do của các ứng viên xếp hạng bởi Ranker LC-1 phải trùng khớp 100% vì Ranker đọc snapshot đặc trưng tĩnh'
            );
        } finally {
            // Dọn dẹp dữ liệu test ngay sau khi chạy
            if (insertedOrderId) {
                await conn.execute('DELETE FROM order_items WHERE order_id = ?', [insertedOrderId]);
                await conn.execute('DELETE FROM orders WHERE id = ?', [insertedOrderId]);
            }
            if (insertedEventId) {
                await conn.execute('DELETE FROM product_events WHERE id = ?', [insertedEventId]);
            }
        }
    });
});
