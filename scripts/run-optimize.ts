/**
 * 统一优化入口：根据路径类型转发到对应实现。
 * - 无参数：等同 `optimize-raw-recordings`（默认处理 tests/raw-recordings）
 * - 目录：递归批量 → optimize-raw-recordings.ts
 * - 单文件：→ optimize-recorded-test.ts（与历史 `npm run optimize -- <file>` 行为一致）
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = process.cwd();

function runTsx(scriptRel: string, forward: string[]): void {
  const r = spawnSync('npx', ['tsx', scriptRel, ...forward], {
    stdio: 'inherit',
    cwd: root,
    shell: false,
  });
  process.exit(r.status === null ? 1 : r.status);
}

/** tsx 会把入口脚本留在 argv 里，需跳过 */
function userArgv(): string[] {
  const raw = process.argv.slice(2).filter((a) => a !== '--');
  if (raw[0]?.includes('run-optimize.ts')) {
    return raw.slice(1);
  }
  return raw;
}

const userArgs = userArgv();
const target = userArgs[0];

if (!target) {
  runTsx('scripts/optimize-raw-recordings.ts', []);
}

const resolved = path.resolve(root, target);
if (!fs.existsSync(resolved)) {
  console.error(`❌ 路径不存在: ${resolved}`);
  process.exit(1);
}

const stat = fs.statSync(resolved);
if (stat.isDirectory()) {
  runTsx('scripts/optimize-raw-recordings.ts', [resolved]);
}

runTsx('scripts/optimize-recorded-test.ts', [resolved]);
