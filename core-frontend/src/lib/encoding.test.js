/**
 * encoding.test.js
 * Test tự động quét toàn bộ core-frontend/src/ (mọi file *.js, *.jsx):
 * 1. Không chứa ký tự U+FFFD (\uFFFD).
 * 2. Không chứa HTML entities trong chuỗi hoặc JSX (&#...; hoặc &entity;).
 * 3. Không chứa từ tiếng Việt bị biến thành dấu hỏi (regex [a-zA-Zà-ỹÀ-Ỹ]\\?[a-zA-Zà-ỹÀ-Ỹ]).
 * 4. Không chứa dấu ba chấm bị hỏng thành dấu hỏi (Saving?, Loading?, Đang...?).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '..'); // core-frontend/src

function getAllSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllSourceFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.jsx'))) {
      // Bỏ qua chính file test encoding để không tự quét các chuỗi regex mẫu của test
      if (entry.name === 'encoding.test.js') continue;
      files.push(full);
    }
  }
  return files;
}

const sourceFiles = getAllSourceFiles(srcDir);

// Trích xuất các chuỗi string literals và JSX text từ một dòng code để kiểm tra nội dung hiển thị
function extractStringsAndJsxText(line) {
  const clean = line.replace(/\/\/.*$/, ''); // Bỏ comment cuối dòng
  const results = [];
  
  // Chuỗi trong nháy đơn, nháy kép hoặc template literal cố định
  const strRegex = /'([^'\\]|\\.)*'|"([^"\\]|\\.)*"/g;
  let match;
  while ((match = strRegex.exec(clean)) !== null) {
    results.push(match[0].slice(1, -1));
  }

  // Text giữa các thẻ JSX >...< (chỉ lấy phần text tĩnh bên ngoài {})
  const jsxRegex = />([^<{}]+)</g;
  while ((match = jsxRegex.exec(clean)) !== null) {
    const t = match[1].trim();
    if (t) results.push(t);
  }

  return results;
}

describe('Kiểm tra toàn vẹn mã hóa UTF-8 trong core-frontend/src/', () => {
  test('1. Không chứa ký tự U+FFFD (Unicode Replacement Character)', () => {
    const violations = [];
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('\uFFFD')) {
        const rel = path.relative(srcDir, file).replace(/\\/g, '/');
        violations.push(rel);
      }
    }
    assert.deepEqual(violations, [], `Phát hiện U+FFFD tại: ${violations.join(', ')}`);
  });

  test('2. Không chứa HTML entities trong chuỗi hoặc JSX (&#...; hoặc &entity;)', () => {
    const violations = [];
    const htmlEntityRegex = /&#\d+;|&[a-zA-Z]+;/;
    for (const file of sourceFiles) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const rel = path.relative(srcDir, file).replace(/\\/g, '/');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;
        const texts = extractStringsAndJsxText(line);
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
    for (const file of sourceFiles) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const rel = path.relative(srcDir, file).replace(/\\/g, '/');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;
        const texts = extractStringsAndJsxText(line);
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

  test('4. Không chứa dấu ba chấm bị hỏng thành dấu hỏi (Saving?, Loading?, Đang...?)', () => {
    const violations = [];
    const brokenRegex = /(?:Saving|Loading|Đang\s+[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]+)\?/u;
    for (const file of sourceFiles) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const rel = path.relative(srcDir, file).replace(/\\/g, '/');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;
        const texts = extractStringsAndJsxText(line);
        for (const text of texts) {
          if (brokenRegex.test(text)) {
            violations.push(`${rel}:${i + 1}: ${line.trim()}`);
            break;
          }
        }
      }
    }
    assert.deepEqual(violations, [], `Phát hiện broken ellipsis:\n${violations.join('\n')}`);
  });
});
