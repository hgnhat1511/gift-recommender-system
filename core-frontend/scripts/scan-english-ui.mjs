import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '..');
const srcDir = path.resolve(frontendDir, 'src');
const indexHtmlPath = path.resolve(frontendDir, 'index.html');

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
  'order history',
  'save',
  'search products'
];

// Các từ mượn thương hiệu / kỹ thuật được phép (whitelist có giải trình)
// Đã loại bỏ ADMIN và CUSTOMER (chứng minh không xuất hiện thô trên UI)
// Đã loại bỏ "Gift Finder" (liệt kê danh sách xuất hiện riêng để người dùng phê duyệt)
const whitelistPatterns = [
  /\bGiftly\b/gi,
  /\bEmail\b/gi,
  /\bVNPAY\b/gi,
  /\bGHN\b/gi,
  /\bCOD\b/gi,
  /\b(ID|URL|HTTPS|JSON|API|VND|CSS|JWT)\b/g,
  /\b(Vite|React|Unsplash|Lucide|UTF-8)\b/gi
];

const excludedFiles = [
  { path: 'src/setupTests.js', reason: 'File thiết lập môi trường test (test harness setup)' },
  { path: 'src/lib/labels.test.js', reason: 'Unit test node:test kiểm thử nhãn từ điển' },
  { path: 'src/context/CartBadge.test.js', reason: 'Unit test mô phỏng kiểm thử context giỏ hàng' },
  { path: 'src/lib/encoding.test.js', reason: 'Unit test node:test quét mã hóa UTF-8 toàn dự án' },
  { path: 'src/data/catalogTags.snapshot.json', reason: 'File snapshot dữ liệu JSON kỹ thuật trích xuất từ seed' },
  { path: 'src/lib/enums.snapshot.json', reason: 'File snapshot dữ liệu JSON schema enums database' }
];

function getSourceFiles(dir, exts = ['.jsx', '.js']) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (!['node_modules', '.test', 'assets'].includes(file)) {
        results = results.concat(getSourceFiles(fullPath, exts));
      }
    } else {
      if (exts.some(ext => file.endsWith(ext))) {
        if (!file.includes('.test.') && !file.includes('.spec.') && file !== 'setupTests.js') {
          results.push(fullPath);
        }
      }
    }
  }
  return results;
}

const extraTarget = process.argv[2] ? path.resolve(frontendDir, process.argv[2]) : null;

const scannedFiles = [
  indexHtmlPath,
  ...getSourceFiles(srcDir),
  ...(extraTarget && fs.existsSync(extraTarget) ? (fs.statSync(extraTarget).isDirectory() ? getSourceFiles(extraTarget) : [extraTarget]) : [])
].filter(fs.existsSync);

const findings = [];

for (const filePath of scannedFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const relPath = path.relative(frontendDir, filePath).replace(/\\/g, '/');

  // Kiểm tra index.html riêng
  if (relPath === 'index.html') {
    lines.forEach((line, idx) => {
      // Quét <title>...</title>
      const titleMatch = line.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) {
        checkText(titleMatch[1], relPath, idx + 1, line.trim());
      }
      // Quét lang attribute
      const langMatch = line.match(/<html[^>]*lang=["']([^"']+)["']/i);
      if (langMatch && langMatch[1] !== 'vi') {
        findings.push({
          file: relPath,
          line: idx + 1,
          word: `lang="${langMatch[1]}" (yêu cầu lang="vi")`,
          rawText: langMatch[0],
          fullLine: line.trim()
        });
      }
    });
    continue;
  }

  lines.forEach((line, lineIdx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('import ')) {
      return;
    }

    const candidateMatches = [];

    // 1. Text trong JSX: >...< (bao gồm cả option, th, button, label, p, span, h1-h6, ...)
    if (filePath.endsWith('.jsx')) {
      const jsxTextMatches = line.matchAll(/>([^<]+)</g);
      for (const m of jsxTextMatches) {
        const textWithoutExpr = m[1].replace(/\{[^}]*\}/g, ' ').trim();
        if (textWithoutExpr && !textWithoutExpr.includes('=>') && !textWithoutExpr.includes('}')) {
          candidateMatches.push(textWithoutExpr);
        }
      }

      // 2. String literals bên trong biểu thức JSX ternary/&&: {cond ? 'Text 1' : 'Text 2'} hoặc {cond && 'Text'}
      const exprMatches = line.matchAll(/\{([^}]+)\}/g);
      for (const em of exprMatches) {
        const expr = em[1];
        if (expr.includes('?') || expr.includes('&&') || expr.includes('||')) {
          const strLiterals = expr.matchAll(/['"`]([^'"`]{3,})['"`]/g);
          for (const sm of strLiterals) {
            const val = sm[1].trim();
            // Bỏ qua class names, style keys, URL, endpoint
            if (!val.startsWith('/') && !val.startsWith('http') && !val.includes('-') && !val.includes('_')) {
              candidateMatches.push(val);
            }
          }
        }
      }
    }

    // 3. Thuộc tính hiển thị UI: title, description, placeholder, aria-label, alt
    const attrMatches = line.matchAll(/(?:title|description|placeholder|aria-label|alt)\s*=\s*["']([^"']+)["']/g);
    for (const m of attrMatches) {
      if (m[1].trim()) candidateMatches.push(m[1].trim());
    }

    // 4. Thông báo và lỗi hiển thị cho người dùng: setError, setMessage, setNotice, setFail, toast, alert, confirm, prompt, getApiError
    const msgMatches = line.matchAll(/(?:setMessage|setError|setNotice|setFail|toast|alert|confirm|prompt)\s*\(\s*["'`]([^"'`]+)["'`]/g);
    for (const m of msgMatches) {
      if (m[1].trim()) candidateMatches.push(m[1].trim());
    }
    const apiErrorMatches = line.matchAll(/getApiError\s*\([^,]+,\s*["'`]([^"'`]+)["'`]\)/g);
    for (const m of apiErrorMatches) {
      if (m[1].trim()) candidateMatches.push(m[1].trim());
    }

    for (const rawText of candidateMatches) {
      checkText(rawText, relPath, lineIdx + 1, trimmed);
    }
  });
}

function checkText(rawText, file, line, fullLine) {
  let cleaned = rawText;
  for (const wl of whitelistPatterns) {
    cleaned = cleaned.replace(wl, '');
  }

  for (const word of forbiddenWords) {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(cleaned)) {
      findings.push({
        file,
        line,
        word,
        rawText,
        fullLine
      });
    }
  }
}

// In báo cáo danh sách file
console.log(`=== DANH SÁCH FILE ĐÃ QUÉT (${scannedFiles.length} file) ===`);
scannedFiles.forEach((f, idx) => {
  const rel = path.relative(frontendDir, f).replace(/\\/g, '/');
  console.log(`${idx + 1}. ${rel}`);
});

console.log(`\n=== DANH SÁCH FILE BỊ LOẠI TRỪ VÀ LÝ DO (${excludedFiles.length} file) ===`);
excludedFiles.forEach((ef) => {
  console.log(`- ${ef.path}: ${ef.reason}`);
});

console.log('');

if (findings.length > 0) {
  console.log(`[SCAN:UI:FAIL] Phát hiện ${findings.length} vị trí có từ tiếng Anh trên UI:`);
  findings.forEach(f => {
    console.log(`${f.file}:${f.line} [từ: "${f.word}"] nội dung: "${f.rawText}"`);
  });
  process.exit(1);
} else {
  console.log(`[SCAN:UI:PASS] Tất cả ${scannedFiles.length} file đã quét đều đạt chuẩn tiếng Việt sạch, không chứa từ tiếng Anh trái quy định.`);
  process.exit(0);
}
