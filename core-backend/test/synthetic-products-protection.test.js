/**
 * synthetic-products-protection.test.js
 * Kiểm thử quy tắc chặn sản phẩm synthetic (is_synthetic_display = TRUE)
 * khỏi toàn bộ luồng mua sắm công khai và checkout (BƯỚC 1).
 * Hoàn toàn in-memory, không ghi vào database.
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateReorderItems } = require('../utils/cartHelper');
const cartController = require('../controllers/cartController');
const pool = require('../config/db');

function createMockRes() {
    return {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        }
    };
}

describe('BƯỚC 1: Chặn sản phẩm synthetic khỏi storefront, giỏ hàng, checkout và mua lại', () => {
    describe('1. Mua lại (Reorder): calculateReorderItems loại bỏ sản phẩm synthetic', () => {
        test('Bỏ qua sản phẩm có is_synthetic_display = TRUE và đưa vào skippedItems', () => {
            const orderItems = [
                { product_id: '1', product_name: 'Quà thật 1', quantity: 1 },
                { product_id: '201', product_name: 'Tai nghe Bluetooth REES', quantity: 2 }
            ];
            const products = [
                { id: '1', name: 'Quà thật 1', price: 100000, stock: 10, status: 'ACTIVE', is_synthetic_display: false },
                { id: '201', name: 'Tai nghe Bluetooth REES', price: 250000, stock: 50, status: 'ACTIVE', is_synthetic_display: true }
            ];
            const cartItems = [];

            const result = calculateReorderItems({ orderItems, products, cartItems });
            assert.equal(result.addedItems.length, 1);
            assert.equal(result.addedItems[0].productId, '1');
            assert.equal(result.skippedItems.length, 1);
            assert.equal(result.skippedItems[0].productId, '201');
            assert.match(result.skippedItems[0].reason, /sản phẩm mẫu thử nghiệm, không hỗ trợ mua lại/);
        });

        test('Nếu đơn hàng chỉ toàn sản phẩm synthetic thì addedItems rỗng', () => {
            const orderItems = [
                { product_id: '201', product_name: 'Tai nghe Bluetooth REES', quantity: 1 }
            ];
            const products = [
                { id: '201', name: 'Tai nghe Bluetooth REES', price: 250000, stock: 50, status: 'ACTIVE', is_synthetic_display: true }
            ];
            const result = calculateReorderItems({ orderItems, products, cartItems: [] });
            assert.equal(result.addedItems.length, 0);
            assert.equal(result.skippedItems.length, 1);
        });
    });

    describe('2. Giỏ hàng (Cart): Chặn thêm hoặc cập nhật sản phẩm synthetic', () => {
        test('cartController.add từ chối khi sản phẩm có is_synthetic_display = TRUE', async () => {
            const origGetConn = pool.getConnection;
            let rolledBack = false;
            pool.getConnection = async () => ({
                beginTransaction: async () => {},
                execute: async (sql, params) => {
                    if (sql.includes('SELECT id,name,stock,is_synthetic_display FROM products')) {
                        return [[{ id: 201, name: 'Sản phẩm demo REES', stock: 10, is_synthetic_display: 1 }]];
                    }
                    return [[]];
                },
                rollback: async () => { rolledBack = true; },
                commit: async () => {},
                release: () => {}
            });

            try {
                const req = { user: { id: 1 }, body: { productId: '201', quantity: 1 } };
                const res = createMockRes();
                await cartController.add(req, res);
                assert.equal(res.statusCode, 400);
                assert.equal(res.body.success, false);
                assert.equal(res.body.message, 'Sản phẩm mẫu thử nghiệm không thể thêm vào giỏ hàng.');
                assert.equal(rolledBack, true);
            } finally {
                pool.getConnection = origGetConn;
            }
        });

        test('cartController.merge từ chối khi giỏ khách chứa sản phẩm synthetic', async () => {
            const origGetConn = pool.getConnection;
            let rolledBack = false;
            pool.getConnection = async () => ({
                beginTransaction: async () => {},
                execute: async (sql, params) => {
                    if (sql.includes('cart_merge_requests')) return [[]];
                    if (sql.includes('SELECT id,name,stock,status,is_synthetic_display FROM products')) {
                        return [[{ id: 201, name: 'Sản phẩm demo REES', stock: 10, status: 'ACTIVE', is_synthetic_display: 1 }]];
                    }
                    if (sql.includes('cart_items')) return [[]];
                    return [[]];
                },
                rollback: async () => { rolledBack = true; },
                commit: async () => {},
                release: () => {}
            });

            try {
                const req = {
                    user: { id: 1 },
                    body: {
                        mergeKey: 'test-merge-synthetic-key-1',
                        items: [{ productId: '201', quantity: 1, selected: true }]
                    }
                };
                const res = createMockRes();
                await cartController.merge(req, res);
                assert.equal(res.statusCode, 400);
                assert.equal(res.body.success, false);
                assert.match(res.body.message, /là sản phẩm mẫu thử nghiệm/);
                assert.equal(rolledBack, true);
            } finally {
                pool.getConnection = origGetConn;
            }
        });

        test('cartController.update từ chối cập nhật dòng giỏ có is_synthetic_display = TRUE', async () => {
            const origGetConn = pool.getConnection;
            let rolledBack = false;
            pool.getConnection = async () => ({
                beginTransaction: async () => {},
                execute: async (sql, params) => {
                    if (sql.includes('SELECT ci.id,p.id product_id,p.name,p.stock,p.status,p.is_synthetic_display')) {
                        return [[{ id: 99, product_id: 201, name: 'Sản phẩm demo', stock: 10, status: 'ACTIVE', is_synthetic_display: 1 }]];
                    }
                    return [[]];
                },
                rollback: async () => { rolledBack = true; },
                commit: async () => {},
                release: () => {}
            });

            try {
                const req = { user: { id: 1 }, params: { itemId: '99' }, body: { quantity: 2 } };
                const res = createMockRes();
                await cartController.update(req, res);
                assert.equal(res.statusCode, 400);
                assert.equal(res.body.success, false);
                assert.equal(res.body.message, 'Sản phẩm mẫu thử nghiệm không thể cập nhật trong giỏ hàng.');
                assert.equal(rolledBack, true);
            } finally {
                pool.getConnection = origGetConn;
            }
        });
    });

    describe('3. Chi tiết sản phẩm (catalogController.detail): Chặn khách thường xem chi tiết sản phẩm synthetic', () => {
        const catalogController = require('../controllers/catalogController');

        test('Khách thường hoặc khách vãng lai gọi GET /products/:id sản phẩm synthetic -> trả 404', async () => {
            const origExec = pool.execute;
            pool.execute = async (sql, params) => {
                if (sql.includes('SELECT p.*,c.name category_name')) {
                    return [[{
                        id: 201, name: 'REES Product', category_id: 99, status: 'ACTIVE',
                        is_synthetic_display: 1
                    }]];
                }
                return [[]];
            };

            try {
                const req = { params: { id: '201' }, user: null }; // Khách vãng lai
                const res = createMockRes();
                await catalogController.detail(req, res, () => {});
                assert.equal(res.statusCode, 404);
                assert.equal(res.body.success, false);
                assert.equal(res.body.message, 'Product not found.');
            } finally {
                pool.execute = origExec;
            }
        });

        test('Tài khoản demo có ml_user_id gọi GET /products/:id sản phẩm synthetic -> cho phép xem', async () => {
            const origExec = pool.execute;
            pool.execute = async (sql, params) => {
                if (sql.includes('SELECT p.*,c.name category_name') && !sql.includes('category_id <=>')) {
                    return [[{
                        id: 201, name: 'REES Product', category_id: 99, status: 'ACTIVE',
                        is_synthetic_display: 1, occasion_tags: '[]', recipient_tags: '[]', interest_tags: '[]'
                    }]];
                }
                if (sql.includes('product_events')) return [[]];
                if (sql.includes('product_images')) return [[]];
                if (sql.includes('category_id <=>')) return [[]]; // related products
                return [[]];
            };

            try {
                const req = { params: { id: '201' }, user: { id: 5, ml_user_id: 1515915625514046424 } };
                const res = createMockRes();
                await catalogController.detail(req, res, () => {});
                assert.equal(res.statusCode, null); // 200 JSON
                assert.equal(res.body.success, true);
                assert.equal(res.body.data.product.id, '201');
                assert.equal(res.body.data.product.isSyntheticDisplay, true);
            } finally {
                pool.execute = origExec;
            }
        });
    });
});
