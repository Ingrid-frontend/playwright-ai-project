#!/usr/bin/env tsx
/**
 * 将指定 run 的截图提升为 Golden 基线。
 * 用法: npm run promote-baseline -- --script 260612/xxx --run 2026-05-21T10-46-34-813Z [--browser chrome]
 */
import fs from 'fs';
import path from 'path';
import { promoteRunToGolden, revertGolden } from './baseline-manager.js';

function printHelp(): void {
  console.log(`用法: npm run promote-baseline -- [选项]

选项:
  --script=<iteration/script>   脚本键（screenshots 下相对路径）
  --run=<timestamp>               运行目录名（run-chromium-optimized/<timestamp>）
  --browser=chrome|webkit         浏览器（默认 chrome）
  --revert                        撤销该脚本的 Golden（可配合 --browser）
  -h, --help
`);
}

function parseArgs(argv: string[]): {
  script?: string;
  run?: string;
  browser: string;
  revert: boolean;
} {
  let script: string | undefined;
  let run: string | undefined;
  let browser = 'chrome';
  let revert = false;

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--revert') {
      revert = true;
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

  return { script, run, browser, revert };
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

  if (!opts.run) {
    console.error('❌ 需要 --run=<timestamp>（或 --revert）');
    process.exit(1);
  }

  const { copied, goldenDir } = promoteRunToGolden({
    scriptKey: opts.script,
    sourceRunTimestamp: opts.run,
    browser: opts.browser,
  });

  console.log(`✅ 已提升 Golden：${copied} 张截图`);
  console.log(`   目录: ${goldenDir}`);
  console.log(`   来源: screenshots/${opts.script}/.../${opts.run}`);
}

main();
