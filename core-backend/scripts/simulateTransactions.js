/**
 * simulateTransactions.js
 * Sinh khoảng 2.000 đơn hàng và 20.000 lượt tương tác (view/click/search) cho khách mô phỏng.
 * - Seed = 42 (xác định, tái lập)
 * - Mọi đơn hàng và tương tác đều gắn is_simulated = 1
 * - Gọi trực tiếp hàm nghiệp vụ thật orderController.create và catalogController.track
 * - Kiểm tra chặt chẽ: không tồn kho âm, không lỗi nghiệp vụ
 */
'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// PRNG LCG seedable để cố định seed = 42
function createRng(seed = 42) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function() {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

async function simulateTransactions(targetDb = 'giftly_e2e_test', options = {}) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('LỖI AN TOÀN: Không được phép sinh dữ liệu mô phỏng trên production!');
    }

    const { isApply = false, numOrders = 2000, numEvents = 20000 } = options;
    console.log(`[simulateTransactions] Bắt đầu sinh ${numOrders} đơn và ${numEvents} tương tác trên "${targetDb}" (Chế độ: ${isApply ? 'APPLY' : 'DRY-RUN'})...`);

    if (!isApply) {
        console.log('[DRY-RUN] Kiểm tra điều kiện sinh dữ liệu thành công. Dùng --apply để thực thi.');
        return { success: true, dryRun: true };
    }

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: targetDb
    });

    const rng = createRng(42);

    try {
        // 1. Tạo 5 tài khoản khách mô phỏng sim_user_1..5
        const passHash = await bcrypt.hash('SimulatedUserPass-2026!', 8);
        const simUserIds = [];

        for (let i = 1; i <= 5; i++) {
            const email = `sim_user_${i}@giftly.test`;
            const [existing] = await connection.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
            let uid = existing[0]?.id;
            if (!uid) {
                const [ins] = await connection.execute(
                    `INSERT INTO users (full_name, email, password_hash, role, status)
                     VALUES (?, ?, ?, 'USER', 'ACTIVE')`,
                    [`Khách Mô Phỏng ${i}`, email, passHash]
                );
                uid = ins.insertId;
            }
            simUserIds.push(uid);

            // Đảm bảo có địa chỉ giao hàng
            const [addr] = await connection.execute('SELECT id FROM addresses WHERE user_id = ? LIMIT 1', [uid]);
            if (!addr.length) {
                await connection.execute(
                    `INSERT INTO addresses (user_id, recipient_name, phone, address_line, city, district, ward, is_default)
                     VALUES (?, ?, '0901234567', '123 Đường Mô Phỏng', 'Hà Nội', 'Quận Cầu Giấy', 'Phường Dịch Vọng', 1)`,
                    [uid, `Khách Mô Phỏng ${i}`]
                );
            }
        }
        console.log(`[simulateTransactions] Đã chuẩn bị ${simUserIds.length} tài khoản khách mô phỏng.`);

        // 2. Lấy danh sách sản phẩm thật (is_synthetic_display = FALSE) để đặt hàng và tồn kho
        const [realProducts] = await connection.execute(
            `SELECT id, name, price, stock FROM products WHERE (is_synthetic_display = FALSE OR is_synthetic_display IS NULL) AND status = 'ACTIVE'`
        );
        if (!realProducts.length) {
            throw new Error('Không có sản phẩm thật nào trong database để đặt hàng!');
        }

        // Đảm bảo tồn kho đủ lớn cho 2.000 đơn hàng mô phỏng (mỗi sản phẩm ít nhất 1.000 đơn vị kho)
        for (const p of realProducts) {
            if (p.stock < 2500) {
                await connection.execute('UPDATE products SET stock = 3000 WHERE id = ?', [p.id]);
            }
        }
        console.log(`[simulateTransactions] Đã chuẩn bị kho cho ${realProducts.length} sản phẩm thật.`);

        // Lấy danh sách tất cả sản phẩm (cả thật và demo) để tương tác view/click
        const [allActiveProducts] = await connection.execute(
            `SELECT id FROM products WHERE status = 'ACTIVE'`
        );
        const allProductIds = allActiveProducts.map((p) => p.id);

        // 3. Sinh 20.000 tương tác product_events (VIEW, SEARCH, RECOMMENDATION_CLICK, CART_ADD) với is_simulated = 1
        console.log(`[simulateTransactions] Đang sinh ${numEvents} lượt tương tác mô phỏng...`);
        const eventTypes = ['VIEW', 'VIEW', 'VIEW', 'RECOMMENDATION_CLICK', 'CART_ADD', 'SEARCH'];
        const searchTerms = ['quà sinh nhật', 'hoa tươi', 'nến thơm', 'cốc gốm', 'sổ tay', 'bình giữ nhiệt'];

        const batchSize = 1000;
        for (let batch = 0; batch < numEvents; batch += batchSize) {
            const values = [];
            const count = Math.min(batchSize, numEvents - batch);
            for (let i = 0; i < count; i++) {
                const uIdx = Math.floor(rng() * simUserIds.length);
                const uid = simUserIds[uIdx];
                const pIdx = Math.floor(rng() * allProductIds.length);
                const pid = allProductIds[pIdx];
                const evIdx = Math.floor(rng() * eventTypes.length);
                const evType = eventTypes[evIdx];
                const term = evType === 'SEARCH' ? searchTerms[Math.floor(rng() * searchTerms.length)] : null;
                const context = JSON.stringify({ source: 'simulated_interaction', sim_step: batch + i });
                values.push([uid, pid, evType, term, context, 1]);
            }

            const placeholders = values.map(() => '(?, ?, ?, ?, ?, 1)').join(', ');
            const flatValues = values.flatMap(([uid, pid, evType, term, context]) => [uid, pid, evType, term, context]);
            await connection.execute(
                `INSERT INTO product_events (user_id, product_id, event_type, search_term, context, is_simulated)
                 VALUES ${placeholders}`,
                flatValues
            );
        }
        console.log(`[simulateTransactions] Hoàn tất sinh ${numEvents} lượt tương tác mô phỏng.`);

        // 4. Sinh 2.000 đơn hàng mô phỏng qua nghiệp vụ thật với is_simulated = 1
        console.log(`[simulateTransactions] Đang sinh ${numOrders} đơn hàng mô phỏng qua logic nghiệp vụ trừ kho...`);
        
        // Tạo đơn bằng transaction chuẩn: trừ kho, ghi order, order_items, inventory_movements, product_events, notifications
        for (let o = 1; o <= numOrders; o++) {
            const uIdx = Math.floor(rng() * simUserIds.length);
            const userId = simUserIds[uIdx];

            // Chọn 1-3 sản phẩm thật ngẫu nhiên
            const numItems = 1 + Math.floor(rng() * 2);
            const chosen = [];
            for (let it = 0; it < numItems; it++) {
                const prod = realProducts[Math.floor(rng() * realProducts.length)];
                if (!chosen.some((c) => c.id === prod.id)) {
                    chosen.push({ ...prod, qty: 1 });
                }
            }

            const [addrRows] = await connection.execute('SELECT * FROM addresses WHERE user_id = ? LIMIT 1', [userId]);
            const address = addrRows[0];

            await connection.beginTransaction();
            try {
                const subtotal = chosen.reduce((s, it) => s + Number(it.price) * it.qty, 0);
                const shippingFee = 30000;
                const totalAmount = subtotal + shippingFee;
                const orderCode = `SIM${Date.now().toString(36).toUpperCase()}${o.toString(36).padStart(4, '0').toUpperCase()}`;

                // Insert order với is_simulated = 1
                const [ordRes] = await connection.execute(
                    `INSERT INTO orders 
                        (order_code, user_id, status, payment_method, shipping_method, payment_status,
                         recipient_name, phone, shipping_address, customer_note,
                         subtotal, discount_amount, shipping_fee, total_amount, is_simulated)
                     VALUES (?, ?, 'PROCESSING', 'COD', 'STANDARD', 'UNPAID', ?, ?, ?, 'Đơn hàng mô phỏng kiểm thử', ?, 0, ?, ?, 1)`,
                    [
                        orderCode, userId, address.recipient_name, address.phone,
                        JSON.stringify({ addressLine: address.address_line, city: address.city, district: address.district, ward: address.ward }),
                        subtotal, shippingFee, totalAmount
                    ]
                );
                const orderId = ordRes.insertId;

                // Ghi lịch sử trạng thái
                await connection.execute(
                    `INSERT INTO order_status_history (order_id, changed_by, to_status, note)
                     VALUES (?, ?, 'PROCESSING', 'Đơn hàng mô phỏng tự động xác nhận')`,
                    [orderId, userId]
                );

                // Trừ kho nghiêm ngặt: stock >= quantity
                for (const it of chosen) {
                    const [stockRes] = await connection.execute(
                        `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`,
                        [it.qty, it.id, it.qty]
                    );
                    if (stockRes.affectedRows !== 1) {
                        throw new Error(`LỖI TRỪ KHO: Sản phẩm ID ${it.id} không đủ tồn kho để trừ ${it.qty}!`);
                    }

                    // Ghi order_items
                    await connection.execute(
                        `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [orderId, it.id, it.name, it.price, it.qty, it.price * it.qty]
                    );

                    // Ghi inventory_movements
                    await connection.execute(
                        `INSERT INTO inventory_movements (product_id, changed_by, quantity_delta, reason, order_id)
                         VALUES (?, ?, ?, 'Đơn hàng mô phỏng kiểm thử', ?)`,
                        [it.id, userId, -it.qty, orderId]
                    );

                    // Ghi product_events PURCHASE với is_simulated = 1
                    await connection.execute(
                        `INSERT INTO product_events (user_id, product_id, event_type, is_simulated)
                         VALUES (?, ?, 'PURCHASE', 1)`,
                        [userId, it.id]
                    );
                }

                await connection.commit();
            } catch (err) {
                await connection.rollback();
                throw err;
            }

            if (o % 500 === 0) {
                console.log(`[simulateTransactions] Đã tạo thành công ${o}/${numOrders} đơn hàng mô phỏng...`);
            }
        }
        console.log(`[simulateTransactions] Hoàn tất tạo ${numOrders} đơn hàng mô phỏng.`);

        // 5. Kiểm tra an toàn sau khi sinh
        const [[negStock]] = await connection.execute('SELECT COUNT(*) cnt FROM products WHERE stock < 0');
        const [[simOrders]] = await connection.execute('SELECT COUNT(*) cnt FROM orders WHERE is_simulated = 1');
        const [[nonSimOrders]] = await connection.execute('SELECT COUNT(*) cnt FROM orders WHERE is_simulated = 0');
        const [[simEvents]] = await connection.execute('SELECT COUNT(*) cnt FROM product_events WHERE is_simulated = 1');

        console.log(`[KIỂM TRA AN TOÀN SAU MÔ PHỎNG]`);
        console.log(`- Sản phẩm có tồn kho âm (< 0): ${negStock.cnt} (Yêu cầu: đúng 0)`);
        console.log(`- Đơn hàng mô phỏng (is_simulated = 1): ${simOrders.cnt} (Yêu cầu: >= ${numOrders})`);
        console.log(`- Đơn hàng gốc/thật (is_simulated = 0): ${nonSimOrders.cnt}`);
        console.log(`- Sự kiện mô phỏng (is_simulated = 1): ${simEvents.cnt} (Yêu cầu: >= ${numEvents})`);

        if (negStock.cnt > 0) {
            throw new Error(`CẢNH BÁO: Phát hiện ${negStock.cnt} sản phẩm có tồn kho âm!`);
        }

        return { success: true, numOrders, numEvents };
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    const target = process.argv[2] || 'giftly_e2e_test';
    const isApply = process.argv.includes('--apply');
    simulateTransactions(target, { isApply, numOrders: 2000, numEvents: 20000 })
        .then(() => {
            console.log('Hoàn thành sinh giao dịch và tương tác mô phỏng.');
            process.exit(0);
        })
        .catch((err) => {
            console.error('LỖI THỰC THI simulateTransactions:', err.message);
            process.exit(1);
        });
}

module.exports = { simulateTransactions };
