import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { expect, request, test } from '@playwright/test';
import { CUSTOMER_STATUS, ORDER_STATUS, RETURN_STATUS } from '../src/lib/labels.js';

const require = createRequire(import.meta.url);
const backendDirectory = path.resolve(process.cwd(), '../core-backend');

async function openAuthenticatedPage(page, session, path) {
  await page.goto('/');
  await page.evaluate((value) => localStorage.setItem('giftly.auth', JSON.stringify(value)), session);
  await page.goto(path);
}

test('guest can browse the live catalog and keep a product in the cart', async ({ page }) => {
  await page.goto('/products');

  const firstProduct = page.locator('.commerce-product').first();
  await expect(firstProduct).toBeVisible();
  const productName = (await firstProduct.locator('.commerce-product-name').innerText()).trim();
  await firstProduct.getByRole('button').click();
  await expect(page.locator('.commerce-alert-success')).toContainText('Đã thêm sản phẩm vào giỏ hàng.');

  await page.goto('/cart');
  await expect(page.getByText(productName, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Đăng nhập để tiếp tục' })).toBeVisible();
});

test('customer can log in, place a COD order, and view its order detail', async ({ page }) => {
  const api = await request.newContext({ baseURL: 'http://localhost:5000' });
  const email = `e2e-${randomUUID()}@example.invalid`;
  const password = 'E2E-Store-Test-2026!';

  try {
    const registration = await api.post('/api/auth/register', {
      data: { fullName: 'Giftly browser fixture', email, password },
    });
    expect(registration.status()).toBe(201);
    await page.goto('/login');
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill(password);
    await page.locator('form.auth-form button.auth-submit').click();
    await expect(page).toHaveURL('http://localhost:5173/');
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem('giftly.auth')).token);
    await page.goto('/account#addresses');
    const addressForm = page.locator('#addresses form.account-address-form');
    const addressFields = addressForm.locator('label');
    await addressFields.nth(0).locator('input').fill('Giftly browser fixture');
    await addressFields.nth(1).locator('input').fill('0900000003');
    await addressFields.nth(2).locator('input').fill('789 Test Street');
    await addressFields.nth(3).locator('select').selectOption('new');
    await addressFields.nth(4).locator('input').fill('Phường Sài Gòn');
    await addressFields.nth(5).locator('input').fill('Hồ Chí Minh');
    await addressForm.getByRole('button', { name: /Thêm địa chỉ/ }).click();
    await expect(page.locator('.account-address').first()).toContainText('Phường Sài Gòn');

    await page.goto('/products');
    const firstProduct = page.locator('.commerce-product').first();
    await expect(firstProduct).toBeVisible();
    const productName = (await firstProduct.locator('.commerce-product-name').innerText()).trim();
    await firstProduct.getByRole('button').click();
    await expect(page.locator('.commerce-alert-success')).toBeVisible();

    await page.goto('/cart');
    await expect(page.locator('.commerce-cart-row .commerce-cart-info b').filter({ hasText: productName })).toBeVisible();
    await page.getByRole('link', { name: /Tiến hành đặt hàng/ }).click();
    const placeOrder = page.getByRole('button', { name: /Đặt hàng COD/ });
    await expect(placeOrder).toBeEnabled({ timeout: 10_000 });
    await placeOrder.click();
    await expect(page).toHaveURL(/\/orders\/\d+\?placed=1/);
    await expect(page.locator('.commerce-page-heading h1')).toBeVisible();
    // Đơn COD khi kho còn hàng được backend tự động chuyển sang PROCESSING (Đang chuẩn bị hàng)
    await expect(page.locator('.commerce-page-heading .commerce-status')).toHaveText(ORDER_STATUS.PROCESSING);
    await expect(page.locator('.commerce-cart-row .commerce-cart-info b').filter({ hasText: productName })).toBeVisible();
    const orderId = Number(page.url().match(/\/orders\/(\d+)/)?.[1]);
    const orderDetail = await api.get(`/api/orders/${orderId}`, { headers: { authorization: `Bearer ${token}` } });
    expect((await orderDetail.json()).data.shippingAddress.isNewAdministrativeAddress).toBe(true);
  } finally {
    await api.dispose();
  }
});

test('customer can start VNPAY checkout and return unpaid until a verified provider callback', async ({ page }) => {
  const api = await request.newContext({ baseURL: 'http://localhost:5000' });
  const email = `e2e-vnpay-${randomUUID()}@example.invalid`;
  const password = 'E2E-VNPAY-Store-2026!';

  try {
    const registration = await api.post('/api/auth/register', {
      data: { fullName: 'Giftly VNPAY browser fixture', email, password },
    });
    expect(registration.status()).toBe(201);
    await page.goto('/login');
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill(password);
    await page.locator('form.auth-form button.auth-submit').click();
    await expect(page).toHaveURL('http://localhost:5173/');
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem('giftly.auth')).token);
    const address = await api.post('/api/account/addresses', {
      headers: { authorization: `Bearer ${token}` },
      data: {
        recipientName: 'Giftly VNPAY browser fixture', phone: '0900000006', addressLine: '654 Test Street',
        ward: 'Ward 3', district: 'District 3', city: 'Ho Chi Minh City', isDefault: true,
      },
    });
    expect(address.status()).toBe(201);

    await page.goto('/products');
    const firstProduct = page.locator('.commerce-product').first();
    await expect(firstProduct).toBeVisible();
    await firstProduct.getByRole('button').click();
    await page.goto('/cart');
    await page.getByRole('link', { name: /Tiến hành đặt hàng/ }).click();
    await page.locator('input[name="paymentMethod"][value="VNPAY"]').check();
    await expect(page.locator('.commerce-order-summary .commerce-button')).toBeEnabled({ timeout: 10_000 });

    await page.route('https://sandbox.vnpayment.vn/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<main><h1>Intercepted VNPAY sandbox page</h1></main>',
    }));
    let paymentPayload;
    await page.route('http://localhost:5000/api/payments/orders/*/vnpay', async (route) => {
      const response = await route.fetch();
      paymentPayload = await response.json();
      await route.fulfill({ response });
    });
    const orderPromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/orders') && response.request().method() === 'POST');
    const paymentResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/payments/orders/') && response.url().endsWith('/vnpay') && response.request().method() === 'POST');
    const submit = page.locator('.commerce-order-summary .commerce-button');
    await submit.click();
    const orderResponse = await orderPromise;
    expect(orderResponse.status()).toBe(201);
    const orderId = (await orderResponse.json()).data.orderId;

    const paymentResponse = await paymentResponsePromise;
    expect(paymentResponse.status()).toBe(200);
    const paymentUrl = paymentPayload.data.paymentUrl;
    expect(paymentUrl).toMatch(/^https:\/\/sandbox\.vnpayment\.vn\//);
    await expect(page).toHaveURL(/sandbox\.vnpayment\.vn/);
    await expect(page.getByRole('heading', { name: 'Intercepted VNPAY sandbox page' })).toBeVisible();

    const orderDetail = await api.get(`/api/orders/${orderId}`, { headers: { authorization: `Bearer ${token}` } });
    expect(orderDetail.ok()).toBeTruthy();
    expect((await orderDetail.json()).data.paymentStatus).toBe('UNPAID');
  } finally {
    await api.dispose();
  }
});

test('admin can view dashboard and adjust inventory with an auditable ledger entry', async ({ page }) => {
  const api = await request.newContext({ baseURL: 'http://localhost:5000' });
  const email = `e2e-admin-${randomUUID()}@example.invalid`;
  const password = 'E2E-Admin-Test-2026!';
  const testDatabase = process.env.PLAYWRIGHT_DB_NAME || 'giftly_e2e_test';
  let productId;
  let pendingDelta = 0;

  try {
    const registration = await api.post('/api/auth/register', {
      data: { fullName: 'Giftly admin browser fixture', email, password },
    });
    expect(registration.status()).toBe(201);
    execFileSync('node', ['scripts/promoteAdmin.js', email], {
      cwd: backendDirectory,
      env: { ...process.env, DB_NAME: testDatabase },
      stdio: 'pipe',
    });
    const login = await api.post('/api/auth/login', { data: { email, password } });
    expect(login.ok()).toBeTruthy();
    const loginBody = await login.json();
    expect(loginBody.data.user.role).toBe('ADMIN');

    await openAuthenticatedPage(page, loginBody.data, '/admin');
    await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();
    await expect(page.getByText('Sản phẩm đang bán')).toBeVisible();

    await page.goto('/admin/products');
    const firstProductRow = page.getByRole('row').nth(1);
    await expect(firstProductRow).toBeVisible();
    const productName = (await firstProductRow.locator('td').first().innerText()).split('\n')[0].trim();
    productId = Number((await firstProductRow.locator('td').first().innerText()).match(/ID (\d+)/)?.[1]);
    expect(productId).toBeGreaterThan(0);
    const startingStock = Number(await firstProductRow.locator('td').nth(3).innerText());

    const promptAnswers = [];
    page.on('dialog', (dialog) => dialog.accept(promptAnswers.shift()));
    const adjust = async (delta, reason) => {
      promptAnswers.push(String(delta), reason);
      const responsePromise = page.waitForResponse((response) =>
        response.url().includes(`/api/admin/products/${productId}/inventory`) && response.request().method() === 'POST');
      await firstProductRow.getByRole('button', { name: /Điều chỉnh kho/ }).click();
      const response = await responsePromise;
      if (response.ok()) pendingDelta += delta;
      expect(response.status()).toBe(200);
      await expect(page.locator('.commerce-alert-success')).toContainText('Đã điều chỉnh kho');
      await expect(firstProductRow.locator('td').nth(3)).toHaveText(String(startingStock + pendingDelta));
    };

    await adjust(2, 'Playwright E2E stock intake');
    await page.goto('/admin/inventory');
    await page.getByPlaceholder('Tìm theo sản phẩm hoặc lý do').fill('Playwright E2E stock intake');
    const ledgerRow = page.getByRole('row').filter({ hasText: 'Playwright E2E stock intake' });
    await expect(ledgerRow).toBeVisible();
    await expect(ledgerRow.locator('td').nth(1)).toContainText(productName);
    await expect(ledgerRow.locator('td').nth(2)).toHaveText('+2');

    await page.goto('/admin/products');
    await expect(firstProductRow).toBeVisible();
    await adjust(-2, 'Playwright E2E stock rollback');
    expect(pendingDelta).toBe(0);
  } finally {
    await api.dispose();
  }
});

test('admin can inspect an order, advance its state, and cancel it safely', async ({ page }) => {
  const api = await request.newContext({ baseURL: 'http://localhost:5000' });
  const testDatabase = process.env.PLAYWRIGHT_DB_NAME || 'giftly_e2e_test';
  const customerEmail = `e2e-order-${randomUUID()}@example.invalid`;
  const adminEmail = `e2e-admin-${randomUUID()}@example.invalid`;
  const customerPassword = 'E2E-Order-Test-2026!';
  const adminPassword = 'E2E-Admin-Order-2026!';

  try {
    const customerRegistration = await api.post('/api/auth/register', {
      data: { fullName: 'Giftly order browser fixture', email: customerEmail, password: customerPassword },
    });
    expect(customerRegistration.status()).toBe(201);
    const customerLogin = await api.post('/api/auth/login', { data: { email: customerEmail, password: customerPassword } });
    expect(customerLogin.ok()).toBeTruthy();
    const customerToken = (await customerLogin.json()).data.token;
    const customerAuth = { authorization: `Bearer ${customerToken}` };

    const addressResponse = await api.post('/api/account/addresses', {
      headers: customerAuth,
      data: {
        recipientName: 'Giftly order browser fixture', phone: '0900000004', addressLine: '321 Test Street',
        ward: 'Ward 1', district: 'District 1', city: 'Ho Chi Minh City', isDefault: true,
      },
    });
    expect(addressResponse.status()).toBe(201);
    const productResponse = await api.get('/api/products?limit=1&inStock=true');
    expect(productResponse.ok()).toBeTruthy();
    const product = (await productResponse.json()).data.items[0];
    expect(product).toBeTruthy();
    const cartResponse = await api.post('/api/cart/items', {
      headers: customerAuth,
      data: { productId: product.id, quantity: 1 },
    });
    expect(cartResponse.status()).toBe(201);
    const orderResponse = await api.post('/api/orders', {
      headers: { ...customerAuth, 'Idempotency-Key': `admin-e2e-${randomUUID()}` },
      data: { addressId: (await addressResponse.json()).data.id, shippingMethod: 'STANDARD', paymentMethod: 'COD' },
    });
    expect(orderResponse.status()).toBe(201);
    const order = (await orderResponse.json()).data;
    const orderId = order.orderId;

    const adminRegistration = await api.post('/api/auth/register', {
      data: { fullName: 'Giftly admin order fixture', email: adminEmail, password: adminPassword },
    });
    expect(adminRegistration.status()).toBe(201);
    execFileSync('node', ['scripts/promoteAdmin.js', adminEmail], {
      cwd: backendDirectory,
      env: { ...process.env, DB_NAME: testDatabase },
      stdio: 'pipe',
    });
    const adminLogin = await api.post('/api/auth/login', { data: { email: adminEmail, password: adminPassword } });
    expect(adminLogin.ok()).toBeTruthy();
    const adminSession = (await adminLogin.json()).data;
    await openAuthenticatedPage(page, adminSession, '/admin/orders');

    const orderRow = page.getByRole('row').filter({ hasText: order.orderCode });
    await expect(orderRow).toBeVisible();
    await orderRow.getByRole('button', { name: order.orderCode }).click();
    // Đơn COD kho còn hàng tự động ở PROCESSING (Đang chuẩn bị hàng)
    await expect(page.getByRole('heading', { name: new RegExp(`${order.orderCode} · ${ORDER_STATUS.PROCESSING}`) })).toBeVisible();
    await expect(page.locator('.admin-card').filter({ hasText: `${order.orderCode} · ` })).toContainText(product.name);

    page.on('dialog', (dialog) => dialog.accept('Playwright state transition fixture'));
    const transition = async (status) => {
      const responsePromise = page.waitForResponse((response) =>
        response.url().includes(`/api/admin/orders/${orderId}/status`) && response.request().method() === 'PATCH');
      await orderRow.getByRole('combobox').selectOption(status);
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const expectedLabel = ORDER_STATUS[status] || status;
      await expect(page.getByRole('heading', { name: new RegExp(`${order.orderCode} · ${expectedLabel}`) })).toBeVisible();
      await expect(orderRow.locator('td').nth(3)).toContainText(expectedLabel);
    };

    // Từ PROCESSING, admin có thể hủy đơn an toàn
    await transition('CANCELLED');
    const cancelledOrder = await api.get(`/api/orders/${orderId}`, { headers: customerAuth });
    expect(cancelledOrder.ok()).toBeTruthy();
    expect((await cancelledOrder.json()).data.status).toBe('CANCELLED');
  } finally {
    await api.dispose();
  }
});

test('admin can lock and unlock a customer and existing JWTs follow the account status', async ({ page }) => {
  const api = await request.newContext({ baseURL: 'http://localhost:5000' });
  const testDatabase = process.env.PLAYWRIGHT_DB_NAME || 'giftly_e2e_test';
  const customerEmail = `e2e-customer-${randomUUID()}@example.invalid`;
  const adminEmail = `e2e-admin-${randomUUID()}@example.invalid`;
  const customerPassword = 'E2E-Customer-Lock-2026!';
  const adminPassword = 'E2E-Admin-Lock-2026!';

  try {
    const customerRegistration = await api.post('/api/auth/register', {
      data: { fullName: 'Giftly customer status fixture', email: customerEmail, password: customerPassword },
    });
    expect(customerRegistration.status()).toBe(201);
    const customerId = (await customerRegistration.json()).data.user.id;
    const customerLogin = await api.post('/api/auth/login', { data: { email: customerEmail, password: customerPassword } });
    expect(customerLogin.ok()).toBeTruthy();
    const customerToken = (await customerLogin.json()).data.token;
    expect((await api.get('/api/auth/me', { headers: { authorization: `Bearer ${customerToken}` } })).status()).toBe(200);

    const adminRegistration = await api.post('/api/auth/register', {
      data: { fullName: 'Giftly admin status fixture', email: adminEmail, password: adminPassword },
    });
    expect(adminRegistration.status()).toBe(201);
    execFileSync('node', ['scripts/promoteAdmin.js', adminEmail], {
      cwd: backendDirectory,
      env: { ...process.env, DB_NAME: testDatabase },
      stdio: 'pipe',
    });
    const adminLogin = await api.post('/api/auth/login', { data: { email: adminEmail, password: adminPassword } });
    expect(adminLogin.ok()).toBeTruthy();
    const adminSession = (await adminLogin.json()).data;
    await openAuthenticatedPage(page, adminSession, '/admin/customers');
    const search = page.getByPlaceholder('Tìm theo tên hoặc email');
    await search.fill(customerEmail);
    const customerRow = page.getByRole('row').filter({ hasText: customerEmail });
    await expect(customerRow).toBeVisible();

    const lockResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/admin/customers/${customerId}/status`) && response.request().method() === 'PATCH');
    await customerRow.getByRole('combobox').last().selectOption('LOCKED');
    expect((await lockResponsePromise).status()).toBe(200);
    await expect(customerRow.locator('td').nth(2)).toHaveText(CUSTOMER_STATUS.LOCKED);
    expect((await api.get('/api/auth/me', { headers: { authorization: `Bearer ${customerToken}` } })).status()).toBe(401);

    const unlockResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/admin/customers/${customerId}/status`) && response.request().method() === 'PATCH');
    await customerRow.getByRole('combobox').last().selectOption('ACTIVE');
    expect((await unlockResponsePromise).status()).toBe(200);
    await expect(customerRow.locator('td').nth(2)).toHaveText(CUSTOMER_STATUS.ACTIVE);
    expect((await api.get('/api/auth/me', { headers: { authorization: `Bearer ${customerToken}` } })).status()).toBe(200);
  } finally {
    await api.dispose();
  }
});

test('admin can record shipment tracking and the customer can see its history', async ({ page }) => {
  const api = await request.newContext({ baseURL: 'http://localhost:5000' });
  const testDatabase = process.env.PLAYWRIGHT_DB_NAME || 'giftly_e2e_test';
  const customerEmail = `e2e-shipping-${randomUUID()}@example.invalid`;
  const adminEmail = `e2e-admin-shipping-${randomUUID()}@example.invalid`;
  const customerPassword = 'E2E-Shipping-Customer-2026!';
  const adminPassword = 'E2E-Shipping-Admin-2026!';

  try {
    const registration = await api.post('/api/auth/register', {
      data: { fullName: 'Giftly shipment customer fixture', email: customerEmail, password: customerPassword },
    });
    expect(registration.status()).toBe(201);
    const customerLogin = await api.post('/api/auth/login', { data: { email: customerEmail, password: customerPassword } });
    expect(customerLogin.status(), await customerLogin.text()).toBe(200);
    const customerToken = (await customerLogin.json()).data.token;
    const customerAuth = { authorization: `Bearer ${customerToken}` };
    const address = await api.post('/api/account/addresses', {
      headers: customerAuth,
      data: {
        recipientName: 'Giftly shipment customer fixture', phone: '0900000005', addressLine: '456 Test Street',
        ward: 'Ward 2', district: 'District 2', city: 'Ho Chi Minh City', isDefault: true,
      },
    });
    expect(address.status()).toBe(201);
    const catalog = await api.get('/api/products?limit=1&inStock=true');
    expect(catalog.ok()).toBeTruthy();
    const product = (await catalog.json()).data.items[0];
    const cart = await api.post('/api/cart/items', { headers: customerAuth, data: { productId: product.id, quantity: 1 } });
    expect(cart.status()).toBe(201);
    const orderResponse = await api.post('/api/orders', {
      headers: { ...customerAuth, 'Idempotency-Key': `shipping-e2e-${randomUUID()}` },
      data: { addressId: (await address.json()).data.id, shippingMethod: 'STANDARD', paymentMethod: 'COD' },
    });
    expect(orderResponse.status()).toBe(201);
    const order = (await orderResponse.json()).data;
    const orderId = order.orderId;

    const adminRegistration = await api.post('/api/auth/register', {
      data: { fullName: 'Giftly shipment admin fixture', email: adminEmail, password: adminPassword },
    });
    expect(adminRegistration.status()).toBe(201);
    execFileSync('node', ['scripts/promoteAdmin.js', adminEmail], {
      cwd: backendDirectory,
      env: { ...process.env, DB_NAME: testDatabase },
      stdio: 'pipe',
    });
    const adminLogin = await api.post('/api/auth/login', { data: { email: adminEmail, password: adminPassword } });
    expect(adminLogin.ok()).toBeTruthy();
    const adminSession = (await adminLogin.json()).data;
    await openAuthenticatedPage(page, adminSession, '/admin/orders');
    const orderRow = page.getByRole('row').filter({ hasText: order.orderCode });
    await expect(orderRow).toBeVisible();

    // Đơn COD kho còn hàng đã ở PROCESSING, giao diện admin hiển thị sẵn form nhập vận đơn
    await orderRow.getByRole('button', { name: order.orderCode }).click();
    await expect(page.getByRole('heading', { name: 'Thông tin vận chuyển nội bộ' })).toBeVisible();
    await page.getByLabel('Đơn vị vận chuyển').fill('Playwright Local Carrier');
    await page.getByLabel('Mã vận đơn').fill('E2E-TRACK-20261012');
    await page.getByLabel('Ghi chú (không bắt buộc)').fill('Test-only tracking history');
    const shippingResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/admin/orders/${orderId}/shipping`) && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Lưu thông tin vận chuyển' }).click();
    expect((await shippingResponsePromise).status()).toBe(200);
    await expect(page.getByText('E2E-TRACK-20261012', { exact: true })).toBeVisible();

    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
    await page.locator('#login-email').fill(customerEmail);
    await page.locator('#login-password').fill(customerPassword);
    await page.locator('form.auth-form button.auth-submit').click();
    await expect(page).toHaveURL('http://localhost:5173/');
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByText('Playwright Local Carrier', { exact: true })).toBeVisible();
    await expect(page.getByText('Playwright Local Carrier · E2E-TRACK-20261012', { exact: true })).toBeVisible();
    await expect(page.getByText('Test-only tracking history', { exact: true })).toBeVisible();
  } finally {
    await api.dispose();
  }
});

test('customer review and return flows require delivery, publish through admin review, and restock accurately', async ({ page }) => {
  const api = await request.newContext({ baseURL: 'http://localhost:5000' });
  const testDatabase = process.env.PLAYWRIGHT_DB_NAME || 'giftly_e2e_test';
  const customerEmail = `e2e-return-${randomUUID()}@example.invalid`;
  const adminEmail = `e2e-admin-return-${randomUUID()}@example.invalid`;
  const customerPassword = 'E2E-Return-Customer-2026!';
  const adminPassword = 'E2E-Return-Admin-2026!';

  try {
    const customerRegistration = await api.post('/api/auth/register', {
      data: { fullName: 'Giftly return customer fixture', email: customerEmail, password: customerPassword },
    });
    expect(customerRegistration.status()).toBe(201);
    const customerLogin = await api.post('/api/auth/login', { data: { email: customerEmail, password: customerPassword } });
    expect(customerLogin.ok()).toBeTruthy();
    const customerSession = (await customerLogin.json()).data;
    const customerAuth = { authorization: `Bearer ${customerSession.token}` };

    const adminRegistration = await api.post('/api/auth/register', {
      data: { fullName: 'Giftly return admin fixture', email: adminEmail, password: adminPassword },
    });
    expect(adminRegistration.status()).toBe(201);
    execFileSync('node', ['scripts/promoteAdmin.js', adminEmail], {
      cwd: backendDirectory,
      env: { ...process.env, DB_NAME: testDatabase },
      stdio: 'pipe',
    });
    const adminLogin = await api.post('/api/auth/login', { data: { email: adminEmail, password: adminPassword } });
    expect(adminLogin.ok()).toBeTruthy();
    const adminSession = (await adminLogin.json()).data;
    const adminAuth = { authorization: `Bearer ${adminSession.token}` };

    const address = await api.post('/api/account/addresses', {
      headers: customerAuth,
      data: {
        recipientName: 'Giftly return customer fixture', phone: '0900000007', addressLine: '777 Test Street',
        ward: 'Ward 7', district: 'District 7', city: 'Ho Chi Minh City', isDefault: true,
      },
    });
    expect(address.status()).toBe(201);
    const catalog = await api.get('/api/products?limit=20&inStock=true');
    expect(catalog.ok()).toBeTruthy();
    const product = (await catalog.json()).data.items.find((item) => item.stock > 0);
    expect(product).toBeTruthy();

    const adminProducts = await api.get('/api/admin/products?limit=100', { headers: adminAuth });
    expect(adminProducts.ok()).toBeTruthy();
    const startingStock = (await adminProducts.json()).data.items.find((item) => item.id === product.id).stock;

    const cart = await api.post('/api/cart/items', {
      headers: customerAuth, data: { productId: product.id, quantity: 1 },
    });
    expect(cart.status()).toBe(201);
    const orderResponse = await api.post('/api/orders', {
      headers: { ...customerAuth, 'Idempotency-Key': `return-e2e-${randomUUID()}` },
      data: { addressId: (await address.json()).data.id, shippingMethod: 'STANDARD', paymentMethod: 'COD' },
    });
    expect(orderResponse.status()).toBe(201);
    const order = (await orderResponse.json()).data;
    const orderId = order.orderId;

    await openAuthenticatedPage(page, adminSession, '/admin/orders');
    const orderRow = page.getByRole('row').filter({ hasText: order.orderCode });
    await expect(orderRow).toBeVisible();
    page.on('dialog', (dialog) => dialog.accept('Playwright return workflow order-state fixture.'));
    // Đơn COD kho còn hàng đã ở PROCESSING, admin chuyển tiếp sang SHIPPED rồi DELIVERED
    for (const status of ['SHIPPED', 'DELIVERED']) {
      const updatePromise = page.waitForResponse((response) =>
        response.url().includes(`/api/admin/orders/${orderId}/status`) && response.request().method() === 'PATCH');
      await orderRow.getByRole('combobox').selectOption(status);
      expect((await updatePromise).status()).toBe(200);
    }
    const reservedStockResponse = await api.get('/api/admin/products?limit=100', { headers: adminAuth });
    const reservedStock = (await reservedStockResponse.json()).data.items.find((item) => item.id === product.id).stock;
    expect(reservedStock).toBe(startingStock - 1);

    const reviewBody = 'Playwright verified delivered-product review fixture.';
    await openAuthenticatedPage(page, customerSession, `/products/${product.id}`);
    const reviewForm = page.locator('.commerce-review-form');
    await expect(reviewForm).toBeVisible();
    await reviewForm.getByLabel('Đơn hàng').selectOption(orderId);
    await reviewForm.getByLabel('Số sao').selectOption('5');
    await reviewForm.getByLabel('Nhận xét').fill(reviewBody);
    const createReviewPromise = page.waitForResponse((response) =>
      response.url().endsWith(`/api/products/${product.id}/reviews`) && response.request().method() === 'POST');
    await reviewForm.getByRole('button', { name: 'Gửi đánh giá' }).click();
    expect((await createReviewPromise).status()).toBe(201);

    await openAuthenticatedPage(page, adminSession, '/admin/reviews');
    const reviewRow = page.getByRole('row').filter({ hasText: reviewBody });
    await expect(reviewRow).toContainText('Đã duyệt');
    // Admin ẩn đánh giá (isApproved = false -> Chờ duyệt)
    const hideResponsePromise = page.waitForResponse((response) =>
      response.url().match(/\/api\/admin\/reviews\/\d+$/) && response.request().method() === 'PATCH');
    await reviewRow.getByRole('button', { name: 'Ẩn' }).click();
    expect((await hideResponsePromise).status()).toBe(200);
    await expect(reviewRow).toContainText('Chờ duyệt');

    // Admin duyệt lại đánh giá (isApproved = true -> Đã duyệt)
    const showResponsePromise = page.waitForResponse((response) =>
      response.url().match(/\/api\/admin\/reviews\/\d+$/) && response.request().method() === 'PATCH');
    await reviewRow.getByRole('button', { name: 'Hiện' }).click();
    expect((await showResponsePromise).status()).toBe(200);
    await expect(reviewRow).toContainText('Đã duyệt');
    await openAuthenticatedPage(page, customerSession, `/products/${product.id}`);
    await expect(page.locator('.commerce-reviews')).toContainText(reviewBody);
    await expect(page.locator('.commerce-detail-info .commerce-product-rating')).toContainText('5.0');

    await openAuthenticatedPage(page, customerSession, `/orders/${orderId}`);
    await expect(page.getByRole('heading', { name: 'Yêu cầu đổi trả' })).toBeVisible();
    await page.getByPlaceholder('Lý do đổi trả').fill('Playwright return workflow fixture');
    await page.getByPlaceholder('Mô tả thêm').fill('Full order returned for isolated workflow verification.');
    const createReturnPromise = page.waitForResponse((response) =>
      response.url().includes(`/api/orders/${orderId}/returns`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Gửi yêu cầu' }).click();
    const createReturnResponse = await createReturnPromise;
    expect(createReturnResponse.status()).toBe(201);
    const returnId = (await createReturnResponse.json()).data.id;
    await expect(page.locator('.commerce-return-form')).toContainText(RETURN_STATUS.PENDING);

    await openAuthenticatedPage(page, adminSession, '/admin/returns');
    const returnRow = page.getByRole('row').filter({ hasText: order.orderCode });
    await expect(returnRow).toContainText('Playwright return workflow fixture');
    const approvePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/admin/returns/${returnId}`) && response.request().method() === 'PATCH');
    await returnRow.getByRole('button', { name: 'Chấp nhận' }).click();
    expect((await approvePromise).status()).toBe(200);
    await expect(returnRow.locator('td').nth(3)).toHaveText(RETURN_STATUS.APPROVED);

    const completePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/admin/returns/${returnId}`) && response.request().method() === 'PATCH');
    await returnRow.getByRole('button', { name: 'Đã nhận hàng trả và nhập kho' }).click();
    const completeResponse = await completePromise;
    expect(completeResponse.status()).toBe(200);
    expect((await completeResponse.json()).data).toMatchObject({ restocked: true, refundProcessed: false });
    await expect(returnRow.locator('td').nth(3)).toHaveText(RETURN_STATUS.COMPLETED);

    await openAuthenticatedPage(page, customerSession, `/orders/${orderId}`);
    await expect(page.locator('.commerce-return-form')).toContainText(RETURN_STATUS.COMPLETED);
    await expect(page.locator('.commerce-return-form')).toContainText('Giftly chưa xử lý hoàn tiền tự động');
    const finalProducts = await api.get('/api/admin/products?limit=100', { headers: adminAuth });
    expect((await finalProducts.json()).data.items.find((item) => item.id === product.id).stock).toBe(startingStock);
  } finally {
    await api.dispose();
  }
});

test('admin-created coupon recalculates checkout and is recorded on the order', async ({ page }) => {
  const api = await request.newContext({ baseURL: 'http://localhost:5000' });
  const testDatabase = process.env.PLAYWRIGHT_DB_NAME || 'giftly_e2e_test';
  const customerEmail = `e2e-coupon-${randomUUID()}@example.invalid`;
  const adminEmail = `e2e-admin-coupon-${randomUUID()}@example.invalid`;
  const customerPassword = 'E2E-Coupon-Customer-2026!';
  const adminPassword = 'E2E-Admin-Coupon-2026!';
  const couponCode = `E2E-${randomUUID().replaceAll('-', '').toUpperCase()}`;

  try {
    const customerRegistration = await api.post('/api/auth/register', {
      data: { fullName: 'Giftly coupon customer fixture', email: customerEmail, password: customerPassword },
    });
    expect(customerRegistration.status()).toBe(201);
    const customerLogin = await api.post('/api/auth/login', { data: { email: customerEmail, password: customerPassword } });
    expect(customerLogin.ok()).toBeTruthy();
    const customerSession = (await customerLogin.json()).data;
    const customerAuth = { authorization: `Bearer ${customerSession.token}` };

    const adminRegistration = await api.post('/api/auth/register', {
      data: { fullName: 'Giftly coupon admin fixture', email: adminEmail, password: adminPassword },
    });
    expect(adminRegistration.status()).toBe(201);
    execFileSync('node', ['scripts/promoteAdmin.js', adminEmail], {
      cwd: backendDirectory,
      env: { ...process.env, DB_NAME: testDatabase },
      stdio: 'pipe',
    });
    const adminLogin = await api.post('/api/auth/login', { data: { email: adminEmail, password: adminPassword } });
    expect(adminLogin.ok()).toBeTruthy();
    const adminSession = (await adminLogin.json()).data;
    const adminToken = adminSession.token;

    await openAuthenticatedPage(page, adminSession, '/admin/coupons');
    await page.getByLabel('Mã', { exact: true }).fill(couponCode);
    await page.getByLabel('Giá trị giảm').fill('10');
    await page.getByLabel('Giới hạn tổng lượt').fill('1');
    const createCouponPromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/admin/coupons') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Tạo mã', exact: true }).click();
    const createCouponResponse = await createCouponPromise;
    expect(createCouponResponse.status()).toBe(201);
    await expect(page.getByRole('row').filter({ hasText: couponCode })).toBeVisible();

    const address = await api.post('/api/account/addresses', {
      headers: customerAuth,
      data: {
        recipientName: 'Giftly coupon customer fixture', phone: '0900000008', addressLine: '888 Test Street',
        ward: 'Ward 8', district: 'District 8', city: 'Ho Chi Minh City', isDefault: true,
      },
    });
    expect(address.status()).toBe(201);
    await openAuthenticatedPage(page, customerSession, '/products');
    const product = page.locator('.commerce-product').first();
    await expect(product).toBeVisible();
    await product.getByRole('button').click();
    await page.goto('/cart');
    await page.getByRole('link', { name: /Tiến hành đặt hàng/ }).click();
    const couponInput = page.getByPlaceholder('Nhập mã giảm giá');
    await expect(couponInput).toBeVisible();
    const quotePromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/orders/quote') && response.request().method() === 'POST');
    await couponInput.fill(couponCode);
    const quoteResponse = await quotePromise;
    expect(quoteResponse.status()).toBe(200);
    const quote = (await quoteResponse.json()).data;
    expect(quote.coupon.code).toBe(couponCode);
    expect(quote.discount).toBeGreaterThan(0);
    await expect(couponInput).toHaveValue(couponCode);
    const discountLine = page.locator('.commerce-order-summary > div').filter({ hasText: 'Giảm giá' });
    await expect(discountLine).toContainText(/−\s*[1-9]/);

    const orderPromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/orders') && response.request().method() === 'POST');
    await page.getByRole('button', { name: /Đặt hàng COD/ }).click();
    const orderResponse = await orderPromise;
    expect(orderResponse.status()).toBe(201);
    const orderId = (await orderResponse.json()).data.orderId;
    const detailResponse = await api.get(`/api/orders/${orderId}`, { headers: customerAuth });
    expect(detailResponse.ok()).toBeTruthy();
    const detail = (await detailResponse.json()).data;
    expect(detail.couponCode).toBe(couponCode);
    expect(detail.discount).toBe(quote.discount);
    expect(detail.total).toBe(quote.total);
    const couponList = await api.get('/api/admin/coupons', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect((await couponList.json()).data.find((item) => item.code === couponCode).usedCount).toBe(1);
  } finally {
    await api.dispose();
  }
});

test('demo account sees synthetic demo badge and disabled purchase button, while guest does not see synthetic product', async ({ page }) => {
  const api = await request.newContext({ baseURL: 'http://localhost:5000' });

  try {
    // 1. Kiểm tra qua API catalog công khai: khách thường KHÔNG thấy sản phẩm synthetic
    const catalogRes = await api.get('/api/products?limit=100');
    expect(catalogRes.ok()).toBeTruthy();
    const publicProducts = (await catalogRes.json()).data.items;
    const syntheticInCatalog = publicProducts.find(
      (p) => p.isSyntheticDisplay || p.name === 'Sản phẩm Demo Synthetic Lifestyle'
    );
    expect(syntheticInCatalog).toBeUndefined();

    // 2. Kiểm tra trên giao diện catalog khách thường: không thấy sản phẩm synthetic
    await page.goto('/products');
    await expect(page.getByText('Sản phẩm Demo Synthetic Lifestyle')).not.toBeVisible();

    // 3. Lấy trực tiếp ID sản phẩm synthetic từ database test
    const mysql = require('../../core-backend/node_modules/mysql2/promise');
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'rootpassword',
      database: process.env.PLAYWRIGHT_DB_NAME || 'giftly_e2e_test',
    });
    let syntheticId;
    try {
      const [rows] = await conn.execute(
        'SELECT id, name FROM products WHERE is_synthetic_display = TRUE LIMIT 1'
      );
      expect(rows.length).toBeGreaterThan(0);
      syntheticId = rows[0].id;
    } finally {
      await conn.end();
    }

    // 4. Khách thường gọi API chi tiết /api/products/:id của sản phẩm synthetic -> bị 404
    const guestDetailRes = await api.get(`/api/products/${syntheticId}`);
    expect(guestDetailRes.status()).toBe(404);

    // 5. Đăng nhập bằng tài khoản demo (đã được tạo bởi globalSetup: email demo-ml@giftly.test)
    const demoLogin = await api.post('/api/auth/login', {
      data: { email: 'demo-ml@giftly.test', password: 'Demo-User-ML-2026!' },
    });
    expect(demoLogin.ok()).toBeTruthy();
    const demoSession = (await demoLogin.json()).data;
    expect(demoSession.user.email).toBe('demo-ml@giftly.test');

    // Xác minh tài khoản demo có thể truy cập thành công API chi tiết sản phẩm synthetic (200 OK)
    const demoDetailRes = await api.get(`/api/products/${syntheticId}`, {
      headers: { authorization: `Bearer ${demoSession.token}` },
    });
    expect(demoDetailRes.ok()).toBeTruthy();
    const detailData = (await demoDetailRes.json()).data;
    expect(detailData.product.isSyntheticDisplay).toBe(true);

    // 6. Mở trang chi tiết sản phẩm synthetic với session tài khoản demo trên trình duyệt
    await openAuthenticatedPage(page, demoSession, `/products/${syntheticId}`);

    // 7. Xác minh: Thấy badge "Sản phẩm demo, không đặt mua"
    const demoBadge = page.locator('.commerce-badge-synthetic');
    await expect(demoBadge).toBeVisible();
    await expect(demoBadge).toContainText('Sản phẩm demo, không đặt mua');

    // 8. Xác minh: Nút đặt mua bị vô hiệu hóa (disabled) và ghi rõ nhãn demo
    const purchaseButton = page.locator('.commerce-detail-actions button.commerce-button');
    await expect(purchaseButton).toBeVisible();
    await expect(purchaseButton).toBeDisabled();
    await expect(purchaseButton).toContainText('Sản phẩm demo, không đặt mua');
  } finally {
    await api.dispose();
  }
});
