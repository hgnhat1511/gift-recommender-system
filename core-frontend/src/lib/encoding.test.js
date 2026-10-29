/**
 * encoding.test.js
 * Test tự động quét toàn bộ phạm vi dự án:
 * - core-frontend/src (*.js, *.jsx, *.css, *.json)
 * - core-frontend/e2e (*.js)
 * - core-frontend/fixtures (*.json, *.js)
 * - core-backend/controllers (*.js)
 * - core-backend/services (*.js)
 * - core-backend/utils (*.js)
 * - core-backend/routes (*.js)
 * - core-backend/test (*.js)
 * - database/migrations (*.sql)
 * - Tài liệu và cấu hình gốc: PROGRESS.md, README.md, package.json
 *
 * Kiểm tra 4 điều kiện toàn vẹn mã hóa UTF-8:
 * 1. Không chứa ký tự U+FFFD (\uFFFD).
 * 2. Không chứa HTML entities trong chuỗi hoặc JSX (&#...; hoặc &entity;).
 * 3. Không chứa từ tiếng Việt bị biến thành dấu hỏi (regex [a-zA-Zà-ỹÀ-Ỹ]\?[a-zA-Zà-ỹÀ-Ỹ]).
 * 4. Không chứa dấu ba chấm bị hỏng thành dấu hỏi tổng quát (kết thúc bằng ? trước dấu nháy đóng) hoặc ?? liền nhau.
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
  'core-frontend/fixtures',
  'core-backend/controllers',
  'core-backend/services',
  'core-backend/utils',
  'core-backend/routes',
  'core-backend/test',
  'database/migrations'
];

const extraFiles = [
  'core-frontend/package.json',
  'core-backend/package.json',
  'PROGRESS.md',
  'README.md'
];

const allowedExts = ['.js', '.jsx', '.sql', '.css', '.json', '.md'];

function getAllFiles(dirPath, allowedExts) {
  const full = path.join(rootDir, dirPath);
  if (!fs.existsSync(full)) return [];
  const files = [];

  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'coverage', '.gemini', '.agents', '.system_generated'].includes(entry.name)) {
          walk(entryPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (allowedExts.includes(ext)) {
          // Bỏ qua chính file test này để không tự bắt regex mẫu
          if (entry.name === 'encoding.test.js') continue;
          // Bỏ qua package-lock.json: file khóa phụ thuộc do npm tự sinh, chứa hàng chục nghìn dòng mã băm sha512 và URL ngoài
          if (entry.name === 'package-lock.json') continue;
          // Bỏ qua enums.snapshot.json: snapshot thô schema database phục vụ kiểm tra snapshot kỹ thuật
          if (entry.name === 'enums.snapshot.json') continue;
          files.push(entryPath);
        }
      }
    }
  }

  walk(full);
  return files;
}

const allTargetFiles = [
  ...scanDirs.flatMap(d => getAllFiles(d, allowedExts)),
  ...extraFiles.map(f => path.join(rootDir, f)).filter(f => fs.existsSync(f))
];

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
  // Bất kỳ chuỗi nào chứa từ 2 dấu hỏi liền nhau (??) đều bị cấm
  if (/\?{2,}/.test(trimmed)) return false;
  // Dấu hỏi phải là một dấu đơn duy nhất ở cuối chuỗi, đứng sau chữ cái hoặc số
  if (!/[a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9]\?$/.test(trimmed)) return false;
  // Câu hỏi tiếng Việt hợp lệ: có từ nghi vấn hoặc bắt đầu bằng động từ/câu hỏi xác nhận
  return /(?:\b(bạn|có|muốn|này|chưa|không|sao|gì|ai|đâu|hả|nhỉ|thế)\b|^(?:Xóa|Ẩn|Khóa|Hủy|Đặt|Tạo|Cập nhật|Quên)\s)/i.test(trimmed);
}

describe('Kiểm tra toàn vẹn mã hóa UTF-8 toàn bộ dự án', () => {
  test('1. Không chứa ký tự U+FFFD (Unicode Replacement Character)', () => {
    const violations = [];
    for (const file of allTargetFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const ext = path.extname(file);
      if (content.includes('\uFFFD') || (ext !== '.md' && /\\uFFFD/i.test(content))) {
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
      const isMd = ext === '.md';
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const rel = path.relative(rootDir, file).replace(/\\/g, '/');
      let inCodeBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isMd) {
          if (line.trim().startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
          if (inCodeBlock || line.trim().startsWith('<!--')) continue;
          const clean = line.replace(/`[^`]+`/g, '');
          if (htmlEntityRegex.test(clean)) violations.push(`${rel}:${i + 1}: ${line.trim()}`);
        } else {
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
    }
    assert.deepEqual(violations, [], `Phát hiện HTML entities:\n${violations.join('\n')}`);
  });

  test('3. Không chứa từ tiếng Việt bị biến thành dấu hỏi (regex [a-zA-Zà-ỹÀ-Ỹ]\\?[a-zA-Zà-ỹÀ-Ỹ])', () => {
    const violations = [];
    const corruptRegex = /[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]\?[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]/u;
    for (const file of allTargetFiles) {
      const ext = path.extname(file);
      const isJsx = ext === '.jsx';
      const isMd = ext === '.md';
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const rel = path.relative(rootDir, file).replace(/\\/g, '/');
      let inCodeBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isMd) {
          if (line.trim().startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
          if (inCodeBlock || line.trim().startsWith('<!--')) continue;
          const clean = line.replace(/`[^`]+`/g, '');
          if (/https?:\/\//.test(clean) || /\/[a-zA-Z0-9_/-]+\?[a-zA-Z0-9_=&%-]+/.test(clean)) continue;
          if (corruptRegex.test(clean)) violations.push(`${rel}:${i + 1}: ${line.trim()}`);
        } else {
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
    }
    assert.deepEqual(violations, [], `Phát hiện từ tiếng Việt lỗi dấu hỏi:\n${violations.join('\n')}`);
  });

  test('4. Không chứa dấu ba chấm bị hỏng thành dấu hỏi tổng quát (kết thúc bằng "?" trước dấu nháy đóng) hoặc "??" liền nhau', () => {
    const violations = [];
    const trailingQuestionRegex = /[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]\?+$/u;
    for (const file of allTargetFiles) {
      const ext = path.extname(file);
      const isMd = ext === '.md';
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const rel = path.relative(rootDir, file).replace(/\\/g, '/');
      let inCodeBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isMd) {
          if (line.trim().startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
          if (inCodeBlock || line.trim().startsWith('<!--')) continue;
          const clean = line.replace(/`[^`]+`/g, '').trim();
          if ((trailingQuestionRegex.test(clean) || /\?{2,}/.test(clean)) && !isLegitimateQuestion(clean)) {
            violations.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        } else {
          if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;
          const stringLiterals = extractStringLiterals(line);
          for (const text of stringLiterals) {
            if ((trailingQuestionRegex.test(text.trim()) || /\?{2,}/.test(text.trim())) && !isLegitimateQuestion(text)) {
              violations.push(`${rel}:${i + 1}: ${line.trim()}`);
              break;
            }
          }
        }
      }
    }
    assert.deepEqual(violations, [], `Phát hiện broken ellipsis hoặc ?? liền nhau:\n${violations.join('\n')}`);
  });
});
