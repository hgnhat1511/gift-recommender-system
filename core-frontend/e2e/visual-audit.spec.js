import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SCREENSHOT_DIR = path.resolve(process.cwd(), 'test-results/screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

test.describe('Khu vực 5a — Visual & Functional Audit Across 6 Viewports', () => {

  // 1. Trang chủ: Desktop 1366x768
  test('1. Trang chủ Desktop (1366x768) - Layout, Header sticky, No overflow, Sidebar toggle', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/', { waitUntil: 'networkidle' });

    // Kiểm tra không tràn ngang
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noOverflow).toBe(true);

    // Kiểm tra Header sticky và Announcement bar
    const announcement = page.locator('.site-announcement');
    await expect(announcement).toBeVisible();

    const stickyWrapper = page.locator('.site-sticky-wrapper');
    await expect(stickyWrapper).toBeVisible();

    // Đo chiều cao header và sticky wrapper
    const stickyBox = await stickyWrapper.boundingBox();
    expect(stickyBox).not.toBeNull();
    expect(stickyBox.height).toBeGreaterThanOrEqual(130);
    expect(stickyBox.height).toBeLessThanOrEqual(160);

    // Kiểm tra cả 3 cột hiện trên Desktop 1366px
    const leftSidebar = page.locator('.home-sidebar-left');
    const rightSidebar = page.locator('.home-sidebar-right');
    const centerContent = page.locator('.home-center-content');
    await expect(leftSidebar).toBeVisible();
    await expect(rightSidebar).toBeVisible();
    await expect(centerContent).toBeVisible();

    // Nút toggle sidebar
    const toggleLeftBtn = page.getByRole('button', { name: /danh mục bên trái/i });
    await expect(toggleLeftBtn).toBeVisible();
    await toggleLeftBtn.click();
    await expect(leftSidebar).toBeHidden();
    await toggleLeftBtn.click();
    await expect(leftSidebar).toBeVisible();

    // Scroll xuống và kiểm tra nút Cuộn lên đầu trang
    const scrollToTopBtn = page.locator('.scroll-to-top-btn');
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(500);
    await expect(scrollToTopBtn).toBeVisible();
    await scrollToTopBtn.click();
    await page.waitForTimeout(600);
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeLessThanOrEqual(50);

    // Chụp screenshot Desktop
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_home_desktop_1366.png'), fullPage: false });
  });

  // 2. Trang chủ: Tablet 1024x768
  test('2. Trang chủ Tablet (1024x768) - Right sidebar auto-hides, no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/', { waitUntil: 'networkidle' });

    // Không tràn ngang
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noOverflow).toBe(true);

    // Right sidebar tự động ẩn ở breakpoint <= 1100px
    const rightSidebar = page.locator('.home-sidebar-right');
    await expect(rightSidebar).toBeHidden();

    // Cột trái vẫn khả dụng trên tablet 1024px
    const leftSidebar = page.locator('.home-sidebar-left');
    await expect(leftSidebar).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_home_tablet_1024.png'), fullPage: false });
  });

  // 3. Trang chủ: Mobile 390x844
  test('3. Trang chủ Mobile (390x844) - Drawer toggle, Dock không che CTA, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });

    // Không tràn ngang
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noOverflow).toBe(true);

    // Trên mobile, sidebar trái mặc định ẩn, hiện nút mở drawer
    const drawerOpenBtn = page.locator('.mobile-drawer-open-btn');
    await expect(drawerOpenBtn).toBeVisible();

    // Mở drawer
    await drawerOpenBtn.click();
    const leftSidebar = page.locator('.home-sidebar-left');
    await expect(leftSidebar).toHaveClass(/is-drawer-open/);
    await expect(leftSidebar).toBeVisible();

    // Đóng drawer bằng nút X
    const closeBtn = page.locator('.drawer-close-btn');
    await closeBtn.click();
    await expect(leftSidebar).toBeHidden();

    // Floating Social Dock
    const dockToggle = page.locator('.floating-toggle-btn');
    await expect(dockToggle).toBeVisible();
    await expect(dockToggle).toHaveAttribute('aria-expanded', 'false');

    // Mở dock
    await dockToggle.click();
    await expect(dockToggle).toHaveAttribute('aria-expanded', 'true');
    const socialList = page.locator('.floating-social-list');
    await expect(socialList).toHaveClass(/is-expanded/);

    // Đóng dock bằng phím Esc
    await page.keyboard.press('Escape');
    await expect(dockToggle).toHaveAttribute('aria-expanded', 'false');

    // Kiểm tra Floating Dock không đè lên các nút CTA lớn
    const primaryBtn = page.locator('.festive-btn-primary').first();
    const btnBox = await primaryBtn.boundingBox();
    const dockBox = await dockToggle.boundingBox();
    expect(btnBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    // Dock ở góc dưới màn hình, không giao thoa với CTA hero
    const overlaps = !(
      btnBox.x + btnBox.width < dockBox.x ||
      dockBox.x + dockBox.width < btnBox.x ||
      btnBox.y + btnBox.height < dockBox.y ||
      dockBox.y + dockBox.height < btnBox.y
    );
    expect(overlaps).toBe(false);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_home_mobile_390.png'), fullPage: false });
  });

  // 4. StoreLayout (/products): Desktop 1366x768
  test('4. StoreLayout /products Desktop (1366x768) - Header đồng bộ, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/products', { waitUntil: 'networkidle' });

    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noOverflow).toBe(true);

    const stickyWrapper = page.locator('.site-sticky-wrapper');
    await expect(stickyWrapper).toBeVisible();

    const brand = page.locator('.site-brand-name');
    await expect(brand).toContainText(/giftly/i);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_store_desktop_1366.png'), fullPage: false });
  });

  // 5. StoreLayout (/products): Tablet 1024x768
  test('5. StoreLayout /products Tablet (1024x768) - Header đồng bộ, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/products', { waitUntil: 'networkidle' });

    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noOverflow).toBe(true);

    const stickyWrapper = page.locator('.site-sticky-wrapper');
    await expect(stickyWrapper).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05_store_tablet_1024.png'), fullPage: false });
  });

  // 6. StoreLayout (/products): Mobile 390x844
  test('6. StoreLayout /products Mobile (390x844) - Header mobile, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/products', { waitUntil: 'networkidle' });

    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noOverflow).toBe(true);

    const stickyWrapper = page.locator('.site-sticky-wrapper');
    await expect(stickyWrapper).toBeVisible();

    // Floating Social Dock vẫn xuất hiện và hoạt động
    const dockToggle = page.locator('.floating-toggle-btn');
    await expect(dockToggle).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06_store_mobile_390.png'), fullPage: false });
  });

});
