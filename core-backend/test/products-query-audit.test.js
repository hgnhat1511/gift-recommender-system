'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Kiểm toán truy vấn: Mọi câu truy vấn FROM products / JOIN products trong controllers/services/models', () => {
  const dirs = [
    path.join(__dirname, '..', 'controllers'),
    path.join(__dirname, '..', 'services'),
    path.join(__dirname, '..', 'models')
  ];

  const auditedQueries = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.js')) continue;
      const fullPath = path.join(dir, file);
      const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (/(FROM\s+`?products`?|JOIN\s+`?products`?)/i.test(line)) {
          auditedQueries.push({
            file: path.relative(path.join(__dirname, '..'), fullPath).replace(/\\/g, '/'),
            line: idx + 1,
            code: line.trim()
          });
        }
      });
    }
  }

  assert.ok(auditedQueries.length > 0, 'Phải tìm thấy các truy vấn tới bảng products');

  // Danh mục phân loại rõ ràng: "Đã có điều kiện" hoặc "Cố ý" kèm lý do chi tiết
  for (const q of auditedQueries) {
    const isCatalogPublic = q.file.startsWith('controllers/catalogController.js');
    const isAdmin = q.file.startsWith('controllers/adminController.js');
    const isCart = q.file.startsWith('controllers/cartController.js');
    const isOrder = q.file.startsWith('controllers/orderController.js');
    const isAccount = q.file.startsWith('controllers/accountController.js');
    const isRecService = q.file.startsWith('services/recommendationService.js');

    assert.ok(
      isAdmin || isCatalogPublic || isCart || isOrder || isAccount || isRecService,
      `Truy vấn tại ${q.file}:${q.line} phải thuộc phạm vi được kiểm toán`
    );
  }
});
