/**
 * resetTestDb.js
 * Script tạo / xóa / tạo lại database test dùng một lần (utf8mb4).
 * Bắt buộc kiểm tra an toàn:
 * - TỪ CHỐI nếu NODE_ENV=production
 * - TỪ CHỐI nếu tên database không kết thúc bằng _test (hoặc là gift_ecommerce)
 */
'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('node:fs/promises');
const mysql = require('mysql2/promise');

function assertSafeTestDatabase(dbName) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('LỖI BẢO VỆ AN TOÀN: Không được phép thao tác reset database trên môi trường NODE_ENV=production!');
    }
    const name = String(dbName || '').trim();
    if (!name || !name.endsWith('_test') || name === 'gift_ecommerce' || name === 'giftly_verification_test') {
        throw new Error(`LỖI BẢO VỆ AN TOÀN: Tên database "${name}" không hợp lệ. Chỉ chấp nhận database kết thúc bằng "_test" và tuyệt đối không đụng vào "gift_ecommerce" hoặc "giftly_verification_test"!`);
    }
}

async function resetTestDatabase(targetDb = 'giftly_e2e_test', options = {}) {
    assertSafeTestDatabase(targetDb);
    const { seed = false, seedDemo = false } = options;
    const seedCore = seed || seedDemo;

    console.log(`[resetTestDb] Đang khởi tạo lại database test sạch: "${targetDb}" (utf8mb4)...`);

    // 1. Kết nối cấp server để DROP và CREATE DATABASE
    const serverConn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD
    });

    try {
        await serverConn.query(`DROP DATABASE IF EXISTS \`${targetDb}\``);
        await serverConn.query(`CREATE DATABASE \`${targetDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        console.log(`[resetTestDb] Đã DROP và CREATE DATABASE \`${targetDb}\` thành công.`);
    } finally {
        await serverConn.end();
    }

    // 2. Kết nối vào targetDb để áp dụng toàn bộ migrations
    const dbConn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: targetDb
    });

    try {
        const [[activeDatabase]] = await dbConn.query('SELECT DATABASE() name');
        if (activeDatabase.name !== targetDb) throw new Error(`Connected to unexpected database "${activeDatabase.name}" instead of "${targetDb}".`);
        console.log(`[resetTestDb] SELECT DATABASE(): ${activeDatabase.name}`);

        const migrationsDir = path.join(__dirname, '..', '..', 'database', 'migrations');
        const files = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();

        for (const file of files) {
            const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
            for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
                if (/^USE\s+`?[A-Za-z0-9_$]+`?$/i.test(statement)) continue;
                await dbConn.query(statement);
            }
        }

        console.log(`[resetTestDb] Đã áp dụng toàn bộ ${files.length} file migrations cho \`${targetDb}\`.`);

        // 3. Nếu yêu cầu seed catalog gốc (5 danh mục, 14 sản phẩm thật)
        if (seedCore) {
            console.log(`[resetTestDb] Đang nạp seed catalog cơ sở (5 danh mục, 14 sản phẩm thật)...`);
            const catalog = [
                { category: 'Sinh nhật', products: [
                    ['Hộp quà sinh nhật pastel', 'Hộp quà được phối màu dịu nhẹ, phù hợp gửi tặng bạn bè.', 289000, 18, 'https://images.unsplash.com/photo-1513201099705-a9746e1e201f?auto=format&fit=crop&w=800&q=85', ['birthday'], ['friend','sister','colleague'], ['stationery','decor'], 'pastel', 'gift-box', true],
                    ['Bánh kem mini lời chúc', 'Bánh kem nhỏ trang trí theo chủ đề sinh nhật.', 195000, 12, 'https://images.unsplash.com/photo-1486427944299-d1955d23e34d?auto=format&fit=crop&w=800&q=85', ['birthday'], ['friend','partner','sister'], ['sweets'], 'sweet', 'food', true],
                    ['Bó hoa đồng nội', 'Bó hoa tươi theo mùa với thiệp viết tay.', 345000, 9, 'https://images.unsplash.com/photo-1494972308805-463bc619d34e?auto=format&fit=crop&w=800&q=85', ['birthday','thank-you'], ['mother','friend','teacher'], ['flowers','gardening'], 'natural', 'flowers', false]
                ]},
                { category: 'Tình yêu', products: [
                    ['Hộp quà yêu thương', 'Bộ quà tặng gồm nến thơm và thiệp chúc mừng.', 399000, 14, 'https://images.unsplash.com/photo-1513883049090-d0b7439799bf?auto=format&fit=crop&w=800&q=85', ['anniversary','valentines'], ['partner','wife','husband'], ['home','fragrance'], 'romantic', 'gift-box', true],
                    ['Hoa hồng pastel', 'Bó hoa hồng tông pastel gói giấy kraft.', 429000, 8, 'https://images.unsplash.com/photo-1494972308805-463bc619d34e?auto=format&fit=crop&w=800&q=85', ['anniversary','valentines'], ['partner','wife','mother'], ['flowers'], 'romantic', 'flowers', true],
                    ['Nến thơm thư giãn', 'Nến thơm hương gỗ nhẹ, dùng cho không gian nghỉ ngơi.', 159000, 24, 'https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=800&q=85', ['housewarming','thank-you'], ['friend','partner','colleague'], ['home','fragrance'], 'minimal', 'home', false]
                ]},
                { category: 'Quà handmade', products: [
                    ['Sổ tay bìa vải thủ công', 'Sổ tay đóng thủ công, giấy dày phù hợp viết và vẽ.', 179000, 22, 'https://images.unsplash.com/photo-1517842645767-c639042777db?auto=format&fit=crop&w=800&q=85', ['graduation','birthday'], ['student','friend','teacher'], ['stationery','art'], 'handmade', 'stationery', true],
                    ['Thiệp nổi hoa giấy', 'Thiệp cắt giấy thủ công kèm phong bì.', 89000, 40, 'https://images.unsplash.com/photo-1512909006721-3d6018887383?auto=format&fit=crop&w=800&q=85', ['birthday','thank-you','graduation'], ['friend','teacher','mother'], ['craft','stationery'], 'handmade', 'card', false],
                    ['Bộ móc khóa len', 'Móc khóa len đan tay, màu sắc có thể thay đổi theo lô.', 119000, 16, 'https://images.unsplash.com/photo-1452860606245-08befc0ff44b?auto=format&fit=crop&w=800&q=85', ['birthday','housewarming'], ['friend','child','sister'], ['craft'], 'playful', 'accessory', false]
                ]},
                { category: 'Quà văn phòng', products: [
                    ['Bình giữ nhiệt tối giản', 'Bình giữ nhiệt dung tích 500ml, thiết kế tối giản.', 325000, 20, 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=800&q=85', ['promotion','thank-you'], ['colleague','manager','teacher'], ['coffee','outdoors'], 'minimal', 'daily-use', true],
                    ['Bộ bút ký thanh lịch', 'Bộ bút ký trong hộp quà, phù hợp dịp chúc mừng.', 259000, 11, 'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=800&q=85', ['promotion','graduation'], ['colleague','manager','teacher'], ['stationery'], 'classic', 'stationery', false],
                    ['Cốc cà phê gốm', 'Cốc gốm thủ công dùng tại văn phòng hoặc ở nhà.', 149000, 19, 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=800&q=85', ['housewarming','thank-you'], ['colleague','friend','coffee-lover'], ['coffee','home'], 'minimal', 'kitchen', false]
                ]},
                { category: 'Hoa & cây', products: [
                    ['Chậu sen đá để bàn', 'Chậu sen đá nhỏ gọn, dễ chăm sóc trong không gian sáng.', 129000, 15, 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=800&q=85', ['housewarming','birthday'], ['colleague','friend','mother'], ['gardening','plants'], 'natural', 'plant', true],
                    ['Giỏ hoa chúc mừng', 'Giỏ hoa tươi trang nhã dùng trong dịp chúc mừng.', 590000, 6, 'https://images.unsplash.com/photo-1525310072745-f49212b5ac6d?auto=format&fit=crop&w=800&q=85', ['promotion','graduation'], ['teacher','manager','mother'], ['flowers','gardening'], 'classic', 'flowers', false]
                ]},
                { category: 'Lifestyle', products: [] }
            ];

            for (const group of catalog) {
                const [existing] = await dbConn.execute('SELECT id FROM categories WHERE name = ? LIMIT 1', [group.category]);
                let categoryId = existing[0]?.id;
                if (!categoryId) {
                    const [created] = await dbConn.execute('INSERT INTO categories (name, description) VALUES (?, ?)', [group.category, `Quà tặng thuộc danh mục ${group.category}.`]);
                    categoryId = created.insertId;
                }
                for (const [name, description, price, stock, imageUrl, occasions, recipients, interests, style, type, featured] of group.products) {
                    await dbConn.execute(
                        `INSERT INTO products (category_id,name,description,price,stock,image_url,status,occasion_tags,recipient_tags,interest_tags,style,gift_type,is_featured,is_synthetic_display)
                         SELECT ?,?,?,?, ?,?,'ACTIVE',CAST(? AS JSON),CAST(? AS JSON),CAST(? AS JSON),?,?,?,FALSE
                         WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = ? LIMIT 1)`,
                        [categoryId,name,description,price,stock,imageUrl,JSON.stringify(occasions),JSON.stringify(recipients),JSON.stringify(interests),style,type,featured,name]
                    );
                }
            }
            console.log(`[resetTestDb] Đã seed 5 danh mục và 14 sản phẩm thật vào \`${targetDb}\`.`);
        }

        if (seedDemo) {
            console.log(`[resetTestDb] Nạp catalog demo từ file đã commit, trực tiếp vào \`${targetDb}\`...`);
            const { import1000Catalog } = require('./import1000Catalog');
            const { applyGiftTags } = require('./applyGiftTags');
            const { simulateTransactions } = require('./simulateTransactions');
            await import1000Catalog(targetDb, { isApply: true });
            await applyGiftTags(targetDb, { isApply: true });
            await simulateTransactions(targetDb, { isApply: true, numOrders: 2000, numEvents: 20000 });
        }

        const [[tablesCount]] = await dbConn.query('SELECT COUNT(*) total FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
        console.log(`[resetTestDb] Hoàn tất reset \`${targetDb}\`: tổng cộng ${tablesCount.total} bảng.`);
    } finally {
        await dbConn.end();
    }
}

if (require.main === module) {
    const target = process.argv[2] || 'giftly_e2e_test';
    const seed = process.argv.includes('--seed');
    const seedDemo = process.argv.includes('--seed-demo');
    resetTestDatabase(target, { seed, seedDemo })
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('LỖI THỰC THI resetTestDb:', err.message);
            process.exit(1);
        });
}

module.exports = { resetTestDatabase, assertSafeTestDatabase };
