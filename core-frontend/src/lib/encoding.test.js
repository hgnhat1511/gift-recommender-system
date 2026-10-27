/**
 * encoding.test.js
 * Test tự động quét toàn bộ phạm vi dự án:
 * - core-frontend/src (*.js, *.jsx)
 * - core-frontend/e2e (*.js)
 * - core-backend/controllers (*.js)
 * - core-backend/services (*.js)
 * - core-backend/utils (*.js)
 * - core-backend/routes (*.js)
 * - core-backend/test (*.js)
 * - database/migrations (*.sql)
 *
 * Kiểm tra 4 điều kiện toàn vẹn mã hóa UTF-8:
 * 1. Không chứa ký tự U+FFFD (\uFFFD).
 * 2. Không chứa HTML entities trong chuỗi hoặc JSX (&#...; hoặc &entity;).
 * 3. Không chứa từ tiếng Việt bị biến thành dấu hỏi (regex [a-zA-Zà-ỹÀ-Ỹ]\\?[a-zA-Zà-ỹÀ-Ỹ]).
 * 4. Không chứa dấu ba chấm bị hỏng thành dấu hỏi tổng quát (chuỗi kết thúc bằng "?" trước dấu nháy đóng mà không phải câu hỏi).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

const scanDirs = [
  'core-frontend/src',
  'core-frontend/e2e',
  'core-backend/controllers',
  'core-backend/services',
  'core-backend/utils',
  'core-backend/routes',
  'core-backend/test',
  'database/migrations'
];

function getAllFiles(dirPath, allowedExts) {
  const full = path.join(rootDir, dirPath);
  if (!fs.existsSync(full)) return [];
  const files = [];

  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'coverage', '.gemini', '.agents'].includes(entry.name)) {
          walk(entryPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (allowedExts.includes(ext)) {
          // Bỏ qua chính file test này để không tự bắt regex mẫu
          if (entry.name === 'encoding.test.js') continue;
          files.push(entryPath);
        }
      }
    }
  }

  walk(full);
  return files;
}

const allTargetFiles = scanDirs.flatMap(d => getAllFiles(d, ['.js', '.jsx', '.sql']));

// Trích xuất các chuỗi string literals (trong nháy đơn, kép, backtick)
function extractStringLiterals(line) {
  const clean = line.replace(/\/\/.*$/, ''); // Bỏ comment cuối dòng
  const results = [];

  const strRegex = /'([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`([^`\\]|\\.)*`/g;
  let match;
  while ((match = strRegex.exec(clean)) !== null) {
    const raw = match[0];
    results.push(raw.slice(1, -1));
  }

  return results;
}

// Trích xuất text tĩnh trong JSX: giữa thẻ > và <, loại trừ các đoạn mã JS (như ternary inline, curly braces)
function extractJsxVisibleText(line) {
  const clean = line.replace(/\/\/.*$/, '');
  const results = [];
  const jsxRegex = />([^<{}]+)</g;
  let match;
  while ((match = jsxRegex.exec(clean)) !== null) {
    const t = match[1].trim();
    // Bỏ qua các đoạn code JS viết liền giữa các thẻ tag (bắt đầu bằng toán tử :, ?, return, var/const/let...)
    if (!t || /^[:?&),]|^(?:return|const|let|var)\s|===|!==|\?\./.test(t)) {
      continue;
    }
    results.push(t);
  }
  return results;
}

// Kiểm tra câu hỏi người dùng hợp lệ để phân biệt với dấu ba chấm bị hỏng thành "?"
function isLegitimateQuestion(text) {
  const trimmed = text.trim();
  // Câu hỏi tiếng Việt hợp lệ: có từ nghi vấn hoặc bắt đầu bằng động từ/câu hỏi xác nhận
  return /(?:\b(bạn|có|muốn|này|chưa|không|sao|gì|ai|đâu|hả|nhỉ|thế)\b|\?{2,}|^(?:Xóa|Ẩn|Khóa|Hủy|Đặt|Tạo|Cập nhật|Quên)\s)/i.test(trimmed);
}

describe('Kiểm tra toàn vẹn mã hóa UTF-8 toàn bộ dự án', () => {
  test('1. Không chứa ký tự U+FFFD (Unicode Replacement Character)', () => {
    const violations = [];
    for (const file of allTargetFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('\uFFFD')) {
        const rel = path.relative(rootDir, file).replace(/\\/g, '/');
        violations.push(rel);
      }
    }
    assert.deepEqual(violations, [], `Phát hiện U+FFFD tại: ${violations.join(', ')}`);
  });

  test('2. Không chứa HTML entities trong chuỗi hoặc JSX (&#...; hoặc &entity;)', () => {
    const violations = [];
    const htmlEntityRegex = /&#\d+;|&[a-zA-Z]+;/;
    for (const file of allTargetFiles) {
      const ext = path.extname(file);
      const isJsx = ext === '.jsx';
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const rel = path.relative(rootDir, file).replace(/\\/g, '/');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;
        const texts = [...extractStringLiterals(line), ...(isJsx ? extractJsxVisibleText(line) : [])];
        for (const text of texts) {
          if (htmlEntityRegex.test(text)) {
            violations.push(`${rel}:${i + 1}: ${line.trim()}`);
            break;
          }
        }
      }
    }
    assert.deepEqual(violations, [], `Phát hiện HTML entities:\n${violations.join('\n')}`);
  });

  test('3. Không chứa từ tiếng Việt bị biến thành dấu hỏi (regex [a-zA-Zà-ỹÀ-Ỹ]\\?[a-zA-Zà-ỹÀ-Ỹ])', () => {
    const violations = [];
    const corruptRegex = /[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]\?[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]/u;
    for (const file of allTargetFiles) {
      const ext = path.extname(file);
      const isJsx = ext === '.jsx';
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const rel = path.relative(rootDir, file).replace(/\\/g, '/');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;
        const texts = [...extractStringLiterals(line), ...(isJsx ? extractJsxVisibleText(line) : [])];
        for (const text of texts) {
          // Bỏ qua URL hoặc querystring trong chuỗi
          if (/https?:\/\//.test(text) || /\/[a-zA-Z0-9_/-]+\?[a-zA-Z0-9_=&%-]+/.test(text)) continue;
          if (corruptRegex.test(text)) {
            violations.push(`${rel}:${i + 1}: ${line.trim()}`);
            break;
          }
        }
      }
    }
    assert.deepEqual(violations, [], `Phát hiện từ tiếng Việt lỗi dấu hỏi:\n${violations.join('\n')}`);
  });

  test('4. Không chứa dấu ba chấm bị hỏng thành dấu hỏi tổng quát (kết thúc bằng "?" trước dấu nháy đóng)', () => {
    const violations = [];
    // Mẫu tổng quát: chữ cái kết thúc bằng ? ở cuối chuỗi literal trước dấu nháy đóng
    const trailingQuestionRegex = /[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]\?$/u;
    for (const file of allTargetFiles) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const rel = path.relative(rootDir, file).replace(/\\/g, '/');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;
        const stringLiterals = extractStringLiterals(line);
        for (const text of stringLiterals) {
          if (trailingQuestionRegex.test(text.trim()) && !isLegitimateQuestion(text)) {
            violations.push(`${rel}:${i + 1}: ${line.trim()}`);
            break;
          }
        }
      }
    }
    assert.deepEqual(violations, [], `Phát hiện broken ellipsis (kết thúc bằng ? trước dấu nháy đóng):\n${violations.join('\n')}`);
  });
});
