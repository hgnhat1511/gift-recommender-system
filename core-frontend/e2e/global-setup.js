import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const backendDirectory = path.resolve(process.cwd(), '../core-backend');
require(path.join(backendDirectory, 'node_modules/dotenv')).config({ path: path.join(backendDirectory, '.env') });
const targetDb = process.env.PLAYWRIGHT_DB_NAME || 'giftly_e2e_test';

export default async function globalSetup() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to prepare Playwright fixtures in production.');
  if (targetDb !== 'giftly_e2e_test' || !/^[a-z0-9_]+_test$/i.test(targetDb)) {
    throw new Error(`Playwright only writes to giftly_e2e_test; received "${targetDb}".`);
  }
  if (!process.env.E2E_DEMO_USER_PASSWORD) throw new Error('Set E2E_DEMO_USER_PASSWORD to a local test-only password.');

  process.env.DB_NAME = targetDb;
  process.env.TEST_DB_NAME = targetDb;
  const mysql = require(path.join(backendDirectory, 'node_modules/mysql2/promise'));
  const bcrypt = require(path.join(backendDirectory, 'node_modules/bcryptjs'));
  const { import1000Catalog } = require(path.join(backendDirectory, 'scripts/import1000Catalog.js'));
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'rootpassword',
    database: targetDb,
  });

  try {
    const [[database]] = await connection.query('SELECT DATABASE() name');
    console.log(`[Playwright globalSetup] SELECT DATABASE(): ${database.name}`);
    if (database.name !== targetDb) throw new Error(`Connected to "${database.name}" instead of "${targetDb}".`);

    const [orderColumns] = await connection.query('SHOW COLUMNS FROM orders');
    const orderColumnNames = new Set(orderColumns.map((column) => column.Field));
    for (const name of ['delivered_at', 'received_confirmed_at', 'shipper_user_id']) {
      if (!orderColumnNames.has(name)) throw new Error(`Required migration column orders.${name} is missing in ${targetDb}.`);
    }
    const [[userRole]] = await connection.query("SHOW COLUMNS FROM users LIKE 'role'");
    if (!String(userRole.Type).includes('SHIPPER')) throw new Error(`SHIPPER role is missing in ${targetDb}.`);
    const [[shipmentProvider]] = await connection.query("SHOW COLUMNS FROM shipments LIKE 'provider'");
    if (!shipmentProvider) throw new Error(`shipments.provider is missing in ${targetDb}.`);

    // Seed only committed repository fixtures. The importer performs SELECT/INSERT/UPDATE and never deletes rows.
    await import1000Catalog(targetDb, { isApply: true });
    const [categories] = await connection.execute('SELECT id FROM categories ORDER BY id LIMIT 1');
    if (!categories.length) throw new Error(`No category fixture is available in ${targetDb}.`);
    await connection.execute(
      `INSERT INTO products (category_id, name, description, price, stock, image_url, status, is_synthetic_display, ml_product_id)
       VALUES (?, 'Playwright E2E Commerce Fixture', 'Isolated buyable fixture for Giftly Playwright flows.', 159000, 1000,
         'https://images.unsplash.com/photo-1513201099705-a9746e1e201f?auto=format&fit=crop&w=800&q=85', 'ACTIVE', FALSE, 987654321)
       ON DUPLICATE KEY UPDATE category_id=VALUES(category_id), name=VALUES(name), description=VALUES(description),
         price=VALUES(price), stock=1000, status='ACTIVE', is_synthetic_display=FALSE`,
      [categories[0].id]
    );

    await connection.execute(
      `INSERT INTO products (
        category_id, name, description, price, stock, image_url, status,
        is_synthetic_display, ml_product_id, occasion_tags, recipient_tags, interest_tags
      ) VALUES (
        ?, 'Sản phẩm Demo Synthetic Lifestyle',
        'Mô tả sản phẩm demo synthetic phục vụ kiểm thử hệ thống gợi ý.',
        199000, 10, 'https://images.unsplash.com/photo-1513201099705-a9746e1e201f?auto=format&fit=crop&w=800&q=85',
        'ACTIVE', TRUE, 999999, '["birthday"]', '["friend"]', '["decor"]'
      ) ON DUPLICATE KEY UPDATE category_id = VALUES(category_id), name = VALUES(name), description = VALUES(description),
        price = VALUES(price), stock = VALUES(stock), image_url = VALUES(image_url), status = 'ACTIVE',
        is_synthetic_display = TRUE, ml_product_id = 999999,
        occasion_tags = VALUES(occasion_tags), recipient_tags = VALUES(recipient_tags), interest_tags = VALUES(interest_tags)`,
      [categories[0].id]
    );
    await connection.execute("UPDATE products SET updated_at=NOW() WHERE ml_product_id=987654321");

    const passwordHash = await bcrypt.hash(process.env.E2E_DEMO_USER_PASSWORD, 10);
    await connection.execute(
      `INSERT INTO users (full_name, email, password_hash, role, status, ml_user_id)
       VALUES ('Tài khoản Demo ML', 'demo-ml@giftly.test', ?, 'USER', 'ACTIVE', 888889)
       ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), password_hash = VALUES(password_hash), role = 'USER', status = 'ACTIVE', ml_user_id = 888889`,
      [passwordHash]
    );
    console.log('[Playwright globalSetup] Idempotent fixtures ready; existing rows were not reset or deleted.');
  } finally {
    await connection.end();
  }
}
