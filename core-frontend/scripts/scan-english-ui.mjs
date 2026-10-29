import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

// Danh sách các từ tiếng Anh bị cấm xuất hiện trực tiếp trong UI người dùng
const forbiddenWords = [
  'catalog',
  'dashboard',
  'customer',
  'customers',
  'shopping cart',
  'add to cart',
  'sign in',
  'sign out',
  'log in',
  'log out',
  'submit',
  'checkout',
  'quantity',
  'inventory',
  'overview',
  'welcome',
  'settings',
  'address book',
  'delete account',
  'payment method',
  'shipping method',
  'order history'
];

// Các từ mượn thương hiệu / kỹ thuật được phép (whitelist có giải trình)
const whitelistPatterns = [
  /\bGiftly\b/gi,
  /\bGift Finder\b/gi,
  /\bEmail\b/gi,
  /\bVNPAY\b/gi,
  /\bGHN\b/gi,
  /\bCOD\b/gi,
  /\b(ID|URL|HTTPS|JSON|API|VND|CSS|JWT|ADMIN|CUSTOMER)\b/g,
  /\b(Vite|React|Unsplash|Lucide|UTF-8)\b/gi
];

function getAllFiles(dir, exts = ['.jsx', '.js']) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (!file.includes('node_modules') && !file.includes('.test') && !file.includes('assets')) {
        results = results.concat(getAllFiles(fullPath, exts));
      }
    } else {
      if (exts.some(ext => file.endsWith(ext)) &&
          !file.includes('.test.') &&
          !file.includes('.spec.') &&
          !file.includes('setupTests')) {
        results.push(fullPath);
      }
    }
  });
  return results;
}

const files = getAllFiles(srcDir);
const findings = [];

files.forEach(filePath => {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const relPath = path.relative(path.resolve(__dirname, '..'), filePath).replace(/\\/g, '/');

  lines.forEach((line, lineIdx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('import ')) {
      return;
    }

    const candidateMatches = [];

    // Chỉ trích xuất text JSX trên file .jsx để tránh toán tử so sánh > < trên file .js thuần
    if (filePath.endsWith('.jsx')) {
      const jsxTextMatches = line.matchAll(/>([^<]+)</g);
      for (const m of jsxTextMatches) {
        const textWithoutExpr = m[1].replace(/\{[^}]*\}/g, ' ').trim();
        if (!textWithoutExpr || textWithoutExpr.includes('=>') || textWithoutExpr.includes('}') || textWithoutExpr.includes('{')) {
          continue;
        }
        candidateMatches.push(textWithoutExpr);
      }
    }

    // Match attributes UI
    const attrMatches = line.matchAll(/(?:title|description|placeholder|aria-label)\s*=\s*["']([^"']+)["']/g);
    for (const m of attrMatches) {
      if (m[1].trim()) candidateMatches.push(m[1].trim());
    }

    // Match messages/alerts và getApiError fallback
    const msgMatches = line.matchAll(/(?:setMessage|setError|setNotice|setFail|alert|confirm|prompt)\s*\(\s*["'`]([^"'`]+)["'`]/g);
    for (const m of msgMatches) {
      if (m[1].trim()) candidateMatches.push(m[1].trim());
    }
    const apiErrorMatches = line.matchAll(/getApiError\s*\([^,]+,\s*["'`]([^"'`]+)["'`]\)/g);
    for (const m of apiErrorMatches) {
      if (m[1].trim()) candidateMatches.push(m[1].trim());
    }

    candidateMatches.forEach(rawText => {
      let cleaned = rawText;
      for (const wl of whitelistPatterns) {
        cleaned = cleaned.replace(wl, '');
      }

      for (const word of forbiddenWords) {
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        if (regex.test(cleaned)) {
          if (rawText.includes('===') || rawText.includes('!==') || rawText.includes('&&') || rawText.includes('||')) {
            continue;
          }
          findings.push({
            file: relPath,
            line: lineIdx + 1,
            word,
            rawText,
            fullLine: trimmed
          });
        }
      }
    });
  });
});

if (findings.length > 0) {
  console.log(`[SCAN:UI] Phát hiện ${findings.length} vị trí có từ tiếng Anh trên UI:`);
  findings.forEach(f => {
    console.log(`- ${f.file}:${f.line} [từ: "${f.word}"] text: "${f.rawText}"`);
  });
  process.exit(1);
} else {
  console.log(`[SCAN:UI] Tất cả ${files.length} file giao diện frontend đều sạch từ tiếng Anh trái quy định!`);
  process.exit(0);
}
