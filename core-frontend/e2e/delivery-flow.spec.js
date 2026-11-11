import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { expect, request, test } from '@playwright/test';

const require = createRequire(import.meta.url);
const backendDirectory = path.resolve(process.cwd(), '../core-backend');
const backendUrl = process.env.E2E_BACKEND_URL || 'http://localhost:5000';
require(path.join(backendDirectory, 'node_modules/dotenv')).config({ path: path.join(backendDirectory, '.env') });
const mysql = require(path.join(backendDirectory, 'node_modules/mysql2/promise'));
const jwt = require(path.join(backendDirectory, 'node_modules/jsonwebtoken'));
const databaseName = process.env.PLAYWRIGHT_DB_NAME || 'giftly_e2e_test';
let pool;

test.beforeAll(async () => {
  if (databaseName !== 'giftly_e2e_test') throw new Error(`Delivery E2E only writes to giftly_e2e_test; received "${databaseName}".`);
  process.env.DB_NAME = databaseName;
  process.env.TEST_DB_NAME = databaseName;
  pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'rootpassword',
    database: databaseName,
    connectionLimit: 2,
  });
  const [[db]] = await pool.query('SELECT DATABASE() name');
  console.log(`[delivery-flow.spec.js] SELECT DATABASE(): ${db.name}`);
  expect(db.name).toBe(databaseName);
});

test.afterAll(async () => { if (pool) await pool.end(); });

async function createSession(role) {
  const email = `delivery-${role.toLowerCase()}-${randomUUID()}@example.invalid`;
  const [result] = await pool.execute(
    'INSERT INTO users (full_name,email,password_hash,role,status) VALUES (?,?,?,? ,\'ACTIVE\')',
    [`Delivery E2E ${role}`, email, 'test-only-no-login', role],
  );
  const token = jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: 'HS256', subject: String(result.insertId), expiresIn: '20m',
    issuer: 'giftly-api', audience: 'giftly-client',
  });
  return { id: String(result.insertId), email, token, role };
}

async function createProcessingOrder(userId, prefix = 'FLOW') {
  const orderCode = `${prefix}${randomUUID().replaceAll('-', '').slice(0, 18).toUpperCase()}`;
  const [result] = await pool.execute(`INSERT INTO orders
    (order_code,user_id,status,payment_method,shipping_method,payment_status,recipient_name,phone,shipping_address,
     subtotal,discount_amount,shipping_fee,total_amount)
    VALUES (?,?,'PROCESSING','COD','STANDARD','UNPAID','Delivery E2E Receiver','0900000000',?,159000,0,0,159000)`,
  [orderCode, userId, JSON.stringify({ addressLine: '1 Test Road', ward: 'Ward 1', district: 'District 1', city: 'HCMC' })]);
  return { id: String(result.insertId), orderCode };
}

async function openAs(page, session, route) {
  await page.goto('/');
  await page.evaluate((value) => localStorage.setItem('giftly.auth', JSON.stringify(value)), {
    token: session.token,
    user: { id: session.id, email: session.email, role: session.role, fullName: `Delivery E2E ${session.role}` },
  });
  await page.goto(route);
}

test('COD internal shipment: admin assigns, shipper delivers, customer confirms and opens a return', async ({ page }) => {
  const admin = await createSession('ADMIN');
  const shipperA = await createSession('SHIPPER');
  const shipperB = await createSession('SHIPPER');
  const customer = await createSession('USER');
  const assignedOrder = await createProcessingOrder(customer.id);
  const otherOrder = await createProcessingOrder(customer.id, 'OTHER');
  const api = await request.newContext({ baseURL: backendUrl });

  try {
    const assignedByOtherShipper = await api.post(`/api/admin/orders/${otherOrder.id}/shipper`, {
      headers: { authorization: `Bearer ${admin.token}` }, data: { shipperUserId: shipperB.id },
    });
    expect(assignedByOtherShipper.status()).toBe(201);

    await openAs(page, admin, '/admin/orders');
    await page.getByRole('button', { name: assignedOrder.orderCode }).click();
    await page.getByLabel('Shipper').selectOption(shipperA.id);
    await page.getByRole('button', { name: 'Gán shipper' }).click();
    await expect(page.getByText('Đã gán đơn cho shipper.')).toBeVisible();

    const listA = await api.get('/api/shipper/orders', { headers: { authorization: `Bearer ${shipperA.token}` } });
    const listB = await api.get('/api/shipper/orders', { headers: { authorization: `Bearer ${shipperB.token}` } });
    expect((await listA.json()).data.map((order) => order.id)).toContain(assignedOrder.id);
    expect((await listB.json()).data.map((order) => order.id)).not.toContain(assignedOrder.id);
    const deniedAdmin = await api.get('/api/admin/orders', { headers: { authorization: `Bearer ${shipperA.token}` } });
    expect(deniedAdmin.status()).toBe(403);

    await openAs(page, shipperA, '/shipper');
    const assignedCard = page.locator('.commerce-panel').filter({ hasText: assignedOrder.orderCode });
    await expect(assignedCard.getByRole('button', { name: /Bắt đầu giao/ })).toBeVisible();
    await assignedCard.getByRole('button', { name: /Bắt đầu giao/ }).click();
    await expect(assignedCard.getByRole('button', { name: /Xác nhận giao thành công/ })).toBeVisible();
    const deliveredResponse = page.waitForResponse((response) => response.url().includes(`/api/shipper/orders/${assignedOrder.id}/deliver`) && response.request().method() === 'POST');
    await assignedCard.getByRole('button', { name: /Xác nhận giao thành công/ }).click();
    expect((await deliveredResponse).status()).toBe(200);

    await expect(page.locator('.commerce-panel').filter({ hasText: assignedOrder.orderCode })).toHaveCount(0);
    const [[delivered]] = await pool.execute('SELECT status,payment_status,delivered_at FROM orders WHERE id=?', [assignedOrder.id]);
    expect([delivered.status, delivered.payment_status]).toEqual(['DELIVERED', 'PAID']);
    expect(delivered.delivered_at).toBeTruthy();

    await openAs(page, customer, `/orders/${assignedOrder.id}`);
    await page.getByRole('button', { name: 'Đã nhận hàng' }).click();
    await expect(page.getByText(/Bạn đã xác nhận nhận hàng/)).toBeVisible();
    await expect(page.getByText(/Hạn gửi yêu cầu đổi trả/)).toBeVisible();
    await page.getByPlaceholder('Lý do đổi trả').fill('Kiểm tra luồng E2E');
    await page.getByRole('button', { name: 'Gửi yêu cầu' }).click();
    await expect(page.getByText('Kiểm tra luồng E2E')).toBeVisible();

    const [[confirmed]] = await pool.execute('SELECT received_confirmed_at FROM orders WHERE id=?', [assignedOrder.id]);
    expect(confirmed.received_confirmed_at).toBeTruthy();
  } finally {
    await api.dispose();
  }
});

test('GHN webhook alone advances a GHN order to DELIVERED and marks COD paid', async () => {
  const customer = await createSession('USER');
  const order = await createProcessingOrder(customer.id, 'GHNE2E');
  const providerOrderCode = `GHN-${order.orderCode}`;
  await pool.execute("INSERT INTO shipments (order_id,client_order_code,provider,provider_order_code,status) VALUES (?,?,'GHN',?,'CREATED')", [order.id, order.orderCode, providerOrderCode]);
  const shopId = process.env.E2E_GHN_SHOP_ID;
  const webhookSecret = process.env.E2E_GHN_WEBHOOK_SECRET;
  expect(shopId).toBeTruthy();
  expect(webhookSecret).toBeTruthy();
  const api = await request.newContext({ baseURL: backendUrl });

  try {
    for (const [status, expected, seconds] of [['delivering', 'SHIPPED', 1], ['delivered', 'DELIVERED', 2]]) {
      const response = await api.post('/api/shipments/ghn/webhook', {
        headers: { 'x-giftly-shipping-secret': webhookSecret },
        data: {
          OrderCode: providerOrderCode, ClientOrderCode: order.orderCode, ShopID: shopId,
          Status: status, Type: 'switch_status', Time: new Date(Date.now() + seconds * 1000).toISOString(),
        },
      });
      expect(response.ok()).toBeTruthy();
      const [[saved]] = await pool.execute('SELECT status,payment_status,delivered_at FROM orders WHERE id=?', [order.id]);
      expect(saved.status).toBe(expected);
      if (expected === 'DELIVERED') {
        expect(saved.payment_status).toBe('PAID');
        expect(saved.delivered_at).toBeTruthy();
      }
    }
  } finally {
    await api.dispose();
  }
});
