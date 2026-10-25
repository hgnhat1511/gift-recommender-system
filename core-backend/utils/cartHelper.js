function validateQuantity(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= 99 ? number : null;
}

function calculateCartTotals(items = []) {
    const cents = (v) => Math.round(Number(v) * 100);
    const amount = (v) => Number((v / 100).toFixed(2));

    const totalItemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const selectedItems = items.filter((item) => Boolean(item.is_selected ?? item.selected));
    const selectedItemCount = selectedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const subtotalCents = selectedItems.reduce((sum, item) => {
        const price = item.price ?? item.product?.price ?? 0;
        return sum + cents(price) * Number(item.quantity || 0);
    }, 0);

    return {
        totalItemCount,
        selectedItemCount,
        subtotal: amount(subtotalCents)
    };
}

function formatStockErrorMessage(productName, stock, requested, status = 'ACTIVE') {
    const name = productName || 'Sản phẩm trong giỏ';
    if (status !== 'ACTIVE') {
        return `Sản phẩm "${name}" hiện không còn kinh doanh hoặc đã ngừng hoạt động.`;
    }
    const numStock = Number(stock || 0);
    const numRequested = Number(requested || 0);
    if (numStock <= 0) {
        return `Sản phẩm "${name}" hiện đã hết hàng.`;
    }
    if (numRequested > numStock) {
        return `Sản phẩm "${name}" chỉ còn ${numStock} trong kho (bạn đặt ${numRequested}). Vui lòng cập nhật số lượng giỏ hàng.`;
    }
    return null;
}

function checkStockAvailability(items = []) {
    const unavailableItem = items.find((item) => !item.name || item.status !== 'ACTIVE');
    if (unavailableItem) {
        return {
            error: formatStockErrorMessage(unavailableItem.name, unavailableItem.stock, unavailableItem.quantity, 'INACTIVE'),
            data: { productId: String(unavailableItem.product_id ?? unavailableItem.id ?? '') }
        };
    }
    const outOfStockItem = items.find((item) => Number(item.quantity) > Number(item.stock));
    if (outOfStockItem) {
        return {
            error: formatStockErrorMessage(outOfStockItem.name, outOfStockItem.stock, outOfStockItem.quantity, 'ACTIVE'),
            data: {
                productId: String(outOfStockItem.product_id ?? outOfStockItem.id ?? ''),
                available: Number(outOfStockItem.stock),
                requested: Number(outOfStockItem.quantity)
            }
        };
    }
    return { success: true };
}

function calculateReorderItems({ orderItems = [], products = [], cartItems = [] }) {
    const requested = new Map();
    const skippedItems = [];

    for (const item of orderItems) {
        if (item.product_id == null) {
            skippedItems.push({
                productId: null,
                name: item.product_name,
                reason: `Sản phẩm "${item.product_name}" không còn tồn tại trên hệ thống.`
            });
            continue;
        }
        const id = String(item.product_id);
        const current = requested.get(id) || { quantity: 0, name: item.product_name };
        current.quantity += Number(item.quantity || 0);
        requested.set(id, current);
    }

    const byId = new Map(products.map((p) => [String(p.id), p]));
    const inCart = new Map(cartItems.map((c) => [String(c.product_id), Number(c.quantity || 0)]));
    const addedItems = [];

    for (const [id, item] of requested) {
        const product = byId.get(id);
        if (!product || product.status !== 'ACTIVE') {
            skippedItems.push({
                productId: id,
                name: item.name,
                reason: `Sản phẩm "${item.name}" hiện đã ngừng kinh doanh.`
            });
            continue;
        }
        const currentStock = Number(product.stock || 0);
        if (currentStock <= 0) {
            skippedItems.push({
                productId: id,
                name: product.name,
                reason: `Sản phẩm "${product.name}" hiện đã hết hàng.`
            });
            continue;
        }
        const alreadyInCart = inCart.get(id) || 0;
        const availableSpace = Math.max(0, Math.min(currentStock - alreadyInCart, 99 - alreadyInCart));
        if (availableSpace <= 0) {
            skippedItems.push({
                productId: id,
                name: product.name,
                reason: `Số lượng sản phẩm "${product.name}" trong giỏ đã đạt mức tối đa hiện có (${alreadyInCart}/${currentStock}).`
            });
            continue;
        }
        const qtyToAdd = Math.min(item.quantity, availableSpace);
        const isPartial = qtyToAdd < item.quantity;
        addedItems.push({
            productId: id,
            name: product.name,
            requestedQuantity: item.quantity,
            quantityAdded: qtyToAdd,
            currentPrice: Number(product.price || 0),
            partiallyAdded: isPartial,
            targetInCart: alreadyInCart + qtyToAdd,
            reason: isPartial ? `Chỉ thêm được ${qtyToAdd}/${item.quantity} do giới hạn tồn kho.` : undefined
        });
    }

    return {
        addedItems,
        skippedItems,
        productIds: [...requested.keys()]
    };
}

module.exports = {
    validateQuantity,
    calculateCartTotals,
    formatStockErrorMessage,
    checkStockAvailability,
    calculateReorderItems
};
