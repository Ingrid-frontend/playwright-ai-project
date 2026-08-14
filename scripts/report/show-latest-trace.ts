#!/usr/bin/env tsx
/** 打开 test-results 下最新的 trace.zip */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function findLatestTrace(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const found: { path: string; mtime: number }[] = [];

  function walk(d: string) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name === 'trace.zip') {
        found.push({ path: full, mtime: fs.statSync(full).mtimeMs });
      }
    }
  }

  walk(dir);
  if (found.length === 0) return null;
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0].path;
}

const trace = findLatestTrace(path.join(process.cwd(), 'test-results'));
if (!trace) {
  console.error('❌ 未找到 trace.zip。请先运行测试（CI 下失败用例会 retain trace）');
  process.exit(1);
}

console.log(`🔍 打开 trace: ${trace}`);
console.log('💡 也可拖入 https://trace.playwright.dev （注意敏感数据）');
execSync(`npx playwright show-trace "${trace}"`, { stdio: 'inherit' });
