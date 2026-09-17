#!/usr/bin/env tsx
/**
 * 生成可预览的飞书交付包（不写入飞书）。
 * 用法: npm run deliver:ready -- --env=stage9084
 */
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

export function parseDeliverEnv(argv: string[]): string {
  const env = argv.find((a) => a.startsWith('--env='))?.slice('--env='.length).trim().toLowerCase();
  if (!env) {
    console.error('缺少 --env=<id>，例如: npm run deliver:ready -- --env=stage9084');
    process.exit(1);
  }
  return env;
}

export function listReportEnvs(cwd = process.cwd()): string[] {
  try {
    const out = execSync('npm run report:customer -- --list-envs', {
      cwd,
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const envs: string[] = [];
    for (const line of out.split('\n')) {
      const m = line.match(/^\s+(\S+)\t/);
      if (m) envs.push(m[1]!.toLowerCase());
    }
    return envs;
  } catch {
    return [];
  }
}

function runStep(cmd: string, label: string): void {
  console.log(`\n▶ ${label}`);
  execSync(cmd, { stdio: 'inherit', cwd: process.cwd(), env: process.env });
}

function main(): void {
  const env = parseDeliverEnv(process.argv.slice(2));
  const reportPath = `results/ui-regression-customer-${env}.html`;

  runStep(`npm run report:customer -- --env=${env} --reuse-compare`, '生成客户报告');
  runStep(`npx tsx scripts/verify/verify-customer-report-html.ts --report=${reportPath}`, '校验报告 HTML');
  runStep(`node scripts/verify/verify-customer-delivery.cjs --env=${env}`, '校验交付载荷');
  runStep(`npm run deliver:preview -- --env=${env}`, '生成飞书预览');

  console.log(`\n✅ deliver:ready 完成（env=${env}）`);
  console.log('   预览: results/feishu-delivery-preview.html');
  console.log(`   人工写入: npm run deliver:feishu -- --env=${env}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
