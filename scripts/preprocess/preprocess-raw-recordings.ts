/**
 * 将 tests/raw-recordings/original/** 下的 codegen 备份转为合法 Playwright spec，
 * 输出到 tests/raw-recordings/<batch>/processed/，供 optimize-raw-recordings 消费。
 *
 * 用法:
 *   npx tsx scripts/preprocess/preprocess-raw-recordings.ts
 *   npx tsx scripts/preprocess/preprocess-raw-recordings.ts tests/raw-recordings/original/20260512
 *   npx tsx scripts/preprocess/preprocess-raw-recordings.ts tests/raw-recordings/original/20260512/报销单-新建与浏览_2026-05-12.spec.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isKnownEnv } = require('../../src/utils/test-env-path.cjs') as {
  isKnownEnv: (envId: string, repoRoot?: string) => boolean;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

/** 录制工具常见：首行独立场景名（如「报销单」），下一行才是 import */
export function stripLeadingRecordingTitle(content: string): string {
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

/** 无 test() 但有 await page. 时包一层，便于优化器解析 */
export function ensureTestWrapper(content: string): string {
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

/** 保证存在 @playwright/test 的 test/expect（未强制格式化其它 import） */
export function ensurePlaywrightImport(content: string): string {
  if (/from\s+['"]@playwright\/test['"]/.test(content)) return content;
  const trimmed = content.trimStart();
  return `import { test, expect } from '@playwright/test';\n\n${trimmed}`;
}

/** 输出路径：original/<env>/<batch>/file 或 original/<batch>/file → 对应 processed */
export function resolveProcessedOutputPath(inputFile: string): string {
  const normalized = path.resolve(inputFile).replace(/\\/g, '/');
  const rel = path.relative(projectRoot, normalized).replace(/\\/g, '/');
  const withEnv = rel.match(/^tests\/raw-recordings\/original\/([^/]+)\/([^/]+)\/(.+\.spec\.ts)$/);
  if (withEnv && isKnownEnv(withEnv[1], projectRoot)) {
    return path.join(projectRoot, 'tests', 'raw-recordings', withEnv[1], withEnv[2], 'processed', withEnv[3]);
  }
  const m = rel.match(/^tests\/raw-recordings\/original\/([^/]+)\/(.+\.spec\.ts)$/);
  if (m) {
    return path.join(projectRoot, 'tests', 'raw-recordings', m[1], 'processed', m[2]);
  }
  const dir = path.dirname(inputFile);
  const base = path.basename(inputFile);
  return path.join(dir, 'processed', base);
}

function preprocessContent(raw: string): string {
  let out = stripBom(raw);
  out = stripLeadingRecordingTitle(out);
  out = ensurePlaywrightImport(out);
  out = ensureTestWrapper(out);
  return out.endsWith('\n') ? out : `${out}\n`;
}

function collectSpecFiles(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'processed') continue;
      out.push(...collectSpecFiles(full));
    } else if (e.isFile() && e.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

function processFile(inputPath: string): { input: string; output: string } {
  const raw = fs.readFileSync(inputPath, 'utf-8');
  const processed = preprocessContent(raw);
  const outputPath = resolveProcessedOutputPath(inputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, processed, 'utf-8');
  return { input: inputPath, output: outputPath };
}

const defaultTarget = path.join(projectRoot, 'tests/raw-recordings/original');

function main(): void {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const target = argv[0] ? path.resolve(projectRoot, argv[0]) : defaultTarget;

  if (!fs.existsSync(target)) {
    console.error(`❌ 路径不存在: ${target}`);
    process.exit(1);
  }

  const stat = fs.statSync(target);
  const files: string[] = stat.isFile()
    ? target.endsWith('.spec.ts')
      ? [target]
      : (console.error('❌ 仅支持 .spec.ts'), process.exit(1), [])
    : collectSpecFiles(target);

  if (files.length === 0) {
    console.log('⚠️  未找到 .spec.ts');
    return;
  }

  console.log(`📁 预处理 ${files.length} 个文件 → tests/raw-recordings/<batch>/processed/\n`);
  for (const f of files) {
    const { output } = processFile(f);
    console.log(`✅ ${path.relative(projectRoot, f)} → ${path.relative(projectRoot, output)}`);
  }
}

/** 通过 npm run / npx tsx 调用时，脚本路径可能在 argv 任意一项 */
function isRunAsCli(): boolean {
  const scriptPath = path.resolve(fileURLToPath(import.meta.url));
  return process.argv.some((arg) => {
    if (!arg.endsWith('.ts')) return false;
    try {
      return path.resolve(arg) === scriptPath;
    } catch {
      return false;
    }
  });
}

if (isRunAsCli()) main();
