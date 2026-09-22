#!/usr/bin/env tsx
/**
 * smoke 并行运行器：把原来 14 条 `&&` 串起来的 verify 脚本改成有界并发。
 *
 * 为什么能并行：每个 verify 脚本要么只往自己的 `fs.mkdtempSync(os.tmpdir())`
 * 沙箱写文件，要么是纯读断言，没有一个往共享的仓库 `results/` 目录落盘，
 * 所以并发跑不会互相覆盖。
 *
 * 为什么原来串行慢：每条都要独立冷启动一次 tsx / node（≈0.5–1s），14 条累加
 * 主要耗在进程启动而非用例本身。并发后墙钟约等于最慢的那几条之和。
 *
 * 语义变化：`&&` 是「首个失败即中断」；这里是「全部跑完再汇总」，一次性暴露
 * 所有失败项——对冒烟门禁反而更有用。任一失败则整体退出码非 0。
 *
 * 用法：
 *   npm run smoke
 *   SMOKE_CONCURRENCY=2 npm run smoke   # 调低并发（CI 内存紧时）
 *   SMOKE_SERIAL=1 npm run smoke        # 退回严格串行，便于定位串扰
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

/** 一条待跑命令：可读名字 + 直接 spawn 的 argv（不过 shell，避免 PATH 依赖） */
type SmokeTask = { name: string; argv: string[] };

const runWithTsx = (file: string): string[] => [process.execPath, tsxCli, file];
const runWithNode = (file: string): string[] => [process.execPath, file];

const TASKS: SmokeTask[] = [
  { name: 'smoke-report-modules', argv: runWithTsx('scripts/verify/smoke-report-modules.ts') },
  { name: 'smoke-ws-dispatch', argv: runWithNode('scripts/verify/smoke-ws-dispatch.cjs') },
  { name: 'verify-ego-selector-probe', argv: runWithNode('scripts/verify/verify-ego-selector-probe.cjs') },
  { name: 'verify-ego-snapshot', argv: runWithNode('scripts/verify/verify-ego-snapshot.cjs') },
  { name: 'verify-baseline-quality', argv: runWithNode('scripts/verify/verify-baseline-quality.cjs') },
  { name: 'verify-intent-assert', argv: runWithNode('scripts/verify/verify-intent-assert.cjs') },
  { name: 'verify-failure-bundle', argv: runWithNode('scripts/verify/verify-failure-bundle.cjs') },
  { name: 'verify-heal-suggest', argv: runWithNode('scripts/verify/verify-heal-suggest.cjs') },
  { name: 'verify-intent-trust', argv: runWithNode('scripts/verify/verify-intent-trust.cjs') },
  { name: 'verify-intent-boundary-ui', argv: runWithNode('scripts/verify/verify-intent-boundary-ui.cjs') },
  { name: 'verify-replay-delete', argv: runWithNode('scripts/verify/verify-replay-delete.cjs') },
  { name: 'verify-intent-delete', argv: runWithNode('scripts/verify/verify-intent-delete.cjs') },
  { name: 'verify-request-flow-stable', argv: runWithNode('scripts/verify/verify-request-flow-stable.cjs') },
  { name: 'verify-customer-report-html (optional offline artifact)', argv: [...runWithTsx('scripts/verify/verify-customer-report-html.ts'), '--allow-missing'] },
  { name: 'smoke-customer-report-upgrade', argv: runWithTsx('scripts/verify/smoke-customer-report-upgrade.ts') },
  { name: 'verify-diff-cache', argv: runWithTsx('scripts/verify/verify-diff-cache.ts') },
  { name: 'verify-bitable-boundary', argv: runWithTsx('scripts/verify/verify-bitable-boundary.ts') },
  { name: 'verify-delivery-recovery', argv: runWithTsx('scripts/verify/verify-delivery-recovery.ts') },
  { name: 'verify-studio-lifecycle', argv: runWithNode('scripts/verify/verify-studio-lifecycle.cjs') },
  { name: 'verify-list-wait-order', argv: runWithTsx('scripts/verify/verify-list-wait-order.ts') },
  { name: 'verify-llm-budget', argv: runWithTsx('scripts/verify/verify-llm-budget.ts') },
  { name: 'verify-native-script-boundary', argv: runWithTsx('scripts/verify/verify-native-script-boundary.ts') },
  { name: 'verify-approval-row-scope', argv: runWithTsx('scripts/verify/verify-approval-row-scope.ts') },
  { name: 'verify-golden-batch-skipped', argv: runWithTsx('scripts/verify/verify-golden-batch-skipped.ts') },
];

function resolveConcurrency(): number {
  if (process.env.SMOKE_SERIAL === '1') return 1;
  const raw = Number.parseInt(process.env.SMOKE_CONCURRENCY ?? '', 10);
  const cpu = Math.max(2, Math.min(6, os.cpus().length));
  const n = Number.isFinite(raw) && raw > 0 ? raw : cpu;
  return Math.max(1, Math.min(n, TASKS.length));
}

type RunResult = { name: string; code: number; out: string; ms: number };

function runTask(task: SmokeTask): Promise<RunResult> {
  return new Promise((resolve) => {
    const [bin, ...args] = task.argv;
    const started = Date.now();
    let out = '';
    const child = spawn(bin, args, { cwd: repoRoot, env: process.env });
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    child.on('error', (err) => {
      out += `\n${String(err)}`;
      resolve({ name: task.name, code: 1, out, ms: Date.now() - started });
    });
    child.on('close', (code) => {
      resolve({ name: task.name, code: code ?? 1, out, ms: Date.now() - started });
    });
  });
}

/** 有界并发队列：并发跑 limit 个，结果按完成顺序收集 */
async function runPool(tasks: SmokeTask[], limit: number): Promise<RunResult[]> {
  const results: RunResult[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      const r = await runTask(tasks[i]);
      results.push(r);
      const mark = r.code === 0 ? '✓' : '✗';
      process.stdout.write(`  ${mark} ${r.name} (${(r.ms / 1000).toFixed(1)}s)\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

async function main(): Promise<void> {
  if (!fs.existsSync(tsxCli)) {
    process.stderr.write(`找不到 tsx CLI：${tsxCli}\n请先 npm install。\n`);
    process.exit(1);
  }

  const concurrency = resolveConcurrency();
  process.stdout.write(
    `[smoke] ${TASKS.length} 项 · 并发 ${concurrency}${concurrency === 1 ? '（串行）' : ''} · 开始\n`,
  );
  const started = Date.now();
  const results = await runPool(TASKS, concurrency);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const failed = results.filter((r) => r.code !== 0);
  if (failed.length) {
    process.stdout.write('\n===== 失败项输出 =====\n');
    for (const r of failed.sort((a, b) => a.name.localeCompare(b.name))) {
      process.stdout.write(`\n----- ${r.name} (exit ${r.code}) -----\n${r.out}\n`);
    }
  }

  process.stdout.write(
    `\n[smoke] ${results.length - failed.length}/${results.length} 通过 · ${elapsed}s` +
      (failed.length ? ` · 失败：${failed.map((r) => r.name).join(', ')}` : '') +
      '\n',
  );
  process.exit(failed.length ? 1 : 0);
}

void main();
