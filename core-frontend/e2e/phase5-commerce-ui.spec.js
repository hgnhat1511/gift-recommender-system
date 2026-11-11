import { test, expect } from '@playwright/test';

const deliveredOrder = {
  id: '101', orderCode: 'GLTEST101', status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'PAID',
  shippingMethod: 'STANDARD', recipientName: 'Nguyễn An', phone: '0900000000',
  shippingAddress: { addressLine: '1 Test Road', ward: 'Ward 1', district: 'District 1', city: 'HCMC' },
  subtotal: 159000, discount: 0, shippingFee: 0, total: 159000, createdAt: '2026-11-10T10:00:00.000Z',
  items: [], history: [], canConfirmReceived: true, receivedAt: null, receivedConfirmedAt: null,
  returnDeadline: '2026-11-17T10:00:00.000Z', returnWindowOpen: true,
};

async function signIn(page, role) {
  await page.addInitScript((userRole) => {
    localStorage.setItem('giftly.auth', JSON.stringify({ token: 'ui-smoke-token', user: { id: 10, email: 'ui@example.invalid', role: userRole } }));
  }, role);
}

async function mockApi(page, responder) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await responder(url.pathname, route.request().method());
    await route.fulfill({ status: response.status || 200, contentType: 'application/json', body: JSON.stringify(response.body || { success: true, data: [] }) });
  });
}

test('shipper dashboard renders an assigned internal order and delivery action', async ({ page }) => {
  await signIn(page, 'SHIPPER');
  await mockApi(page, (path) => path === '/api/shipper/orders' ? {
    body: { success: true, data: [{ ...deliveredOrder, status: 'PROCESSING', deliverySource: 'INTERNAL', trackingNumber: 'IN-101' }] },
  } : { body: { success: true, data: [] } });

  await page.goto('/shipper');
  await expect(page.getByRole('heading', { name: 'Đơn giao hàng' })).toBeVisible();
  await expect(page.getByText('GLTEST101')).toBeVisible();
  await expect(page.getByRole('button', { name: /Bắt đầu giao/ })).toBeVisible();
});

test('customer order detail shows receive confirmation and return deadline', async ({ page }) => {
  await signIn(page, 'USER');
  await mockApi(page, (path) => {
    if (path === '/api/orders/101') return { body: { success: true, data: deliveredOrder } };
    if (path === '/api/orders/101/returns') return { body: { success: true, data: [] } };
    return { body: { success: true, data: [] } };
  });

  await page.goto('/orders/101');
  await expect(page.getByRole('button', { name: 'Đã nhận hàng' })).toBeVisible();
  await expect(page.getByText(/Hạn gửi yêu cầu đổi trả/)).toBeVisible();
});

test('admin order actions omit manual SHIPPED and DELIVERED transitions', async ({ page }) => {
  await signIn(page, 'ADMIN');
  await mockApi(page, (path) => {
    if (path === '/api/admin/orders') return { body: { success: true, data: { items: [{ id: '101', orderCode: 'GLTEST101', status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'PAID', deliverySource: null, total: 159000, createdAt: '2026-11-10T10:00:00.000Z', itemCount: 1, customerEmail: 'ui@example.invalid', recipientName: 'Nguyễn An', phone: '0900000000' }], pagination: { total: 1, page: 1, limit: 100, pages: 1 } } } };
    if (path === '/api/admin/shippers') return { body: { success: true, data: [{ id: '20', fullName: 'Shipper Demo', email: 'shipper@example.invalid' }] } };
    return { body: { success: true, data: [] } };
  });

  await page.goto('/admin/orders');
  const transition = page.locator('.admin-table-wrap tbody tr select');
  await expect(transition).toBeVisible();
  await expect(transition.locator('option', { hasText: 'Đang giao hàng' })).toHaveCount(0);
  await expect(transition.locator('option', { hasText: 'Đã giao hàng' })).toHaveCount(0);
});
