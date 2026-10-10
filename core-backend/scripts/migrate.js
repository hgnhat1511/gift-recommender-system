require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('../config/db');

async function migrate() {
    const directory = path.join(__dirname, '..', '..', 'database', 'migrations');
    const files = (await fs.readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
    for (const name of files) {
        const sql = await fs.readFile(path.join(directory, name), 'utf8');
        for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
            await pool.query(statement);
        }
    }
    const productColumns = [
        ['occasion_tags', 'JSON NULL'], ['recipient_tags', 'JSON NULL'], ['interest_tags', 'JSON NULL'],
        ['style', 'VARCHAR(80) NULL'], ['gift_type', 'VARCHAR(80) NULL'], ['is_featured', 'BOOLEAN NOT NULL DEFAULT FALSE']
    ];
    for (const [name, definition] of productColumns) {
        const [rows] = await pool.execute(
            'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
            ['products', name]
        );
        if (!rows.length) await pool.query(`ALTER TABLE products ADD COLUMN \`${name}\` ${definition}`);
    }
    for (const [name, definition] of [['is_active','BOOLEAN NOT NULL DEFAULT TRUE'],['sort_order','INT NOT NULL DEFAULT 0']]) {
        const [rows] = await pool.execute(
            'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
            ['categories', name]
        );
        if (!rows.length) await pool.query(`ALTER TABLE categories ADD COLUMN \`${name}\` ${definition}`);
    }
    const [idempotencyColumn] = await pool.execute(
        "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='idempotency_key' LIMIT 1"
    );
    if (!idempotencyColumn.length) await pool.query('ALTER TABLE orders ADD COLUMN idempotency_key VARCHAR(100) NULL AFTER order_code');
    const [idempotencyIndex] = await pool.execute(
        "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='uq_orders_user_idempotency' LIMIT 1"
    );
    if (!idempotencyIndex.length) await pool.query('ALTER TABLE orders ADD UNIQUE KEY uq_orders_user_idempotency (user_id,idempotency_key)');
    for (const [name,definition] of [['shipping_carrier','VARCHAR(100) NULL'],['tracking_number','VARCHAR(100) NULL']]) {
        const [rows]=await pool.execute(
            'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1',
            ['orders',name]
        );
        if(!rows.length)await pool.query(`ALTER TABLE orders ADD COLUMN \`${name}\` ${definition}`);
    }
    const [shippingMethodColumn] = await pool.execute(
        "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='shipping_method' LIMIT 1"
    );
    if (!shippingMethodColumn.length) {
        await pool.query("ALTER TABLE orders ADD COLUMN shipping_method ENUM('STANDARD','EXPRESS') NOT NULL DEFAULT 'STANDARD' AFTER payment_method");
    }
    const [cartSelection] = await pool.execute(
        "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cart_items' AND COLUMN_NAME='is_selected' LIMIT 1"
    );
    if (!cartSelection.length) await pool.query('ALTER TABLE cart_items ADD COLUMN is_selected BOOLEAN NOT NULL DEFAULT TRUE');    console.log(`Database migrations applied (${files.join(', ')}). Existing rows were preserved.`);
}

migrate().catch((error) => {
    console.error('Database migration failed:', error.code || 'unexpected error');
    process.exitCode = 1;
}).finally(async () => pool.end());
