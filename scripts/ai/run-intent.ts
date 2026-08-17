#!/usr/bin/env tsx
import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
import { parse as parseYaml } from 'yaml';
import { compileIntentToPlan } from '../../src/runtime/compile-intent.js';
import { executeAiTest } from '../../src/runtime/execute-ai-test.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

function getArgValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const prefix = `--${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === `--${name}` && i + 1 < args.length) return args[i + 1];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).some((arg) => arg === `--${name}`);
}

function ensureBrowsersPath(): void {
  const current = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const macPath = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const valid = (value: string): boolean => {
    if (!value || !fs.existsSync(value)) return false;
    try {
      return fs.readdirSync(value).some((name) => name.startsWith('chromium'));
    } catch {
      return false;
    }
  };

  if (!valid(current || '') && valid(macPath)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = macPath;
  } else if (current?.includes('cursor-sandbox-cache') && !valid(current)) {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
}

function sanitizeName(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'intent'
  );
}

function printHelp(): void {
  console.log(`用法: npm run intent:run -- --intent=<path> [选项]

选项:
  --intent=<path>   Test Intent YAML
  --env=<env>       覆盖意图中的环境
  --profile=<id>    覆盖账号 profile
  --out=<dir>       输出目录
  --headed          有头浏览器
  --heal            强制开启自愈（默认开启）
  --no-heal         关闭自愈
  -h, --help
`);
}

async function main(): Promise<void> {
  if (hasFlag('help') || hasFlag('h')) {
    printHelp();
    return;
  }

  const intentPath = getArgValue('intent');
  if (!intentPath || !fs.existsSync(intentPath)) {
    console.error(`❌ 测试意图文件不存在: ${intentPath || '(未指定)'}`);
    printHelp();
    process.exit(1);
  }

  ensureBrowsersPath();

  const raw = parseYaml(fs.readFileSync(intentPath, 'utf-8'));
  const { intent, plan } = compileIntentToPlan(raw);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const defaultOut = path.join('results', 'intent-runs', `${stamp}-${sanitizeName(intent.name)}`);
  const outputDir = path.resolve(getArgValue('out') || defaultOut);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'intent.json'), `${JSON.stringify(intent, null, 2)}\n`, 'utf-8');

  const heal = hasFlag('no-heal') ? false : true;

  const result = await executeAiTest(plan, {
    env: getArgValue('env'),
    profile: getArgValue('profile'),
    headed: hasFlag('headed'),
    outputDir,
    heal,
    constraints: intent.constraints,
  });

  console.log('');
  console.log(result.passed ? '✅ Intent 测试通过' : '❌ Intent 测试失败');
  console.log(`📁 输出目录: ${result.outputDir}`);
  for (const step of result.steps) {
    const status = step.passed ? '✅' : step.skipped ? '⏭️' : '❌';
    const healMark = step.healed ? ' [已自愈]' : '';
    console.log(`  ${status} ${step.id}${healMark}${step.error ? `: ${step.error}` : ''}`);
  }
  if (result.error) {
    console.log(`❌ ${result.error}`);
  }

  process.exit(result.passed ? 0 : 1);
}

main().catch((error) => {
  console.error('❌', error instanceof Error ? error.message : error);
  process.exit(1);
});
