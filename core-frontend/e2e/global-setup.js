import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const { resetTestDatabase } = require('../../core-backend/scripts/resetTestDb.js');
const mysql = require('../../core-backend/node_modules/mysql2/promise');
const bcrypt = require('../../core-backend/node_modules/bcryptjs');

export default async function globalSetup() {
  const targetDb = process.env.PLAYWRIGHT_DB_NAME || 'giftly_e2e_test';
  console.log(`[Playwright globalSetup] Khởi tạo database test: "${targetDb}" với --seed...`);
  await resetTestDatabase(targetDb, { seed: true });

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'rootpassword',
    database: targetDb,
  });

  try {
    // 1. Lấy danh mục đầu tiên
    const [categories] = await conn.execute('SELECT id FROM categories LIMIT 1');
    const categoryId = categories[0]?.id || 1;

    // 2. Thêm 1 sản phẩm synthetic phục vụ kiểm thử Playwright
    await conn.execute(
      `INSERT INTO products (
        category_id, name, description, price, stock, image_url, status,
        is_synthetic_display, ml_product_id, occasion_tags, recipient_tags, interest_tags
      ) VALUES (
        ?, 'Sản phẩm Demo Synthetic Lifestyle',
        'Mô tả sản phẩm demo synthetic phục vụ kiểm thử hệ thống gợi ý.',
        199000, 10, 'https://images.unsplash.com/photo-1513201099705-a9746e1e201f?auto=format&fit=crop&w=800&q=85',
        'ACTIVE', TRUE, 999999, '["birthday"]', '["friend"]', '["decor"]'
      ) ON DUPLICATE KEY UPDATE is_synthetic_display = TRUE, ml_product_id = 999999`,
      [categoryId]
    );

    // 3. Thêm 1 tài khoản demo có ml_user_id để kiểm thử Playwright
    const passwordHash = await bcrypt.hash('Demo-User-ML-2026!', 10);
    await conn.execute(
      `INSERT INTO users (full_name, email, password_hash, role, status, ml_user_id)
       VALUES ('Tài khoản Demo ML', 'demo-ml@giftly.test', ?, 'USER', 'ACTIVE', 888888)
       ON DUPLICATE KEY UPDATE ml_user_id = 888888`,
      [passwordHash]
    );

    console.log('[Playwright globalSetup] Đã chuẩn bị xong catalog seed + 1 sản phẩm synthetic + 1 tài khoản demo ML.');
  } finally {
    await conn.end();
  }
}
