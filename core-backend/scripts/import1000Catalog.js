/**
 * import1000Catalog.js
 * Nạp catalog 1.000 sản phẩm thật từ REES46 vào database.
 * - Hỗ trợ nạp vào giftly_e2e_test và gift_ecommerce
 * - Chặn an toàn nếu NODE_ENV=production
 * - Chuyển toàn bộ 188 sản phẩm mô phỏng cũ không thuộc tập 1000 sang INACTIVE
 * - Đảm bảo chính xác 1.000 sản phẩm REES46 ở trạng thái ACTIVE
 */
'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('node:fs/promises');
const mysql = require('mysql2/promise');

async function import1000Catalog(targetDb = 'giftly_e2e_test', options = {}) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('LỖI AN TOÀN: Không được phép nạp catalog trên môi trường NODE_ENV=production!');
    }

    const { isApply = false } = options;
    console.log(`[import1000Catalog] Bắt đầu nạp catalog 1.000 sản phẩm vào database "${targetDb}" (Chế độ: ${isApply ? 'APPLY' : 'DRY-RUN'})...`);

    const productsFile = path.join(__dirname, '..', 'data', 'selected_1000_products.json');
    const rawData = await fs.readFile(productsFile, 'utf8');
    const products = JSON.parse(rawData);

    if (!Array.isArray(products) || products.length !== 1000) {
        throw new Error(`Dữ liệu đầu vào không hợp lệ: cần đúng 1000 sản phẩm, thực tế có ${products?.length}`);
    }

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: targetDb
    });

    try {
        // 1. Đảm bảo danh mục Lifestyle tồn tại
        const [catRows] = await connection.execute(
            'SELECT id FROM categories WHERE name = ? LIMIT 1',
            ['Lifestyle']
        );
        let categoryId = catRows.length ? catRows[0].id : null;
        if (!categoryId) {
            if (isApply) {
                const [createdCat] = await connection.execute(
                    'INSERT INTO categories (name, description, is_active, sort_order) VALUES (?, ?, TRUE, 99)',
                    ['Lifestyle', 'Danh mục phong cách sống và tiện ích quà tặng']
                );
                categoryId = createdCat.insertId;
                console.log(`[APPLY] Đã tạo danh mục Lifestyle (id: ${categoryId}).`);
            } else {
                categoryId = 999;
                console.log(`[DRY-RUN] Sẽ tạo danh mục Lifestyle.`);
            }
        }

        // 2. Chuyển tất cả sản phẩm synthetic hiện có sang INACTIVE trước
        if (isApply) {
            const [deactRes] = await connection.execute(
                `UPDATE products SET status = 'INACTIVE' WHERE is_synthetic_display = TRUE`
            );
            console.log(`[APPLY] Đã chuyển ${deactRes.affectedRows} sản phẩm synthetic cũ sang INACTIVE.`);
        }

        // 3. Upsert 1.000 sản phẩm mới
        let inserted = 0;
        let updated = 0;

        for (const prod of products) {
            const [existing] = await connection.execute(
                'SELECT id FROM products WHERE ml_product_id = ? LIMIT 1',
                [prod.ml_product_id]
            );

            if (existing.length) {
                if (isApply) {
                    await connection.execute(
                        `UPDATE products SET 
                            category_id = ?,
                            name = ?,
                            description = ?,
                            price = ?,
                            stock = ?,
                            image_url = ?,
                            status = 'ACTIVE',
                            is_synthetic_display = TRUE,
                            style = ?,
                            gift_type = ?,
                            occasion_tags = CAST(? AS JSON),
                            recipient_tags = CAST(? AS JSON),
                            interest_tags = CAST(? AS JSON)
                         WHERE id = ?`,
                        [
                            categoryId, prod.name, prod.description, prod.price, prod.stock,
                            prod.image_url, prod.style, prod.gift_type,
                            JSON.stringify(prod.occasion_tags || []),
                            JSON.stringify(prod.recipient_tags || []),
                            JSON.stringify(prod.interest_tags || []),
                            existing[0].id
                        ]
                    );
                }
                updated++;
            } else {
                if (isApply) {
                    await connection.execute(
                        `INSERT INTO products 
                            (category_id, name, description, price, stock, image_url, status,
                             ml_product_id, is_synthetic_display, style, gift_type,
                             occasion_tags, recipient_tags, interest_tags)
                         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, TRUE, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))`,
                        [
                            categoryId, prod.name, prod.description, prod.price, prod.stock,
                            prod.image_url, prod.ml_product_id, prod.style, prod.gift_type,
                            JSON.stringify(prod.occasion_tags || []),
                            JSON.stringify(prod.recipient_tags || []),
                            JSON.stringify(prod.interest_tags || [])
                        ]
                    );
                }
                inserted++;
            }
        }

        console.log(`[import1000Catalog] Hoàn tất xử lý: ${inserted} sản phẩm mới chèn, ${updated} sản phẩm cập nhật.`);

        if (isApply) {
            // Kiểm tra tính toàn vẹn
            const [[activeSynthetic]] = await connection.execute(
                `SELECT COUNT(*) total FROM products WHERE is_synthetic_display = TRUE AND status = 'ACTIVE'`
            );
            const [[inactiveSynthetic]] = await connection.execute(
                `SELECT COUNT(*) total FROM products WHERE is_synthetic_display = TRUE AND status = 'INACTIVE'`
            );
            const [[activeOriginal]] = await connection.execute(
                `SELECT COUNT(*) total FROM products WHERE (is_synthetic_display = FALSE OR is_synthetic_display IS NULL) AND status = 'ACTIVE'`
            );

            console.log(`[KIỂM TRA TÍNH TOÀN VẸN]`);
            console.log(`- Sản phẩm synthetic ACTIVE: ${activeSynthetic.total} (Yêu cầu: đúng 1000)`);
            console.log(`- Sản phẩm synthetic INACTIVE (cũ không dùng): ${inactiveSynthetic.total}`);
            console.log(`- Sản phẩm gốc thật ACTIVE: ${activeOriginal.total}`);

            if (activeSynthetic.total !== 1000) {
                throw new Error(`LỖI: Số lượng synthetic active (${activeSynthetic.total}) không đúng 1000!`);
            }
        }

        return { success: true, inserted, updated };
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    const target = process.argv[2] || 'giftly_e2e_test';
    const isApply = process.argv.includes('--apply');
    import1000Catalog(target, { isApply })
        .then(() => {
            console.log('Nạp catalog thành công.');
            process.exit(0);
        })
        .catch((err) => {
            console.error('LỖI THỰC THI import1000Catalog:', err.message);
            process.exit(1);
        });
}

module.exports = { import1000Catalog };
