'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { ORDER_STATUS_LABELS, getOrderStatusLabel } = require('../utils/orderStatusLabels');

describe('Đồng bộ 1-1 nhãn trạng thái đơn hàng giữa Backend và Frontend (ORDER_STATUS)', () => {
  test('Bảng ORDER_STATUS_LABELS ở Backend khớp chính xác 1-1 với ORDER_STATUS ở Frontend', async () => {
    const labelsFilePath = path.resolve(__dirname, '../../core-frontend/src/lib/labels.js');
    const feModule = await import(pathToFileURL(labelsFilePath).href);
    const feOrderStatus = feModule.ORDER_STATUS;

    assert.ok(feOrderStatus, 'Frontend phải xuất ORDER_STATUS');
    assert.ok(ORDER_STATUS_LABELS, 'Backend phải có ORDER_STATUS_LABELS');

    const beKeys = Object.keys(ORDER_STATUS_LABELS).sort();
    const feKeys = Object.keys(feOrderStatus).sort();

    assert.deepEqual(beKeys, feKeys, 'Danh sách các key trạng thái đơn hàng phải giống hệt nhau');

    for (const key of feKeys) {
      assert.equal(
        ORDER_STATUS_LABELS[key],
        feOrderStatus[key],
        `Nhãn tiếng Việt cho trạng thái "${key}" phải đồng bộ giữa Backend và Frontend`
      );
    }
  });

  test('Backend getOrderStatusLabel trả về nhãn tiếng Việt đúng và fallback an toàn', () => {
    assert.equal(getOrderStatusLabel('PENDING'), 'Chờ xác nhận');
    assert.equal(getOrderStatusLabel('CONFIRMED'), 'Đã xác nhận');
    assert.equal(getOrderStatusLabel('PROCESSING'), 'Đang chuẩn bị hàng');
    assert.equal(getOrderStatusLabel('SHIPPED'), 'Đang giao hàng');
    assert.equal(getOrderStatusLabel('DELIVERED'), 'Đã giao hàng');
    assert.equal(getOrderStatusLabel('CANCELLED'), 'Đã hủy');
    assert.equal(getOrderStatusLabel('UNKNOWN_STATUS'), 'UNKNOWN_STATUS');
    assert.equal(getOrderStatusLabel(''), '');
    assert.equal(getOrderStatusLabel(null), '');
  });
});
