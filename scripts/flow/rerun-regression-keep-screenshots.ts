#!/usr/bin/env tsx
/**
 * 保留现有 screenshots，再跑测试 → compare --gate → report:bundle
 *
 * 用法:
 *   npm run rerun-regression-keep
 *   npm run rerun-regression-keep -- --script-key=stage/260612/我的审批_2026-06-09_16-48-19
 *   npm run rerun-regression-keep -- --spec=tests/optimized/stage/260612/xxx.optimized.spec.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runDirect } from '../jobs/job-runner.js';
import { formatRunId } from '../jobs/job-utils.js';
import { runCommand } from './flow-shared.js';

function ensureBrowsersPath(): void {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;
  const mac = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  if (fs.existsSync(mac)) process.env.PLAYWRIGHT_BROWSERS_PATH = mac;
}

function scriptKeyToSpecRel(scriptKey: string): string {
  return `tests/optimized/${scriptKey.replace(/^\/+/, '')}.optimized.spec.ts`;
}

function discoverScriptKeys(screenshotsDir = 'screenshots'): string[] {
  const keys = new Set<string>();
  if (!fs.existsSync(screenshotsDir)) return [];

  const walk = (dir: string, prefix: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      if (!ent.isDirectory()) continue;
      if (/^run-(chromium|webkit|firefox|safari|edge)-/i.test(ent.name)) {
        if (prefix) keys.add(prefix.replace(/\\/g, '/'));
        continue;
      }
      walk(path.join(dir, ent.name), prefix ? `${prefix}/${ent.name}` : ent.name);
    }
  };

  walk(screenshotsDir, '');
  return [...keys].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function parseArgs(argv: string[]): { scriptKeys: string[]; specRels: string[]; playwrightEnv: string } {
  const scriptKeys: string[] = [];
  const specRels: string[] = [];
  let playwrightEnv = process.env.PLAYWRIGHT_ENV?.trim() || 'stage';

  for (const arg of argv) {
    if (arg.startsWith('--script-key=')) {
      const v = arg.slice('--script-key='.length).trim();
      if (v) scriptKeys.push(v);
    } else if (arg.startsWith('--spec=')) {
      const v = arg.slice('--spec='.length).trim();
      if (v) specRels.push(v.replace(/\\/g, '/'));
    } else if (arg.startsWith('--env=')) {
      playwrightEnv = arg.slice('--env='.length).trim() || playwrightEnv;
    }
  }

  return { scriptKeys, specRels, playwrightEnv };
}

async function main(): Promise<void> {
  ensureBrowsersPath();
  const { scriptKeys, specRels, playwrightEnv } = parseArgs(process.argv.slice(2));
  process.env.PLAYWRIGHT_ENV = playwrightEnv;

  const specOverrides: string[] = [...specRels];
  for (const k of scriptKeys) {
    const rel = scriptKeyToSpecRel(k);
    if (!specOverrides.includes(rel)) specOverrides.push(rel);
  }
  if (specOverrides.length === 0) {
    for (const k of discoverScriptKeys()) {
      const rel = scriptKeyToSpecRel(k);
      if (!specOverrides.includes(rel)) specOverrides.push(rel);
    }
  }

  const existing = specOverrides.filter((rel) => fs.existsSync(path.join(process.cwd(), rel)));
  if (existing.length === 0) {
    console.error('❌ 未找到可执行用例（请传 --script-key / --spec，或先有 screenshots）');
    process.exit(1);
  }

  console.log(`\n🔄 保留截图追加 run（PLAYWRIGHT_ENV=${playwrightEnv}）`);
  console.log(`   用例: ${existing.join(', ')}\n`);

  const result = await runDirect(
    {
      projects: ['optimized', 'optimized-webkit'],
      optimizedDir: 'tests/optimized',
      specs: 'all',
      specOverrides: existing,
      stopOnTestFailure: true,
      stopOnCompareGate: true,
      runCompareAfterAbort: false,
      verbose: false,
      playwrightEnv,
      steps: {
        login: true,
        compare: true,
        compareGate: true,
        recordLastGreen: true,
        feishuNotify: false,
        createFeishuDoc: false,
        writeFeishuBitable: false,
        refreshLogin: false,
      },
      feishuMode: 'none',
      notifyOn: [],
    },
    {
      trigger: 'cli',
      runId: formatRunId(),
      persistState: false,
    },
  );

  const bundleOk = runCommand('npm run report:bundle', '打包 public-reports');
  if (!bundleOk || result.exitCode !== 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error('❌', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
