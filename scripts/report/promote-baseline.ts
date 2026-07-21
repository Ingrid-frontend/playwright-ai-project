#!/usr/bin/env tsx
/**
 * 将指定 run 的截图提升为 Golden 基线。
 * 用法:
 *   npm run promote-baseline -- --script 260612/xxx --run 2026-05-21T10-46-34-813Z
 *   npm run promote-baseline -- --script 260612/xxx --latest
 */
import fs from 'fs';
import path from 'path';
import { browserToRunSegment, promoteRunToGolden, revertGolden } from './baseline-manager.js';

function findLatestRunTimestamp(scriptKey: string, browser: string): string | null {
  const runDir = path.join(process.cwd(), 'screenshots', scriptKey, browserToRunSegment(browser));
  if (!fs.existsSync(runDir)) return null;
  const runs = fs
    .readdirSync(runDir)
    .filter((f) => fs.statSync(path.join(runDir, f)).isDirectory())
    .sort((a, b) => fs.statSync(path.join(runDir, b)).mtimeMs - fs.statSync(path.join(runDir, a)).mtimeMs);
  return runs[0] || null;
}

function printHelp(): void {
  console.log(`用法: npm run promote-baseline -- [选项]

选项:
  --script=<iteration/script>   脚本键
  --run=<timestamp>             运行目录名
  --latest                      自动取最新 run（可配合 --browser）
  --browser=chrome|webkit       浏览器（默认 chrome）
  --revert                      撤销 Golden
  -h, --help
`);
}

function parseArgs(argv: string[]): {
  script?: string;
  run?: string;
  browser: string;
  revert: boolean;
  latest: boolean;
} {
  let script: string | undefined;
  let run: string | undefined;
  let browser = 'chrome';
  let revert = false;
  let latest = false;

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--revert') {
      revert = true;
      continue;
    }
    if (arg === '--latest') {
      latest = true;
      continue;
    }
    if (arg.startsWith('--script=')) {
      script = arg.slice('--script='.length).trim();
      continue;
    }
    if (arg.startsWith('--run=')) {
      run = arg.slice('--run='.length).trim();
      continue;
    }
    if (arg.startsWith('--browser=')) {
      browser = arg.slice('--browser='.length).trim().toLowerCase();
      continue;
    }
  }

  return { script, run, browser, revert, latest };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.script) {
    console.error('❌ 需要 --script=<iteration/script>');
    printHelp();
    process.exit(1);
  }

  if (opts.revert) {
    const n = revertGolden(opts.script, opts.browser);
    console.log(`✅ 已撤销 Golden：删除 ${n} 个基线 PNG（${opts.script} / ${opts.browser}）`);
    return;
  }

  let runTs = opts.run;
  if (opts.latest || !runTs) {
    runTs = findLatestRunTimestamp(opts.script, opts.browser) || undefined;
    if (!runTs) {
      console.error(`❌ 未找到 ${opts.script} / ${opts.browser} 的最新 run`);
      process.exit(1);
    }
    console.log(`ℹ️  --latest 使用 run: ${runTs}`);
  }

  const { copied, goldenDir } = promoteRunToGolden({
    scriptKey: opts.script,
    sourceRunTimestamp: runTs,
    browser: opts.browser,
  });

  console.log(`✅ 已提升 Golden：${copied} 张截图`);
  console.log(`   目录: ${goldenDir}`);
}

main();
