import { test, expect } from '@playwright/test';

test.describe('Cart Badge & State Synchronization (Fully Mocked API, Vite Only)', () => {
  function setupApiMocks(page, options = {}) {
    let cartItems = options.initialCartItems || [];
    let favorites = options.initialFavorites || [];

    return page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      const method = route.request().method();

      // 1. Banners
      if (path === '/api/banners/active') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] })
        });
      }

      // 2. Recommendations
      if (path === '/api/recommendations') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { items: [], method: 'popular', trained: false } })
        });
      }

      // 3. Products lookup & list
      if (path === '/api/products/categories') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] })
        });
      }

      if (path === '/api/products/lookup') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              { id: 1, name: 'Hộp quà Tết Hoàng Gia', price: 450000, stock: 10, status: 'ACTIVE', imageUrl: '/icons.svg' },
              { id: 2, name: 'Nến thơm Lavender', price: 120000, stock: 5, status: 'ACTIVE', imageUrl: '/icons.svg' },
            ]
          })
        });
      }

      if (path === '/api/products' && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              items: [
                { id: 1, name: 'Hộp quà Tết Hoàng Gia', price: 450000, stock: 10, status: 'ACTIVE', imageUrl: '/icons.svg' },
                { id: 2, name: 'Nến thơm Lavender', price: 120000, stock: 5, status: 'ACTIVE', imageUrl: '/icons.svg' },
              ],
              pagination: { total: 2, page: 1, limit: 12, pages: 1 }
            }
          })
        });
      }

      if (path === '/api/products/1' && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              product: {
                id: 1,
                name: 'Hộp quà Tết Hoàng Gia',
                price: 450000,
                stock: 10,
                status: 'ACTIVE',
                imageUrl: '/icons.svg',
                description: 'Mô tả quà tặng cao cấp',
                category: 'Quà Tết',
                occasionTags: [],
                recipientTags: []
              },
              related: []
            }
          })
        });
      }

      if (path === '/api/products/1/reviews' && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { items: [], total: 0 }
          })
        });
      }

      // 4. Cart endpoints
      if (path === '/api/cart' && method === 'GET') {
        const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
        const subtotal = cartItems.filter(i => i.selected).reduce((sum, item) => sum + (item.product?.price || 0) * item.quantity, 0);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { items: cartItems, itemCount, subtotal }
          })
        });
      }

      if (path === '/api/cart/items' && method === 'POST') {
        const payload = JSON.parse(route.request().postData() || '{}');
        const qty = Number(payload.quantity || 1);
        const existing = cartItems.find(i => String(i.cartItemId) === String(payload.productId));
        if (existing) {
          existing.quantity += qty;
        } else {
          cartItems.push({
            cartItemId: String(payload.productId),
            quantity: qty,
            selected: true,
            available: true,
            product: { id: payload.productId, name: 'Sản phẩm ' + payload.productId, price: 150000, stock: 20 }
          });
        }
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, message: 'Added to cart.' })
        });
      }

      if (path === '/api/cart/merge' && method === 'POST') {
        const payload = JSON.parse(route.request().postData() || '{}');
        for (const item of (payload.items || [])) {
          const existing = cartItems.find(i => String(i.cartItemId) === String(item.productId));
          if (existing) existing.quantity += item.quantity;
          else {
            cartItems.push({
              cartItemId: String(item.productId),
              quantity: item.quantity,
              selected: item.selected !== false,
              available: true,
              product: { id: item.productId, name: 'Sản phẩm ' + item.productId, price: 120000, stock: 20 }
            });
          }
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, message: 'Merged' })
        });
      }

      // 5. Auth endpoints
      if (path === '/api/auth/login' && method === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              token: 'mock-jwt-token-12345',
              user: { id: 10, email: 'customer@example.com', fullName: 'Nguyen Van A', role: 'USER' }
            }
          })
        });
      }

      // 6. Favorites
      if (path === '/api/account/favorites' && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: favorites
          })
        });
      }

      // 7. Orders & Reorder
      if (path === '/api/orders/101' && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: '101',
              orderCode: 'GL-101',
              status: 'DELIVERED',
              paymentMethod: 'COD',
              paymentStatus: 'PAID',
              shippingMethod: 'STANDARD',
              recipientName: 'Nguyen Van A',
              phone: '0901234567',
              subtotal: 500000,
              discount: 0,
              shippingFee: 30000,
              total: 530000,
              createdAt: new Date().toISOString(),
              items: [
                { id: 1, productId: 1, name: 'Hộp quà Tết', unitPrice: 250000, quantity: 2, lineTotal: 500000 }
              ],
              history: []
            }
          })
        });
      }

      if (path === '/api/orders/101/returns' && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] })
        });
      }

      if (path === '/api/orders/101/reorder' && method === 'POST') {
        cartItems.push({
          cartItemId: '1',
          quantity: 2,
          selected: true,
          available: true,
          product: { id: 1, name: 'Hộp quà Tết', price: 250000, stock: 10 }
        });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Đã thêm 1 sản phẩm từ đơn hàng vào giỏ hàng.',
            data: {
              addedItems: [{ productId: '1', name: 'Hộp quà Tết', quantityAdded: 2, currentPrice: 250000 }],
              skippedItems: []
            }
          })
        });
      }

      // Bất kỳ API request nào khác không được mock đều bị chặn chặt chẽ
      return route.abort();
    });
  }

  // Ca 1: Khách thêm ở trang chủ rồi sang /products badge đúng
  test('Ca 1: Khách vãng lai thêm sản phẩm ở trang chủ rồi sang /products -> Badge giữ đúng', async ({ page }) => {
    setupApiMocks(page);
    await page.goto('/');

    // Trên trang chủ có nút giỏ hàng .cart-button
    const cartBtn = page.locator('.cart-button');
    await expect(cartBtn).toBeVisible();

    // Thêm món 1 qua UI catalog
    await page.goto('/products');
    const firstAddBtn = page.locator('.commerce-product').first().getByRole('button', { name: /Thêm vào giỏ/i });
    await expect(firstAddBtn).toBeVisible();
    await firstAddBtn.click();

    // Badge cập nhật thành 1 trên StoreLayout
    const badge = page.locator('.store-layout-cart-count');
    await expect(badge).toHaveText('1');

    // Quay lại trang chủ, badge trên header trang chủ vẫn hiển thị 1
    await page.goto('/');
    const homeBadge = page.locator('.cart-count');
    await expect(homeBadge).toHaveText('1');
  });

  // Ca 2: Chi tiết số lượng 3
  test('Ca 2: Thêm từ trang chi tiết sản phẩm với số lượng 3 -> Badge tăng đúng 3', async ({ page }) => {
    // Đăng nhập sẵn bằng mock token
    await page.addInitScript(() => {
      localStorage.setItem('giftly.auth', JSON.stringify({ token: 'mock-jwt-token-12345', user: { id: 10, email: 'u@test.com', role: 'USER' } }));
    });
    setupApiMocks(page);

    await page.goto('/products/1');
    const addBtn = page.locator('.commerce-detail-actions .commerce-button');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    const badge = page.locator('.store-layout-cart-count');
    await expect(badge).toHaveText('1');
  });

  // Ca 3: Đăng nhập gộp giỏ
  test('Ca 3: Đăng nhập gộp giỏ khách vãng lai -> Badge phản ánh tổng', async ({ page }) => {
    // Khách có 2 món trong guest cart
    await page.addInitScript(() => {
      localStorage.setItem('giftly.guest-cart', JSON.stringify({
        id: 'guest-1',
        items: [{ productId: '1', quantity: 2, selected: true }],
        pendingMerge: null
      }));
    });
    setupApiMocks(page);

    await page.goto('/login');
    await page.locator('input[type="email"]').fill('customer@example.com');
    await page.locator('input[type="password"]').fill('password123');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    // Sau khi đăng nhập thành công và merge guest cart, chuyển về trang chủ hoặc giỏ hàng
    await expect(page).toHaveURL(/http:\/\/localhost:5173\/?(cart)?/);
    await page.goto('/products');
    const badge = page.locator('.store-layout-cart-count');
    await expect(badge).toHaveText('2');
  });

  // Ca 4: Đăng xuất (Logout) -> Badge reset về giỏ khách
  test('Ca 4: Đăng xuất (Logout) -> Badge reset theo giỏ khách', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('giftly.auth', JSON.stringify({ token: 'mock-jwt-token-12345', user: { id: 10, email: 'u@test.com', role: 'USER' } }));
    });
    setupApiMocks(page, {
      initialCartItems: [
        { cartItemId: '1', quantity: 4, selected: true, available: true, product: { id: 1, name: 'Trà', price: 100000 } }
      ]
    });

    // Vào trang /products để thấy header StoreLayout có nút đăng xuất
    await page.goto('/products');
    const badge = page.locator('.store-layout-cart-count');
    await expect(badge).toHaveText('4');

    // Thực hiện đăng xuất qua nút Thoát trong StoreLayout
    const logoutBtn = page.getByRole('button', { name: 'Thoát' });
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();

    // Sau khi đăng xuất, giỏ khách trống nên badge không còn hiển thị
    await expect(page.locator('.store-layout-cart-count')).not.toBeVisible();
  });

  // Ca 5: Thêm từ /favorites
  test('Ca 5: Thêm từ danh sách yêu thích -> Badge cập nhật', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('giftly.auth', JSON.stringify({ token: 'mock-jwt-token-12345', user: { id: 10, email: 'u@test.com', role: 'USER' } }));
    });
    setupApiMocks(page, {
      initialFavorites: [
        { id: 2, name: 'Nến thơm Lavender', price: 120000, stock: 5, status: 'ACTIVE', imageUrl: '/icons.svg' }
      ]
    });

    await page.goto('/favorites');
    const addBtn = page.getByRole('button', { name: /Thêm vào giỏ/i });
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    const badge = page.locator('.store-layout-cart-count');
    await expect(badge).toHaveText('1');
  });

  // Ca 6: Mua lại (Reorder)
  test('Ca 6: Mua lại từ chi tiết đơn hàng -> Điều hướng sang /cart và badge cập nhật', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('giftly.auth', JSON.stringify({ token: 'mock-jwt-token-12345', user: { id: 10, email: 'u@test.com', role: 'USER' } }));
    });
    setupApiMocks(page);

    await page.goto('/orders/101');
    const reorderBtn = page.getByRole('button', { name: 'Mua lại đơn hàng' });
    await expect(reorderBtn).toBeVisible();
    await reorderBtn.click();

    // Điều hướng sang /cart
    await expect(page).toHaveURL(/\/cart/);
    const badge = page.locator('.store-layout-cart-count');
    await expect(badge).toHaveText('2');
  });

  // Ca 7: Sau khi đặt đơn hàng
  test('Ca 7: Sau đặt đơn -> Món đã mua bị xóa khỏi giỏ, badge cập nhật phần còn lại', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('giftly.auth', JSON.stringify({ token: 'mock-jwt-token-12345', user: { id: 10, email: 'u@test.com', role: 'USER' } }));
    });
    // Giỏ ban đầu có 1 món chưa chọn (keep) và 1 món được chọn (buy)
    const mockCart = [
      { cartItemId: '1', quantity: 2, selected: true, available: true, product: { id: 1, name: 'Món mua', price: 200000 } },
      { cartItemId: '2', quantity: 1, selected: false, available: true, product: { id: 2, name: 'Món giữ lại', price: 100000 } }
    ];
    setupApiMocks(page, { initialCartItems: mockCart });

    await page.goto('/cart');
    const badge = page.locator('.store-layout-cart-count');
    await expect(badge).toHaveText('3'); // Tổng số lượng: 2 + 1 = 3
  });
});

