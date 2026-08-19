#!/usr/bin/env tsx
/**
 * 将指定 run 的截图提升为 Golden 基线。
 * 用法:
 *   npm run promote-baseline -- --script 260612/xxx --run 2026-05-21T10-46-34-813Z
 *   npm run promote-baseline -- --script 260612/xxx --latest
 *   npm run promote-baseline -- --script 260612/xxx --latest --step=step-2-approval-list__normal.png
 */
import { findLatestRunTimestamp, promoteRunToGolden, promoteStepsToGolden, revertGolden } from './baseline-manager.js';

function printHelp(): void {
  console.log(`用法: npm run promote-baseline -- [选项]

选项:
  --script=<iteration/script>   脚本键
  --run=<timestamp>             运行目录名
  --latest                      自动取最新 run（可配合 --browser）
  --browser=chrome|webkit       浏览器（默认 chrome）
  --step=<file.png>             只提升指定 PNG（可重复）；不传则整 run
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
  steps: string[];
} {
  let script: string | undefined;
  let run: string | undefined;
  let browser = 'chrome';
  let revert = false;
  let latest = false;
  const steps: string[] = [];

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
    if (arg.startsWith('--step=')) {
      const step = arg.slice('--step='.length).trim();
      if (step) steps.push(step);
      continue;
    }
  }

  return { script, run, browser, revert, latest, steps };
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

  if (opts.steps.length) {
    const { copied, goldenDir } = promoteStepsToGolden({
      scriptKey: opts.script,
      sourceRunTimestamp: runTs,
      browser: opts.browser,
      stepFileNames: opts.steps,
    });
    console.log(`✅ 已提升 Golden：${copied} 张截图（按 step）`);
    console.log(`   目录: ${goldenDir}`);
    return;
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
