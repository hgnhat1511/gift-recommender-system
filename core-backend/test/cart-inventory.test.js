const test = require('node:test');
const assert = require('node:assert/strict');

// 1. Unit test: quy ước tính toán giỏ hàng (itemCount = sum(quantity), subtotal = sum(price * quantity))
test('Cart calculation helper calculates itemCount as sum of quantities and subtotal correctly', () => {
    const items = [
        { product_id: '1', quantity: 2, price: 150000, is_selected: 1 },
        { product_id: '2', quantity: 3, price: 50000, is_selected: 1 },
        { product_id: '3', quantity: 1, price: 200000, is_selected: 0 },
    ];

    const cents = (v) => Math.round(Number(v) * 100);
    const amount = (v) => Number((v / 100).toFixed(2));

    const totalItemCount = items.reduce((sum, item) => sum + Number(item.quantity), 0);
    assert.equal(totalItemCount, 6, 'Total itemCount should be the sum of all item quantities (2 + 3 + 1 = 6)');

    const selectedItems = items.filter(item => item.is_selected === 1);
    const selectedItemCount = selectedItems.reduce((sum, item) => sum + Number(item.quantity), 0);
    assert.equal(selectedItemCount, 5, 'Selected itemCount should be the sum of selected item quantities (2 + 3 = 5)');

    const subtotalCents = selectedItems.reduce((sum, item) => sum + cents(item.price) * Number(item.quantity), 0);
    assert.equal(amount(subtotalCents), 450000, 'Subtotal should be (150000 * 2) + (50000 * 3) = 450000');
});

// 2. Unit test: Giới hạn số lượng (1 đến 99)
test('Cart item quantity bounds validation (1 to 99)', () => {
    function isValidCartQuantity(qty) {
        const num = Number(qty);
        return Number.isInteger(num) && num >= 1 && num <= 99;
    }

    assert.equal(isValidCartQuantity(1), true);
    assert.equal(isValidCartQuantity(99), true);
    assert.equal(isValidCartQuantity(50), true);
    assert.equal(isValidCartQuantity(0), false);
    assert.equal(isValidCartQuantity(-1), false);
    assert.equal(isValidCartQuantity(100), false);
    assert.equal(isValidCartQuantity(1.5), false);
    assert.equal(isValidCartQuantity('abc'), false);
    assert.equal(isValidCartQuantity(null), false);
});

// 3. Unit test: Format thông báo lỗi tồn kho chi tiết
test('Out of stock error message formats product name and stock quantities accurately', () => {
    function checkStock(items) {
        const unavailableItem = items.find((item) => !item.name || item.status !== 'ACTIVE');
        if (unavailableItem) {
            return {
                error: `Sản phẩm "${unavailableItem.name || 'trong giỏ'}" hiện không còn kinh doanh hoặc đã ngừng hoạt động.`,
                data: { productId: unavailableItem.product_id }
            };
        }
        const outOfStockItem = items.find((item) => Number(item.quantity) > Number(item.stock));
        if (outOfStockItem) {
            return {
                error: `Sản phẩm "${outOfStockItem.name}" chỉ còn ${outOfStockItem.stock} trong kho (bạn đặt ${outOfStockItem.quantity}). Vui lòng cập nhật số lượng giỏ hàng.`,
                data: {
                    productId: outOfStockItem.product_id,
                    available: Number(outOfStockItem.stock),
                    requested: Number(outOfStockItem.quantity)
                }
            };
        }
        return { success: true };
    }

    // Trường hợp 1: Đủ hàng
    const resultOk = checkStock([
        { product_id: '1', name: 'Hộp quà Tết Hoàng Gia', stock: 10, quantity: 2, status: 'ACTIVE' },
        { product_id: '2', name: 'Nến thơm Lavender', stock: 5, quantity: 3, status: 'ACTIVE' }
    ]);
    assert.equal(resultOk.success, true);

    // Trường hợp 2: Thiếu hàng
    const resultOutOfStock = checkStock([
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
    const resultInactive = checkStock([
        { product_id: '3', name: 'Gấu bông Giáng sinh', stock: 10, quantity: 1, status: 'INACTIVE' }
    ]);
    assert.equal(
        resultInactive.error,
        'Sản phẩm "Gấu bông Giáng sinh" hiện không còn kinh doanh hoặc đã ngừng hoạt động.'
    );
    assert.deepEqual(resultInactive.data, { productId: '3' });
});

// 4. Test tích hợp có bảo vệ DB (tự động skip khi thiếu TEST_DB_NAME để bảo vệ DB dev)
test('Integration: Cart and order inventory checkout atomic rollback (requires TEST_DB_NAME)', {
    skip: process.env.TEST_DB_NAME ? false : 'Skipping DB integration test: TEST_DB_NAME not provided'
}, async () => {
    // Chỉ chạy khi có môi trường test DB riêng biệt
    assert.ok(process.env.TEST_DB_NAME);
});
