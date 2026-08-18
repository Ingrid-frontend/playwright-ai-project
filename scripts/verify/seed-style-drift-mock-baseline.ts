#!/usr/bin/env tsx
/**
 * 跑 mock intent 并 promote 为 Golden baseline
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { promoteRunToGolden } from '../report/baseline-manager.js';

const repoRoot = process.cwd();
const intent = 'tests/definitions/style-drift-mock.yaml';
const scriptKey = 'mock/style-drift-demo';

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { cwd: repoRoot, stdio: 'inherit', shell: false });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

async function main(): Promise<void> {
  run('npx', ['tsx', 'scripts/ai/run-intent.ts', `--intent=${intent}`, '--engine=pw', '--no-heal']);

  const shotsRoot = path.join(repoRoot, 'screenshots', 'stage', scriptKey, 'run-chromium-optimized');
  if (!fs.existsSync(shotsRoot)) {
    console.error(`❌ 未找到截图目录: ${shotsRoot}`);
    process.exit(1);
  }
  const runs = fs.readdirSync(shotsRoot).filter((n) => fs.statSync(path.join(shotsRoot, n)).isDirectory()).sort();
  const latest = runs[runs.length - 1];
  if (!latest) {
    console.error('❌ 无 run timestamp');
    process.exit(1);
  }

  const { copied, goldenDir } = promoteRunToGolden({
    scriptKey,
    sourceRunTimestamp: latest,
    browser: 'chrome',
    screenshotsRoot: 'screenshots/stage',
  });
  console.log(`✅ Golden 已更新: ${goldenDir} (${copied} 文件)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
