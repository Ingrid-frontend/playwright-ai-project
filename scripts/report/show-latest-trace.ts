#!/usr/bin/env tsx
/** 打开 test-results 下最新的 trace.zip */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function findLatestTrace(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  let latest: { path: string; mtime: number } | null = null;

  function walk(d: string) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name === 'trace.zip') {
        const mtime = fs.statSync(full).mtimeMs;
        if (!latest || mtime > latest.mtime) latest = { path: full, mtime };
      }
    }
  }

  walk(dir);
  return latest?.path || null;
}

const trace = findLatestTrace(path.join(process.cwd(), 'test-results'));
if (!trace) {
  console.error('❌ 未找到 trace.zip。请先运行测试（CI 下失败用例会 retain trace）');
  process.exit(1);
}

console.log(`🔍 打开 trace: ${trace}`);
console.log('💡 也可拖入 https://trace.playwright.dev （注意敏感数据）');
execSync(`npx playwright show-trace "${trace}"`, { stdio: 'inherit' });
