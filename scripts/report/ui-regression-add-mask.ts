#!/usr/bin/env tsx
/**
 * 向 config/ui-regression.json 追加 ignoreRegions
 *
 * npm run ui-regression:add-mask -- --script=260612/xxx --region=0,0,100,50
 */
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'config/ui-regression.json');

function printHelp(): void {
  console.log(`用法: tsx scripts/report/ui-regression-add-mask.ts [选项]

选项:
  --script=<iteration/script>   脚本键（与 screenshots 目录一致；可省略 env 前缀如 stage/）
  --region=x,y,w,h              忽略区域（CSS 像素，相对视口 1280×720）
  --label=<text>                可选说明
  -h, --help
`);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  let script: string | undefined;
  let region: string | undefined;
  let label = '';

  for (const arg of argv) {
    if (arg.startsWith('--script=')) script = arg.slice('--script='.length).trim();
    else if (arg.startsWith('--region=')) region = arg.slice('--region='.length).trim();
    else if (arg.startsWith('--label=')) label = arg.slice('--label='.length).trim();
  }

  if (!script || !region) {
    console.error('❌ 需要 --script 与 --region');
    printHelp();
    process.exit(1);
  }

  const parts = region.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    console.error('❌ --region 格式应为 x,y,w,h');
    process.exit(1);
  }

  const cfg = fs.existsSync(CONFIG_PATH)
    ? (JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>)
    : {};
  if (!Array.isArray(cfg.ignoreRegions)) cfg.ignoreRegions = [];

  const entry = {
    script,
    x: parts[0],
    y: parts[1],
    width: parts[2],
    height: parts[3],
    ...(label ? { label } : {}),
  };

  (cfg.ignoreRegions as unknown[]).push(entry);
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, 'utf-8');
  console.log(`✅ 已追加 ignoreRegion → ${CONFIG_PATH}`);
  console.log(JSON.stringify(entry, null, 2));
}

main();
