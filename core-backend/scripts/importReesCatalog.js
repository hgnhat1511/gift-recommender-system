const path = require('node:path');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('node:fs/promises');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function importReesCatalog() {
    // 1. Kiểm tra an toàn môi trường và database allowlist
    if (process.env.NODE_ENV === 'production') {
        console.error('LỖI AN TOÀN: Không được phép chạy importReesCatalog trên môi trường NODE_ENV=production!');
        process.exit(1);
    }

    const allowedDatabases = ['gift_ecommerce', 'gift_ecommerce_dev'];
    const currentDb = process.env.DB_NAME || 'gift_ecommerce';
    if (!allowedDatabases.includes(currentDb)) {
        console.error(`LỖI AN TOÀN: Database "${currentDb}" không nằm trong allowlist an toàn: [${allowedDatabases.join(', ')}]!`);
        process.exit(1);
    }

    // 2. Xác định chế độ chạy (mặc định dry-run, chỉ ghi khi có cờ --apply)
    const isApply = process.argv.includes('--apply');
    const isDryRun = !isApply;
    const canUpdateDisplay = process.argv.includes('--update-display');

    console.log('==================================================================');
    console.log('CHẾ ĐỘ CHẠY IMPORT REES46 CATALOG:');
    console.log(`- Database: ${currentDb}`);
    console.log(`- Chế độ: ${isDryRun ? 'DRY-RUN (CHỈ ĐỌC, KHÔNG GHI DATABASE)' : 'APPLY (GHI DATABASE)'}`);
    console.log(`- Cập nhật hiển thị (--update-display): ${canUpdateDisplay ? 'BẬT (chỉ cập nhật name/description/image_url cho synthetic)' : 'TẮT (giữ nguyên mọi sản phẩm đã tồn tại)'}`);
    console.log('==================================================================');

    const seedPath = path.join(__dirname, '..', '..', 'ml-service', 'data', 'processed', 'demo_catalog_seed.json');
    const rawData = await fs.readFile(seedPath, 'utf8');
    const seed = JSON.parse(rawData);

    console.log(`Đang đọc dữ liệu seed từ ${seedPath}: ${seed.products.length} sản phẩm, ${seed.demo_users.length} demo users.`);

    const connection = await pool.getConnection();
    try {
        if (isApply) {
            await connection.beginTransaction();
        }

        // 3. Đảm bảo danh mục tồn tại
        const [catRows] = await connection.execute(
            'SELECT id FROM categories WHERE name = ? LIMIT 1',
            ['Quà tặng REES46']
        );
        let categoryId = catRows.length ? catRows[0].id : null;
        if (!categoryId) {
            if (isApply) {
                const [createdCat] = await connection.execute(
                    'INSERT INTO categories (name, description, is_active, sort_order) VALUES (?, ?, TRUE, 99)',
                    ['Quà tặng REES46', 'Danh mục sản phẩm mở rộng từ tập dữ liệu REES46 dùng cho mô hình gợi ý LC-1']
                );
                categoryId = createdCat.insertId;
                console.log(`[APPLY] Đã tạo danh mục 'Quà tặng REES46' (id: ${categoryId}).`);
            } else {
                console.log(`[DRY-RUN] Sẽ tạo danh mục 'Quà tặng REES46'.`);
                categoryId = 999;
            }
        }

        // 4. Xử lý sản phẩm REES46
        let productsToInsert = 0;
        let productsToUpdateDisplay = 0;
        let productsSkipped = 0;

        for (const prod of seed.products) {
            const [existing] = await connection.execute(
                'SELECT id, is_synthetic_display, price, stock, status FROM products WHERE ml_product_id = ? LIMIT 1',
                [prod.ml_product_id]
            );

            if (existing.length) {
                if (canUpdateDisplay && existing[0].is_synthetic_display) {
                    if (isApply) {
                        // CHỈ cập nhật hiển thị (tên, mô tả, ảnh), KHÔNG đụng đến price, stock, status!
                        await connection.execute(
                            `UPDATE products SET 
                                name = ?, description = ?, image_url = ?, style = ?, gift_type = ?
                            WHERE ml_product_id = ? AND is_synthetic_display = TRUE`,
                            [
                                prod.name, prod.description, prod.image_url,
                                prod.style, prod.gift_type, prod.ml_product_id
                            ]
                        );
                    }
                    productsToUpdateDisplay++;
                } else {
                    productsSkipped++;
                }
            } else {
                if (isApply) {
                    await connection.execute(
                        `INSERT INTO products 
                            (category_id, name, description, price, stock, image_url, status, 
                             ml_product_id, is_synthetic_display, style, gift_type, is_featured)
                        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, TRUE, ?, ?, FALSE)`,
                        [
                            categoryId, prod.name, prod.description, prod.price, prod.stock,
                            prod.image_url, prod.ml_product_id, prod.style, prod.gift_type
                        ]
                    );
                }
                productsToInsert++;
            }
        }

        // 5. Xử lý tài khoản demo
        let usersToInsert = 0;
        let usersSkipped = 0;
        const demoPassword = process.env.DEMO_USER_PASSWORD;

        for (const u of seed.demo_users) {
            const [existing] = await connection.execute(
                'SELECT id, role, status FROM users WHERE ml_user_id = ? OR email = ? LIMIT 1',
                [u.ml_user_id, u.email]
            );

            if (existing.length) {
                // Với tài khoản đã tồn tại: KHÔNG BAO GIỜ ghi đè password_hash, role, status!
                usersSkipped++;
            } else {
                if (isApply) {
                    if (!demoPassword) {
                        throw new Error('Biến môi trường DEMO_USER_PASSWORD chưa được thiết lập. Không thể tạo tài khoản demo mới.');
                    }
                    const salt = await bcrypt.genSalt(10);
                    const passwordHash = await bcrypt.hash(demoPassword, salt);
                    await connection.execute(
                        `INSERT INTO users 
                            (full_name, email, password_hash, role, status, ml_user_id)
                        VALUES (?, ?, ?, 'USER', 'ACTIVE', ?)`,
                        [u.full_name, u.email, passwordHash, u.ml_user_id]
                    );
                }
                usersToInsert++;
            }
        }

        if (isApply) {
            await connection.commit();
        }

        // 6. Báo cáo kiểm kê (chỉ đọc)
        const [totalProds] = await connection.execute(
            'SELECT COUNT(*) as total, SUM(CASE WHEN ml_product_id IS NOT NULL THEN 1 ELSE 0 END) as ml_prods, SUM(CASE WHEN ml_product_id IS NULL THEN 1 ELSE 0 END) as old_prods FROM products'
        );
        const [totalUsers] = await connection.execute(
            'SELECT COUNT(*) as total, SUM(CASE WHEN ml_user_id IS NOT NULL THEN 1 ELSE 0 END) as ml_users FROM users'
        );

        console.log('==================================================================');
        console.log(`KẾT QUẢ ${isDryRun ? 'DRY-RUN' : 'APPLY'}:`);
        console.log('==================================================================');
        console.log(`- Sản phẩm ${isApply ? 'đã thêm mới' : 'sẽ thêm mới'}: ${productsToInsert}`);
        console.log(`- Sản phẩm ${isApply ? 'đã cập nhật hiển thị' : 'sẽ cập nhật hiển thị'}: ${productsToUpdateDisplay}`);
        console.log(`- Sản phẩm bỏ qua (đã tồn tại, bảo vệ giá/kho/status): ${productsSkipped}`);
        console.log(`- Tài khoản demo ${isApply ? 'đã thêm mới' : 'sẽ thêm mới'}: ${usersToInsert}`);
        console.log(`- Tài khoản demo bỏ qua (đã tồn tại, bảo vệ password/role/status): ${usersSkipped}`);
        console.log(`- Tổng sản phẩm hiện tại trong DB: ${totalProds[0].total} (Sản phẩm gốc: ${totalProds[0].old_prods}, Sản phẩm REES: ${totalProds[0].ml_prods})`);
        console.log(`- Tổng users hiện tại trong DB: ${totalUsers[0].total} (Demo ML users: ${totalUsers[0].ml_users})`);
        if (isDryRun) {
            console.log('(*) Thông báo: Đây là lần chạy DRY-RUN, không có bất kỳ thay đổi nào được ghi vào database.');
        }
        console.log('==================================================================');

    } catch (err) {
        if (isApply) {
            await connection.rollback();
        }
        console.error('Lỗi trong quá trình thực thi:', err);
        throw err;
    } finally {
        connection.release();
        await pool.end();
    }
}

if (require.main === module) {
    importReesCatalog()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('LỖI CHÍNH:', err);
            process.exit(1);
        });
}

module.exports = { importReesCatalog };
