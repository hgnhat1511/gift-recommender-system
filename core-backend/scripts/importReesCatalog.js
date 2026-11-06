require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function importReesCatalog() {
    const seedPath = path.join(__dirname, '..', '..', 'ml-service', 'data', 'processed', 'demo_catalog_seed.json');
    const rawData = await fs.readFile(seedPath, 'utf8');
    const seed = JSON.parse(rawData);

    console.log(`Đang đọc dữ liệu seed từ ${seedPath}: ${seed.products.length} sản phẩm, ${seed.demo_users.length} demo users.`);

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Đảm bảo danh mục cho các sản phẩm REES46 tồn tại
        const [catRows] = await connection.execute(
            'SELECT id FROM categories WHERE name = ? LIMIT 1',
            ['Quà tặng REES46']
        );
        let categoryId;
        if (catRows.length) {
            categoryId = catRows[0].id;
        } else {
            const [createdCat] = await connection.execute(
                'INSERT INTO categories (name, description, is_active, sort_order) VALUES (?, ?, TRUE, 99)',
                ['Quà tặng REES46', 'Danh mục sản phẩm mở rộng từ tập dữ liệu REES46 dùng cho mô hình gợi ý LC-1']
            );
            categoryId = createdCat.insertId;
            console.log(`Đã tạo danh mục 'Quà tặng REES46' (id: ${categoryId}).`);
        }

        // 2. Nhập các sản phẩm REES46 vào bảng products
        let productsInserted = 0;
        let productsUpdated = 0;

        for (const prod of seed.products) {
            const [existing] = await connection.execute(
                'SELECT id FROM products WHERE ml_product_id = ? LIMIT 1',
                [prod.ml_product_id]
            );

            if (existing.length) {
                await connection.execute(
                    `UPDATE products SET 
                        name = ?, description = ?, price = ?, stock = ?, 
                        image_url = ?, status = 'ACTIVE', is_synthetic_display = TRUE,
                        style = ?, gift_type = ?
                    WHERE ml_product_id = ?`,
                    [
                        prod.name, prod.description, prod.price, prod.stock,
                        prod.image_url, prod.style, prod.gift_type, prod.ml_product_id
                    ]
                );
                productsUpdated++;
            } else {
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
                productsInserted++;
            }
        }

        // 3. Tạo 3 tài khoản demo
        const defaultPassword = 'Demo@123456';
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(defaultPassword, salt);

        let usersInserted = 0;
        let usersUpdated = 0;

        for (const u of seed.demo_users) {
            const [existing] = await connection.execute(
                'SELECT id FROM users WHERE ml_user_id = ? OR email = ? LIMIT 1',
                [u.ml_user_id, u.email]
            );

            if (existing.length) {
                await connection.execute(
                    `UPDATE users SET 
                        full_name = ?, password_hash = ?, role = 'USER', status = 'ACTIVE', ml_user_id = ?
                    WHERE id = ?`,
                    [u.full_name, passwordHash, u.ml_user_id, existing[0].id]
                );
                usersUpdated++;
            } else {
                await connection.execute(
                    `INSERT INTO users 
                        (full_name, email, password_hash, role, status, ml_user_id)
                    VALUES (?, ?, ?, 'USER', 'ACTIVE', ?)`,
                    [u.full_name, u.email, passwordHash, u.ml_user_id]
                );
                usersInserted++;
            }
        }

        await connection.commit();

        // 4. Báo cáo kiểm kê
        const [totalProds] = await connection.execute('SELECT COUNT(*) as total, SUM(CASE WHEN ml_product_id IS NOT NULL THEN 1 ELSE 0 END) as ml_prods, SUM(CASE WHEN ml_product_id IS NULL THEN 1 ELSE 0 END) as old_prods FROM products');
        const [totalUsers] = await connection.execute('SELECT COUNT(*) as total, SUM(CASE WHEN ml_user_id IS NOT NULL THEN 1 ELSE 0 END) as ml_users FROM users');

        console.log('==================================================================');
        console.log('KẾT QUẢ IMPORT REES46 VÀO MYSQL GIFTLY (BƯỚC 3):');
        console.log('==================================================================');
        console.log(`- Sản phẩm mới thêm: ${productsInserted}, cập nhật: ${productsUpdated}`);
        console.log(`- Tài khoản demo mới thêm: ${usersInserted}, cập nhật: ${usersUpdated}`);
        console.log(`- Tổng sản phẩm trong DB: ${totalProds[0].total} (Sản phẩm cũ: ${totalProds[0].old_prods}, Sản phẩm REES: ${totalProds[0].ml_prods})`);
        console.log(`- Tổng users trong DB: ${totalUsers[0].total} (Demo ML users: ${totalUsers[0].ml_users})`);
        console.log(`- Mật khẩu mặc định cho các tài khoản demo: ${defaultPassword}`);
        console.log('==================================================================');

    } catch (err) {
        await connection.rollback();
        console.error('Lỗi khi import REES46 catalog:', err);
        throw err;
    } finally {
        connection.release();
        await pool.end();
    }
}

if (require.main === module) {
    importReesCatalog()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { importReesCatalog };
