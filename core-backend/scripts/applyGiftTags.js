/**
 * applyGiftTags.js
 * Gán thẻ quà tặng (dịp tặng, người nhận, ngân sách) cho 1.000 sản phẩm demo REES46.
 * Áp dụng bảng luật suy diễn quy tắc rule_v1 từ core-backend/data/gift_tag_rules.json.
 * 
 * RÀNG BUỘC AN TOÀN:
 * - Mặc định --dry-run; chỉ ghi khi có cờ --apply.
 * - Idempotent: chạy nhiều lần ra cùng một kết quả.
 * - Không ghi đè thẻ của 14 sản phẩm seed cơ sở (chỉ cập nhật WHERE is_synthetic_display = TRUE).
 * - Bắt buộc tên DB kết thúc bằng '_test'. Chỉ cho phép ghi vào DB dev nếu có đủ:
 *   cờ '--allow-dev' VÀ biến môi trường ALLOW_DEV_TAG_APPLY=true.
 * - Ghi toàn bộ trong một Transaction duy nhất.
 */
'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('node:fs/promises');
const mysql = require('mysql2/promise');

async function applyGiftTags(targetDb, options = {}) {
    const { isApply = false, allowDev = false } = options;
    const rulesPath = path.join(__dirname, '..', 'data', 'gift_tag_rules.json');
    const previewCsvPath = path.join(__dirname, '..', 'data', 'gift_tag_preview.csv');

    const rules = JSON.parse(await fs.readFile(rulesPath, 'utf8'));
    console.log(`[applyGiftTags] Đọc bảng luật phiên bản: "${rules.version}" (source: ${rules.source})`);

    // Kiểm tra an toàn tên database
    const dbName = String(targetDb || '').trim();
    if (!dbName) {
        throw new Error('LỖI: Chưa chỉ định tên database mục tiêu.');
    }

    if (process.env.NODE_ENV === 'production') {
        throw new Error('LỖI BẢO VỆ: Không được phép thao tác trên môi trường NODE_ENV=production!');
    }

    const isTestDb = dbName.endsWith('_test');
    if (!isTestDb) {
        const envConfirmed = process.env.ALLOW_DEV_TAG_APPLY === 'true';
        if (!allowDev || !envConfirmed) {
            throw new Error(`LỖI BẢO VỆ: Database "${dbName}" không phải DB test (không kết thúc bằng _test). ` +
                `Để áp dụng lên DB dev, bắt buộc truyền cờ --allow-dev VÀ thiết lập biến môi trường ALLOW_DEV_TAG_APPLY=true.`);
        }
        console.warn(`[CẢNH BÁO] Đang thao tác trên DB dev "${dbName}" với đầy đủ xác nhận an toàn (--allow-dev + ALLOW_DEV_TAG_APPLY=true).`);
    } else {
        console.log(`[applyGiftTags] Thao tác trên DB test an toàn: "${dbName}"`);
    }

    // Đọc file preview CSV để lấy danh sách thẻ đã tính toán
    const csvContent = await fs.readFile(previewCsvPath, 'utf8');
    const lines = csvContent.split(/\r?\n/).filter(Boolean);
    const header = lines[0].split(',');
    
    const tagMapByMlId = new Map();
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length >= 8) {
            const mlId = Number(cols[1]);
            const recipientTags = cols[4].split('|').filter(Boolean);
            const occasionTags = cols[5].split('|').filter(Boolean);
            const budgetTag = cols[6];
            tagMapByMlId.set(mlId, { recipientTags, occasionTags, budgetTag });
        }
    }

    console.log(`[applyGiftTags] Đã nạp quy tắc gán thẻ cho ${tagMapByMlId.size} sản phẩm demo.`);

    // Kết nối MySQL
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: dbName
    });

    try {
        // Kiểm tra số sản phẩm synthetic hiện có trong DB
        const [[countRow]] = await connection.query(
            "SELECT COUNT(*) total FROM products WHERE is_synthetic_display = TRUE"
        );
        const totalSynthetic = Number(countRow.total);
        console.log(`[applyGiftTags] Tìm thấy ${totalSynthetic} sản phẩm synthetic trong DB "${dbName}".`);

        if (totalSynthetic === 0) {
            console.warn(`[applyGiftTags] Không tìm thấy sản phẩm synthetic nào để cập nhật trong "${dbName}".`);
            return { totalUpdated: 0, isApply };
        }

        if (!isApply) {
            console.log(`[DRY-RUN] Chạy thử nghiệm thành công. Sẽ cập nhật ${totalSynthetic} sản phẩm khi có cờ --apply.`);
            return { totalUpdated: totalSynthetic, isApply: false };
        }

        // Bắt đầu Transaction ghi
        console.log(`[APPLY] Bắt đầu Transaction cập nhật thẻ cho ${totalSynthetic} sản phẩm demo...`);
        await connection.beginTransaction();

        let updatedCount = 0;
        const [rows] = await connection.query(
            "SELECT id, ml_product_id, price FROM products WHERE is_synthetic_display = TRUE"
        );

        const updateStmt = `
            UPDATE products 
            SET recipient_tags = ?, occasion_tags = ?, interest_tags = JSON_ARRAY('lifestyle', ?)
            WHERE id = ? AND is_synthetic_display = TRUE
        `;

        for (const row of rows) {
            const mlId = Number(row.ml_product_id);
            const tags = tagMapByMlId.get(mlId);
            if (tags) {
                await connection.execute(updateStmt, [
                    JSON.stringify(tags.recipientTags),
                    JSON.stringify(tags.occasionTags),
                    tags.budgetTag,
                    row.id
                ]);
                updatedCount++;
            }
        }

        // Commit transaction
        await connection.commit();
        console.log(`[APPLY] Đã commit thành công transaction! Tổng số sản phẩm được cập nhật thẻ: ${updatedCount}.`);

        // Kiểm tra lại sau khi cập nhật
        const [[verifyRow]] = await connection.query(`
            SELECT 
                COUNT(*) total,
                SUM(CASE WHEN JSON_LENGTH(recipient_tags) > 0 THEN 1 ELSE 0 END) has_recipient,
                SUM(CASE WHEN JSON_LENGTH(occasion_tags) > 0 THEN 1 ELSE 0 END) has_occasion
            FROM products 
            WHERE is_synthetic_display = TRUE
        `);
        console.log(`[XÁC MINH TOÀN VẸN]`);
        console.log(`- Tổng sản phẩm demo: ${verifyRow.total}`);
        console.log(`- Có thẻ người nhận: ${verifyRow.has_recipient}`);
        console.log(`- Có thẻ dịp tặng: ${verifyRow.has_occasion}`);

        // Đảm bảo không ảnh hưởng 14 sản phẩm seed
        const [[seedRow]] = await connection.query(`
            SELECT COUNT(*) total FROM products WHERE is_synthetic_display = FALSE OR is_synthetic_display IS NULL
        `);
        console.log(`- Sản phẩm seed cơ sở (không bị chạm): ${seedRow.total}`);

        return { totalUpdated: updatedCount, isApply: true };
    } catch (err) {
        if (isApply) {
            await connection.rollback();
            console.error(`[ROLLBACK] Gặp lỗi, đã rollback toàn bộ transaction:`, err.message);
        }
        throw err;
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    const targetDb = process.argv[2] || 'giftly_e2e_test';
    const isApply = process.argv.includes('--apply');
    const allowDev = process.argv.includes('--allow-dev');

    applyGiftTags(targetDb, { isApply, allowDev })
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('LỖI THỰC THI applyGiftTags:', err.message);
            process.exit(1);
        });
}

module.exports = { applyGiftTags };
