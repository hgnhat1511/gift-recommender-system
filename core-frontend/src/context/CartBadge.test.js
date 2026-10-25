import test from 'node:test';
import assert from 'node:assert/strict';

// Mô phỏng state manager cho giỏ hàng tương đương CartContext và guestCart
class MockCartBadgeManager {
  constructor(initialAuth = null, initialGuestCart = []) {
    this.auth = initialAuth;
    this.guestCart = [...initialGuestCart];
    this.serverCart = { items: [], itemCount: 0, subtotal: 0 };
    this.badgeCount = this.computeBadgeCount();
  }

  setAuth(auth) {
    this.auth = auth;
    this.sync();
  }

  computeBadgeCount() {
    if (!this.auth?.token) {
      return this.guestCart.reduce((total, item) => total + (Number(item.quantity) || 0), 0);
    }
    return Number(this.serverCart.itemCount) || 0;
  }

  sync() {
    this.badgeCount = this.computeBadgeCount();
  }

  // Kịch bản 1: Thêm từ Home / Catalog (số lượng 1)
  addToCart(productId, quantity = 1, productStock = 10) {
    if (!this.auth?.token) {
      const existing = this.guestCart.find(i => i.productId === productId);
      if (existing) {
        existing.quantity = Math.min(productStock, existing.quantity + quantity);
      } else {
        this.guestCart.push({ productId, quantity, selected: true });
      }
    } else {
      const existing = this.serverCart.items.find(i => i.productId === productId);
      if (existing) {
        existing.quantity += quantity;
      } else {
        this.serverCart.items.push({ productId, quantity, selected: true });
      }
      this.serverCart.itemCount = this.serverCart.items.reduce((sum, i) => sum + i.quantity, 0);
    }
    this.sync();
  }

  // Kịch bản 3: Gộp giỏ khách khi đăng nhập
  mergeGuestCartOnLogin(newAuth) {
    this.auth = newAuth;
    for (const gItem of this.guestCart) {
      const existing = this.serverCart.items.find(i => i.productId === gItem.productId);
      if (existing) {
        existing.quantity += gItem.quantity;
      } else {
        this.serverCart.items.push({ productId: gItem.productId, quantity: gItem.quantity, selected: gItem.selected });
      }
    }
    this.guestCart = [];
    this.serverCart.itemCount = this.serverCart.items.reduce((sum, i) => sum + i.quantity, 0);
    this.sync();
  }

  // Kịch bản 4: Logout
  logout() {
    this.auth = null;
    this.sync();
  }

  // Kịch bản 6: Mua lại (Reorder)
  reorder(addedItems = []) {
    for (const item of addedItems) {
      const existing = this.serverCart.items.find(i => i.productId === item.productId);
      if (existing) {
        existing.quantity += item.quantityAdded;
      } else {
        this.serverCart.items.push({ productId: item.productId, quantity: item.quantityAdded, selected: true });
      }
    }
    this.serverCart.itemCount = this.serverCart.items.reduce((sum, i) => sum + i.quantity, 0);
    this.sync();
  }

  // Kịch bản 7: Sau khi checkout thành công
  checkoutSuccess() {
    // Chỉ giữ lại những món không được chọn
    this.serverCart.items = this.serverCart.items.filter(i => !i.selected);
    this.serverCart.itemCount = this.serverCart.items.reduce((sum, i) => sum + i.quantity, 0);
    this.sync();
  }
}

// 7 KỊCH BẢN KIỂM TRA BADGE SỐ LƯỢNG GIỎ HÀNG
test('Kịch bản 1: Thêm sản phẩm từ Home / Catalog -> Header badge cập nhật chính xác', () => {
  const manager = new MockCartBadgeManager({ token: 'test-token', id: 1 });
  assert.equal(manager.badgeCount, 0, 'Ban đầu badge = 0');

  manager.addToCart('prod-1', 1);
  assert.equal(manager.badgeCount, 1, 'Sau khi thêm 1 món ở Home, badge = 1');

  manager.addToCart('prod-2', 1);
  assert.equal(manager.badgeCount, 2, 'Sau khi chuyển sang Catalog thêm 1 món nữa, badge = 2');
});

test('Kịch bản 2: Thêm từ trang chi tiết với số lượng 3 -> Badge tăng đúng 3', () => {
  const manager = new MockCartBadgeManager({ token: 'test-token', id: 1 });
  assert.equal(manager.badgeCount, 0);

  manager.addToCart('prod-tea', 3);
  assert.equal(manager.badgeCount, 3, 'Badge phải tăng đúng tổng số lượng (+3), không phải chỉ +1');
});

test('Kịch bản 3: Gộp giỏ khách vãng lai khi đăng nhập -> Badge phản ánh tổng số lượng sau gộp', () => {
  // Khách chưa đăng nhập có 2 sản phẩm (tổng số lượng 5) trong guestCart
  const initialGuest = [
    { productId: 'guest-1', quantity: 2, selected: true },
    { productId: 'guest-2', quantity: 3, selected: true }
  ];
  const manager = new MockCartBadgeManager(null, initialGuest);
  assert.equal(manager.badgeCount, 5, 'Khách vãng lai thấy badge = 5');

  // Đăng nhập và merge
  manager.mergeGuestCartOnLogin({ token: 'user-jwt', id: 99 });
  assert.equal(manager.guestCart.length, 0, 'Guest cart đã được dọn sạch sau khi merge');
  assert.equal(manager.badgeCount, 5, 'Badge sau khi merge giữ nguyên hoặc gộp tổng');
});

test('Kịch bản 4: Đăng xuất (Logout) -> Badge reset về giỏ khách', () => {
  const manager = new MockCartBadgeManager({ token: 'logged-in-jwt', id: 42 });
  manager.addToCart('user-prod-1', 4);
  assert.equal(manager.badgeCount, 4, 'Đang đăng nhập có 4 món');

  // Logout
  manager.logout();
  assert.equal(manager.badgeCount, 0, 'Sau khi logout, badge reset về 0 (vì guest cart ban đầu rỗng)');
});

test('Kịch bản 5: Thêm từ danh sách yêu thích (Favorites) -> Badge cập nhật', () => {
  const manager = new MockCartBadgeManager({ token: 'test-jwt', id: 1 });
  manager.addToCart('fav-candle', 1);
  assert.equal(manager.badgeCount, 1, 'Thêm từ wishlist cập nhật badge thành 1');
});

test('Kịch bản 6: Mua lại đơn hàng (Reorder) -> Badge cập nhật số lượng các món mua lại', () => {
  const manager = new MockCartBadgeManager({ token: 'test-jwt', id: 1 });
  assert.equal(manager.badgeCount, 0);

  // Mua lại đơn cũ gồm 2 món: sản phẩm A (qty 2) và sản phẩm B (qty 1)
  manager.reorder([
    { productId: 'reorder-A', quantityAdded: 2 },
    { productId: 'reorder-B', quantityAdded: 1 }
  ]);
  assert.equal(manager.badgeCount, 3, 'Badge cập nhật đúng 3 món từ đơn mua lại');
});

test('Kịch bản 7: Sau khi checkout thành công -> Các món đã đặt bị xóa, badge cập nhật phần còn lại', () => {
  const manager = new MockCartBadgeManager({ token: 'test-jwt', id: 1 });
  // Giỏ hàng có 2 món được chọn và 1 món chưa chọn
  manager.serverCart.items = [
    { productId: 'buy-1', quantity: 2, selected: true },
    { productId: 'buy-2', quantity: 1, selected: true },
    { productId: 'keep-3', quantity: 1, selected: false }
  ];
  manager.serverCart.itemCount = 4;
  manager.sync();
  assert.equal(manager.badgeCount, 4, 'Trước checkout có 4 sản phẩm trong giỏ');

  // Đặt hàng thành công
  manager.checkoutSuccess();
  assert.equal(manager.badgeCount, 1, 'Sau checkout chỉ còn 1 sản phẩm chưa chọn trong giỏ');
  assert.equal(manager.serverCart.items.length, 1);
  assert.equal(manager.serverCart.items[0].productId, 'keep-3');
});

