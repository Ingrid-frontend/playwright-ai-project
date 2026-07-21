import fs from 'fs';

const raw = fs.readFileSync('tests/raw-recordings/original/20260512/合同-新建表单与提交_2026-05-12.spec.ts', 'utf-8');

// stripBom
let out = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

// stripLeadingRecordingTitle
const lines = out.split('\n');
let i = 0;
while (i < lines.length && /^\s*$/.test(lines[i]!)) i++;
if (i < lines.length) {
  const first = lines[i]!.trim();
  const tail = lines.slice(i + 1).join('\n');
  const nextHasImport = /^\s*import\s+/m.test(tail);
  const looksLikeTitle =
    first.length > 0 &&
    first.length <= 120 &&
    !/[`'"()[\]{};]/.test(first) &&
    /^[\w\s\u4e00-\u9fa5\-—·|]+$/.test(first) &&
    !/^import\s/.test(first) &&
    !/^\/\//.test(first);
  if (looksLikeTitle && nextHasImport) {
    out = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').replace(/^\uFEFF?/, '');
  }
}

// ensurePlaywrightImport
if (!/from\s+['"]@playwright\/test['"]/.test(out)) {
  out = `import { test, expect } from '@playwright/test';\n\n${out.trimStart()}`;
}

// ensureTestWrapper
if (!/\btest\s*\(\s*['"]/.test(out)) {
  const lines2 = out.split('\n');
  let lastImportIdx = -1;
  for (let j = 0; j < lines2.length; j++) {
    if (/^\s*import\s/.test(lines2[j]!)) lastImportIdx = j;
  }
  const body = (lastImportIdx >= 0 ? lines2.slice(lastImportIdx + 1).join('\n') : out).trim();
  if (/await\s+page\./.test(body)) {
    const head =
      lastImportIdx >= 0
        ? lines2.slice(0, lastImportIdx + 1).join('\n')
        : `import { test, expect } from '@playwright/test';`;
    if (!/^\s*test\s*\(/m.test(body)) {
      const indented = body.split('\n').map((l) => (l.length ? `  ${l}` : l)).join('\n');
      out = `${head}\n\ntest('test', async ({ page }) => {\n${indented}\n});\n`;
    }
  }
}

console.log('=== OUTPUT ===');
out.split('\n').slice(0, 8).forEach((l, idx) => console.log(idx + ':', JSON.stringify(l)));
