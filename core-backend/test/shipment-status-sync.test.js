'use strict';

const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');

const {
  SHIPMENT_STATUS_LABELS,
  getShipmentStatusLabel,
} = require('../utils/shipmentStatusLabels');

const {
  RETURN_STATUS_LABELS,
  getReturnStatusLabel,
} = require('../utils/returnStatusLabels');

let frontendLabels;

describe('Đồng bộ 1-1 nhãn vận chuyển và đổi trả giữa Backend và Frontend', () => {
  before(async () => {
    frontendLabels = await import('../../core-frontend/src/lib/labels.js');
  });

  test('Bảng SHIPMENT_STATUS_LABELS ở Backend khớp chính xác 1-1 với SHIPMENT_STATUS ở Frontend', () => {
    const frontendStatuses = frontendLabels.SHIPMENT_STATUS;
    assert.ok(frontendStatuses, 'Frontend phải export SHIPMENT_STATUS');

    const backendKeys = Object.keys(SHIPMENT_STATUS_LABELS).sort();
    const frontendKeys = Object.keys(frontendStatuses).sort();

    assert.deepEqual(backendKeys, frontendKeys, 'Toàn bộ enum key trạng thái vận chuyển phải khớp 1-1');

    for (const key of backendKeys) {
      assert.equal(
        SHIPMENT_STATUS_LABELS[key],
        frontendStatuses[key],
        `Nhãn tiếng Việt cho trạng thái vận chuyển "${key}" phải khớp nhau`
      );
    }
  });

  test('Bảng RETURN_STATUS_LABELS ở Backend khớp chính xác 1-1 với RETURN_STATUS ở Frontend', () => {
    const frontendReturns = frontendLabels.RETURN_STATUS;
    assert.ok(frontendReturns, 'Frontend phải export RETURN_STATUS');

    const backendKeys = Object.keys(RETURN_STATUS_LABELS).sort();
    const frontendKeys = Object.keys(frontendReturns).sort();

    assert.deepEqual(backendKeys, frontendKeys, 'Toàn bộ enum key trạng thái đổi trả phải khớp 1-1');

    for (const key of backendKeys) {
      assert.equal(
        RETURN_STATUS_LABELS[key],
        frontendReturns[key],
        `Nhãn tiếng Việt cho trạng thái đổi trả "${key}" phải khớp nhau`
      );
    }
  });

  test('Backend getShipmentStatusLabel và getReturnStatusLabel trả về nhãn tiếng Việt đúng và fallback an toàn', () => {
    assert.equal(getShipmentStatusLabel('DELIVERED'), 'Giao thành công');
    assert.equal(getShipmentStatusLabel('OUT_FOR_DELIVERY'), 'Đang phát hàng');
    assert.equal(getShipmentStatusLabel('UNKNOWN_CODE'), 'UNKNOWN_CODE');
    assert.equal(getShipmentStatusLabel(''), '');
    assert.equal(getShipmentStatusLabel(null), '');

    assert.equal(getReturnStatusLabel('APPROVED'), 'Đã duyệt');
    assert.equal(getReturnStatusLabel('REJECTED'), 'Đã từ chối');
    assert.equal(getReturnStatusLabel('UNKNOWN'), 'UNKNOWN');
    assert.equal(getReturnStatusLabel(''), '');
    assert.equal(getReturnStatusLabel(null), '');
  });
});
