'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('node:fs/promises');
const mysql = require('mysql2/promise');

async function runSchemaComparison() {
    const rawTargetDb = 'giftly_schema_check_test';
    const existingDb = 'giftly_e2e_test';

    console.log(`[SchemaCheck] 1. Khởi tạo database kiểm tra migration thuần: "${rawTargetDb}"...`);
    const serverConn = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'rootpassword'
    });

    try {
        await serverConn.query(`DROP DATABASE IF EXISTS \`${rawTargetDb}\``);
        await serverConn.query(`CREATE DATABASE \`${rawTargetDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    } finally {
        await serverConn.end();
    }

    const rawConn = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'rootpassword',
        database: rawTargetDb
    });

    const migrationsDir = path.join(__dirname, '..', '..', 'database', 'migrations');
    const files = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
    console.log(`[SchemaCheck] 2. Thực thi CHỈ ${files.length} file migration thuần trên "${rawTargetDb}" (KHÔNG mở rộng động)...`);

    for (const file of files) {
        const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
        for (const statement of sql.split(';').map((p) => p.trim()).filter(Boolean)) {
            if (/^USE\s+`?[A-Za-z0-9_$]+`?$/i.test(statement)) continue;
            try {
                await rawConn.query(statement);
            } catch (err) {
                // Một số câu ALTER lặp lại có thể bỏ qua nếu trùng
                if (!err.message.includes('Duplicate column') && !err.message.includes('Duplicate key')) {
                    console.warn(`[SchemaCheck] Cảnh báo tại ${file}: ${err.message}`);
                }
            }
        }
    }

    const existingConn = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'rootpassword',
        database: existingDb
    });

    console.log(`[SchemaCheck] 3. Đang so sánh SHOW CREATE TABLE giữa "${rawTargetDb}" và "${existingDb}"...`);

    const [rawTables] = await rawConn.query('SHOW TABLES');
    const [existingTables] = await existingConn.query('SHOW TABLES');

    const rawTableNames = rawTables.map((r) => Object.values(r)[0]).sort();
    const existingTableNames = existingTables.map((r) => Object.values(r)[0]).sort();

    console.log(`\n=== TỔNG QUAN SỐ BẢNG ===`);
    console.log(`- Migration thuần (${rawTargetDb}): ${rawTableNames.length} bảng`);
    console.log(`- Database hiện tại (${existingDb}): ${existingTableNames.length} bảng`);

    const missingInRaw = existingTableNames.filter((t) => !rawTableNames.includes(t));
    const extraInRaw = rawTableNames.filter((t) => !existingTableNames.includes(t));
    if (missingInRaw.length) console.log(`- Bảng thiếu trong migration thuần:`, missingInRaw);
    if (extraInRaw.length) console.log(`- Bảng thừa trong migration thuần:`, extraInRaw);

    const commonTables = rawTableNames.filter((t) => existingTableNames.includes(t));
    const differences = [];

    for (const table of commonTables) {
        const [[rawCreate]] = await rawConn.query(`SHOW CREATE TABLE \`${table}\``);
        const [[existingCreate]] = await existingConn.query(`SHOW CREATE TABLE \`${table}\``);

        const rawSql = rawCreate['Create Table'];
        const existingSql = existingCreate['Create Table'];

        // Lấy danh sách cột
        const [rawCols] = await rawConn.execute(`DESCRIBE \`${table}\``);
        const [existingCols] = await existingConn.execute(`DESCRIBE \`${table}\``);

        const rawColMap = new Map(rawCols.map((c) => [c.Field, c]));
        const existingColMap = new Map(existingCols.map((c) => [c.Field, c]));

        const missingCols = [];
        for (const [colName, colMeta] of existingColMap) {
            if (!rawColMap.has(colName)) {
                missingCols.push({ column: colName, type: colMeta.Type, null: colMeta.Null, default: colMeta.Default });
            }
        }

        // Lấy danh sách index
        const [rawKeys] = await rawConn.execute(`SHOW INDEX FROM \`${table}\``);
        const [existingKeys] = await existingConn.execute(`SHOW INDEX FROM \`${table}\``);

        const rawKeyNames = new Set(rawKeys.map((k) => k.Key_name));
        const missingKeys = [];
        for (const k of existingKeys) {
            if (!rawKeyNames.has(k.Key_name) && !missingKeys.includes(k.Key_name)) {
                missingKeys.push(k.Key_name);
            }
        }

        if (missingCols.length || missingKeys.length) {
            differences.push({
                table,
                missingColumns: missingCols,
                missingIndexes: missingKeys
            });
        }
    }

    console.log(`\n=== CHI TIẾT CHÊNH LỆCH THEO BẢNG ===`);
    if (differences.length === 0) {
        console.log('Không có chênh lệch nào giữa migration thuần và database hiện tại!');
    } else {
        for (const diff of differences) {
            console.log(`\n[BẢNG: ${diff.table}]`);
            if (diff.missingColumns.length) {
                console.log(`  - Cột thiếu trong migration thuần:`);
                for (const col of diff.missingColumns) {
                    console.log(`    + \`${col.column}\` ${col.type} (NULL: ${col.null}, Default: ${col.default})`);
                }
            }
            if (diff.missingIndexes.length) {
                console.log(`  - Chỉ mục (Index/Unique) thiếu:`);
                for (const idx of diff.missingIndexes) {
                    console.log(`    + Key: ${idx}`);
                }
            }
        }
    }

    await rawConn.end();
    await existingConn.end();

    // Dọn dẹp DB tạm
    const cleanConn = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'rootpassword'
    });
    try {
        await cleanConn.query(`DROP DATABASE IF EXISTS \`${rawTargetDb}\``);
        console.log(`\n[SchemaCheck] Đã dọn dẹp database tạm "${rawTargetDb}".`);
    } finally {
        await cleanConn.end();
    }
}

runSchemaComparison().catch((err) => {
    console.error('LỖI THỰC THI SCHEMA CHECK:', err);
    process.exit(1);
});
