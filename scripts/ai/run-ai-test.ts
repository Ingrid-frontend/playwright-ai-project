#!/usr/bin/env tsx
import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
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

function printHelp(): void {
  console.log(`用法: npx tsx scripts/ai/run-ai-test.ts --plan=<path> [选项]

选项:
  --plan=<path>     语义测试计划 JSON
  --env=<env>       覆盖计划中的环境
  --profile=<id>    覆盖账号 profile
  --out=<dir>       输出目录
  --headed          有头浏览器
  --heal            失败时调用模型尝试单步自愈
  -h, --help
`);
}

async function main(): Promise<void> {
  if (hasFlag('help') || hasFlag('h')) {
    printHelp();
    return;
  }

  const planPath = getArgValue('plan');
  if (!planPath || !fs.existsSync(planPath)) {
    console.error(`❌ 语义计划文件不存在: ${planPath || '(未指定)'}`);
    printHelp();
    process.exit(1);
  }

  ensureBrowsersPath();
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
  const result = await executeAiTest(plan, {
    env: getArgValue('env'),
    profile: getArgValue('profile'),
    headed: hasFlag('headed'),
    outputDir: getArgValue('out'),
    heal: hasFlag('heal') || process.env.AI_TEST_HEAL === '1',
  });

  console.log('');
  console.log(result.passed ? '✅ AI 测试通过' : '❌ AI 测试失败');
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
