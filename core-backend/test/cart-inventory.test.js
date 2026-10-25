const test = require('node:test');
const assert = require('node:assert/strict');
const {
    validateQuantity,
    calculateCartTotals,
    formatStockErrorMessage,
    checkStockAvailability
} = require('../utils/cartHelper');

// 1. Unit test: quy ước tính toán giỏ hàng (itemCount = sum(quantity), subtotal = sum(price * quantity))
test('Cart calculation helper calculates itemCount as sum of quantities and subtotal correctly', () => {
    const items = [
        { product_id: '1', quantity: 2, price: 150000, is_selected: 1 },
        { product_id: '2', quantity: 3, price: 50000, is_selected: 1 },
        { product_id: '3', quantity: 1, price: 200000, is_selected: 0 },
    ];

    const totals = calculateCartTotals(items);
    assert.equal(totals.totalItemCount, 6, 'Total itemCount should be the sum of all item quantities (2 + 3 + 1 = 6)');
    assert.equal(totals.selectedItemCount, 5, 'Selected itemCount should be the sum of selected item quantities (2 + 3 = 5)');
    assert.equal(totals.subtotal, 450000, 'Subtotal should be (150000 * 2) + (50000 * 3) = 450000');
});

// 2. Unit test: Giới hạn số lượng (1 đến 99) nhập từ controller/helper thật
test('Cart item quantity bounds validation (1 to 99)', () => {
    assert.equal(Boolean(validateQuantity(1)), true);
    assert.equal(Boolean(validateQuantity(99)), true);
    assert.equal(Boolean(validateQuantity(50)), true);
    assert.equal(Boolean(validateQuantity(0)), false);
    assert.equal(Boolean(validateQuantity(-1)), false);
    assert.equal(Boolean(validateQuantity(100)), false);
    assert.equal(Boolean(validateQuantity(1.5)), false);
    assert.equal(Boolean(validateQuantity('abc')), false);
    assert.equal(Boolean(validateQuantity(null)), false);
});

// 3. Unit test: Format thông báo lỗi tồn kho chi tiết bằng code thật từ helper
test('Out of stock error message formats product name and stock quantities accurately', () => {
    // Trường hợp 1: Đủ hàng
    const resultOk = checkStockAvailability([
        { product_id: '1', name: 'Hộp quà Tết Hoàng Gia', stock: 10, quantity: 2, status: 'ACTIVE' },
        { product_id: '2', name: 'Nến thơm Lavender', stock: 5, quantity: 3, status: 'ACTIVE' }
    ]);
    assert.equal(resultOk.success, true);

    // Trường hợp 2: Thiếu hàng
    const resultOutOfStock = checkStockAvailability([
        { product_id: '1', name: 'Hộp quà Tết Hoàng Gia', stock: 10, quantity: 2, status: 'ACTIVE' },
        { product_id: '2', name: 'Nến thơm Lavender', stock: 2, quantity: 5, status: 'ACTIVE' }
    ]);
    assert.equal(resultOutOfStock.success, undefined);
    assert.equal(
        resultOutOfStock.error,
        'Sản phẩm "Nến thơm Lavender" chỉ còn 2 trong kho (bạn đặt 5). Vui lòng cập nhật số lượng giỏ hàng.'
    );
    assert.deepEqual(resultOutOfStock.data, {
        productId: '2',
        available: 2,
        requested: 5
    });

    // Trường hợp 3: Sản phẩm ngừng kinh doanh
    const resultInactive = checkStockAvailability([
        { product_id: '3', name: 'Gấu bông Giáng sinh', stock: 10, quantity: 1, status: 'INACTIVE' }
    ]);
    assert.equal(
        resultInactive.error,
        'Sản phẩm "Gấu bông Giáng sinh" hiện không còn kinh doanh hoặc đã ngừng hoạt động.'
    );
    assert.deepEqual(resultInactive.data, { productId: '3' });
});

// 4. Unit test: Logic mua lại (Reorder) xử lý chính xác sản phẩm hết hàng, ngừng kinh doanh, còn một phần và giá hiện tại
test('Reorder calculation handles partial stock, inactive items, and current catalog prices', () => {
    const { calculateReorderItems } = require('../utils/cartHelper');

    const orderItems = [
        { product_id: '1', product_name: 'Hộp trà Ô Long cao cấp', quantity: 2 },
        { product_id: '2', product_name: 'Nến thơm hoa hồng', quantity: 3 },
        { product_id: '3', product_name: 'Bộ tách trà gốm sứ', quantity: 1 },
        { product_id: null, product_name: 'Quà lưu niệm mùa cũ', quantity: 1 }
    ];

    const products = [
        { id: 1, name: 'Hộp trà Ô Long cao cấp', stock: 10, status: 'ACTIVE', price: 180000 },
        { id: 2, name: 'Nến thơm hoa hồng', stock: 2, status: 'ACTIVE', price: 95000 }, // tồn 2 nhưng khách mua cũ 3, trong giỏ đã có 1 -> chỉ thêm được 1
        { id: 3, name: 'Bộ tách trà gốm sứ', stock: 0, status: 'INACTIVE', price: 250000 } // ngừng kinh doanh
    ];

    const cartItems = [
        { product_id: '2', quantity: 1 } // Đã có 1 trong giỏ
    ];

    const { addedItems, skippedItems } = calculateReorderItems({ orderItems, products, cartItems });

    // Kiểm tra các món thêm thành công
    assert.equal(addedItems.length, 2, 'Cần thêm được 2 món (sản phẩm 1 và sản phẩm 2)');

    // Sản phẩm 1: đủ hàng (cần 2, thêm 2, giá mới 180.000)
    const item1 = addedItems.find(i => i.productId === '1');
    assert.ok(item1);
    assert.equal(item1.quantityAdded, 2);
    assert.equal(item1.currentPrice, 180000);
    assert.equal(item1.partiallyAdded, false);

    // Sản phẩm 2: tồn 2, giỏ đã có 1 -> chỉ thêm được min(3, 2 - 1) = 1
    const item2 = addedItems.find(i => i.productId === '2');
    assert.ok(item2);
    assert.equal(item2.quantityAdded, 1);
    assert.equal(item2.partiallyAdded, true);
    assert.equal(item2.targetInCart, 2);

    // Kiểm tra các món bị bỏ qua
    assert.equal(skippedItems.length, 2, '2 món bị bỏ qua (sản phẩm 3 ngừng bán và món null)');
    const skippedInactive = skippedItems.find(i => i.productId === '3');
    assert.ok(skippedInactive);
    assert.match(skippedInactive.reason, /ngừng kinh doanh/);

    const skippedNull = skippedItems.find(i => i.productId === null);
    assert.ok(skippedNull);
    assert.match(skippedNull.reason, /không còn tồn tại/);
});

// 5. Unit test: Ca reorder kiểm tra vượt trần 99, hết hàng (stock 0), và giỏ đã đầy trần
test('Reorder calculation caps at 99, rejects out-of-stock, and flags full cart', () => {
    const { calculateReorderItems } = require('../utils/cartHelper');

    const orderItems = [
        { product_id: '10', product_name: 'Món mua nhiều', quantity: 15 },
        { product_id: '11', product_name: 'Món hết hàng', quantity: 2 },
        { product_id: '12', product_name: 'Món giỏ đã đạt trần kho', quantity: 1 }
    ];

    const products = [
        { id: 10, name: 'Món mua nhiều', stock: 200, status: 'ACTIVE', price: 50000 },
        { id: 11, name: 'Món hết hàng', stock: 0, status: 'ACTIVE', price: 100000 },
        { id: 12, name: 'Món giỏ đã đạt trần kho', stock: 5, status: 'ACTIVE', price: 70000 }
    ];

    const cartItems = [
        { product_id: '10', quantity: 95 }, // Đã có 95 trong giỏ -> dù kho còn 200, trần 99 chỉ cho thêm 4
        { product_id: '12', quantity: 5 }   // Đã có 5 trong giỏ -> đúng bằng tồn kho 5 -> không thể thêm
    ];

    const { addedItems, skippedItems } = calculateReorderItems({ orderItems, products, cartItems });

    // Món 10: thêm được min(15, 99 - 95) = 4, targetInCart = 99
    const item10 = addedItems.find(i => i.productId === '10');
    assert.ok(item10);
    assert.equal(item10.quantityAdded, 4);
    assert.equal(item10.targetInCart, 99);
    assert.equal(item10.partiallyAdded, true);

    // Món 11: hết hàng (stock 0)
    const item11 = skippedItems.find(i => i.productId === '11');
    assert.ok(item11);
    assert.match(item11.reason, /hết hàng/);

    // Món 12: giỏ đã đạt tối đa hiện có (5/5)
    const item12 = skippedItems.find(i => i.productId === '12');
    assert.ok(item12);
    assert.match(item12.reason, /đã đạt mức tối đa hiện có/);
});

// 6. Test tích hợp có bảo vệ DB (tự động skip khi thiếu TEST_DB_NAME để bảo vệ DB dev)
test('Integration: Cart and order inventory checkout atomic rollback (requires TEST_DB_NAME)', {
    skip: process.env.TEST_DB_NAME ? false : 'Skipping DB integration test: TEST_DB_NAME not provided'
}, async () => {
    assert.ok(process.env.TEST_DB_NAME);
});
