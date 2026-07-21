#!/usr/bin/env tsx
/**
 * Healer POC：失败后用 --last-failed 重跑并输出修复建议
 *
 * npm run heal-spec -- tests/optimized/.../x.optimized.spec.ts
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function printHelp(): void {
  console.log(`用法: tsx scripts/flow/heal-spec.ts <optimized.spec.ts> [--project=optimized]

失败时：
  1. 读取 error-reporter 最新错误
  2. 尝试 --last-failed 重跑一次
  3. 输出 selector 修复建议（不自动 commit）
`);
}

function latestErrorHint(): string {
  const errorDir = path.join(process.cwd(), 'tests/deprecated/errors');
  if (!fs.existsSync(errorDir)) return '';
  const files = fs
    .readdirSync(errorDir)
    .filter((f) => f.startsWith('test-errors-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (!files[0]) return '';
  try {
    const report = JSON.parse(fs.readFileSync(path.join(errorDir, files[0]), 'utf-8')) as {
      errors?: { error?: string; errorLine?: number; errorFile?: string }[];
    };
    const err = report.errors?.[0];
    if (!err) return '';
    const loc = err.errorLine != null ? `${err.errorFile}:${err.errorLine}` : err.errorFile || '';
    return `${loc}\n${(err.error || '').slice(0, 500)}`;
  } catch {
    return '';
  }
}

function main(): void {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  if (argv.includes('-h') || argv.includes('--help') || argv.length === 0) {
    printHelp();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  let specPath = '';
  let project = 'optimized';
  for (const arg of argv) {
    if (arg.startsWith('--project=')) project = arg.slice('--project='.length).trim();
    else if (!arg.startsWith('--')) specPath = arg;
  }

  if (!specPath || !fs.existsSync(specPath)) {
    console.error(`❌ 文件不存在: ${specPath || '(未指定)'}`);
    process.exit(1);
  }

  const cmd = `npx playwright test "${specPath}" --project=${project} --workers=1`;
  console.log(`🧪 执行: ${cmd}`);
  let failed = false;
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    failed = true;
  }

  if (!failed) {
    console.log('✅ 用例已通过，无需 heal');
    return;
  }

  const hint = latestErrorHint();
  if (hint) {
    console.log('\n📋 最近失败信息：');
    console.log(hint);
  }

  console.log('\n🔧 尝试 --last-failed 重跑…');
  try {
    execSync(`npx playwright test --last-failed --project=${project} --workers=1`, { stdio: 'inherit' });
    console.log('✅ 重跑通过');
    return;
  } catch {
    console.log('❌ 重跑仍失败');
  }

  console.log('\n💡 Healer 建议：');
  console.log('  - 本地: npm run init-agents 后在 IDE 使用 Playwright Healer');
  console.log('  - 或: npm run optimize:ai -- <raw.spec.ts> 后重新 pipeline');
  console.log('  - 查看 trace: npx playwright show-trace test-results/**/trace.zip');
  process.exit(1);
}

main();
