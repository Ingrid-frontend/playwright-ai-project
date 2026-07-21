import fs from 'fs';

function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

function stripLeadingRecordingTitle(content: string): string {
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length && /^\s*$/.test(lines[i]!)) i++;
  if (i >= lines.length) return content;

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
    return [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').replace(/^\uFEFF?/, '');
  }
  return content;
}

function ensurePlaywrightImport(content: string): string {
  if (/from\s+['"]@playwright\/test['"]/.test(content)) return content;
  const trimmed = content.trimStart();
  return `import { test, expect } from '@playwright/test';\n\n${trimmed}`;
}

function ensureTestWrapper(content: string): string {
  if (/\btest\s*\(\s*['"]/.test(content)) return content;

  const lines = content.split('\n');
  let lastImportIdx = -1;
  for (let j = 0; j < lines.length; j++) {
    if (/^\s*import\s/.test(lines[j]!)) lastImportIdx = j;
  }

  const body = (lastImportIdx >= 0 ? lines.slice(lastImportIdx + 1).join('\n') : content).trim();
  if (!/await\s+page\./.test(body)) return content;

  const head =
    lastImportIdx >= 0
      ? lines.slice(0, lastImportIdx + 1).join('\n')
      : `import { test, expect } from '@playwright/test';`;

  if (/^\s*test\s*\(/m.test(body)) return content;

  const indented = body
    .split('\n')
    .map((l) => (l.length ? `  ${l}` : l))
    .join('\n');
  return `${head}\n\ntest('test', async ({ page }) => {\n${indented}\n});\n`;
}

function preprocessContent(raw: string): string {
  let out = stripBom(raw);
  out = stripLeadingRecordingTitle(out);
  out = ensurePlaywrightImport(out);
  out = ensureTestWrapper(out);
  return out.endsWith('\n') ? out : `${out}\n`;
}

const raw = fs.readFileSync('tests/raw-recordings/original/20260512/合同-新建表单与提交_2026-05-12.spec.ts', 'utf-8');
const processed = preprocessContent(raw);

console.log('=== RAW (first 8 lines) ===');
raw.split('\n').slice(0, 8).forEach((l, i) => console.log(i + ':', JSON.stringify(l)));

console.log('\n=== PROCESSED (first 8 lines) ===');
processed.split('\n').slice(0, 8).forEach((l, i) => console.log(i + ':', JSON.stringify(l)));

console.log('\n=== RAW line count ===', raw.split('\n').length);
console.log('=== PROCESSED line count ===', processed.split('\n').length);
