#!/usr/bin/env tsx
import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { getBaseEnvConfig, resolveStorageState } from '../../src/utils/env-config.js';

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

function ensureBrowsersPath(env: NodeJS.ProcessEnv): void {
  const current = env.PLAYWRIGHT_BROWSERS_PATH;
  const macPath = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const valid = (value: string | undefined): boolean => {
    if (!value || !fs.existsSync(value)) return false;
    try {
      return fs.readdirSync(value).some((name) => name.startsWith('chromium'));
    } catch {
      return false;
    }
  };
  if (!valid(current) && valid(macPath)) env.PLAYWRIGHT_BROWSERS_PATH = macPath;
  else if (current?.includes('cursor-sandbox-cache') && !valid(current)) delete env.PLAYWRIGHT_BROWSERS_PATH;
}

function indentCode(code: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return code
    .trim()
    .split('\n')
    .map((line) => (line.trim() ? `${prefix}${line}` : ''))
    .join('\n');
}

function buildWrapper(code: string, headed: boolean): string {
  return `import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import fs from 'fs';

const storageState = process.env.AI_TEST_STORAGE_STATE || '';
const baseURL = process.env.AI_TEST_BASE_URL || undefined;
const entry = process.env.AI_TEST_ENTRY || '/';
const browser = await chromium.launch({ headless: ${headed ? 'false' : 'true'} });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  ...(baseURL ? { baseURL } : {}),
  ...(storageState && fs.existsSync(storageState) ? { storageState } : {}),
});
const page = await context.newPage();
page.setDefaultTimeout(30000);

try {
  const target = /^https?:\\/\\//i.test(entry) || entry.startsWith('data:')
    ? entry
    : entry.startsWith('/')
      ? entry
      : \`/\${entry}\`;
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
${indentCode(code, 2)}
} finally {
  await context.close();
  await browser.close();
}
`;
}

function printHelp(): void {
  console.log(`用法: npx tsx scripts/ai/run-playwright-script.ts --script=<path> [选项]

选项:
  --script=<path>   生成的 Playwright 动作脚本
  --env=<env>       目标环境
  --profile=<id>    账号 profile
  --entry=<path>    入口路径（默认 /）
  --out=<dir>       输出目录
  --headed          有头浏览器
  -h, --help
`);
}

async function main(): Promise<void> {
  if (hasFlag('help') || hasFlag('h')) {
    printHelp();
    return;
  }

  const scriptPath = getArgValue('script');
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    console.error(`❌ 脚本不存在: ${scriptPath || '(未指定)'}`);
    process.exit(1);
  }

  const env = getArgValue('env') || process.env.PLAYWRIGHT_ENV || 'stage';
  const profile = getArgValue('profile') || process.env.PLAYWRIGHT_ACCOUNT;
  const baseConfig = getBaseEnvConfig(env);
  const storageState = (() => {
    try {
      return path.resolve(process.cwd(), resolveStorageState(env, profile));
    } catch {
      return '';
    }
  })();
  const baseURL = baseConfig?.baseURL || process.env.BASE_URL || '';
  const entry = getArgValue('entry') || '/';
  const outDir = path.resolve(getArgValue('out') || 'results/ai-native-script');
  fs.mkdirSync(outDir, { recursive: true });
  const wrapperDir = path.join(
    process.cwd(),
    'results',
    'ai-script-runs',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  fs.mkdirSync(wrapperDir, { recursive: true });
  const wrapperPath = path.join(wrapperDir, 'generated-run.mts');
  const logPath = path.join(outDir, 'stdout.log');
  const code = fs.readFileSync(scriptPath, 'utf-8');
  fs.writeFileSync(wrapperPath, buildWrapper(code, hasFlag('headed')), 'utf-8');

  const tsxBin = path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const spawnEnv: NodeJS.ProcessEnv = {
    ...process.env,
    AI_TEST_STORAGE_STATE: storageState && fs.existsSync(storageState) ? storageState : '',
    AI_TEST_BASE_URL: baseURL,
    AI_TEST_ENTRY: entry,
  };
  ensureBrowsersPath(spawnEnv);

  console.log(`🧪 正在执行 Playwright 脚本...`);
  const proc = spawn(tsxBin, [wrapperPath], {
    cwd: process.cwd(),
    env: spawnEnv,
    shell: false,
  });

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (d) => {
    const text = d.toString();
    stdout += text;
    process.stdout.write(text);
  });
  proc.stderr.on('data', (d) => {
    const text = d.toString();
    stderr += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', resolve);
  });

  const passed = exitCode === 0;
  const result = {
    passed,
    exitCode,
    outputDir: outDir,
    script: scriptPath,
    error: passed ? undefined : (stderr || stdout || `退出码 ${exitCode}`).trim().slice(0, 800),
  };
  fs.writeFileSync(logPath, stdout + stderr, 'utf-8');
  fs.writeFileSync(path.join(outDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf-8');
  console.log(passed ? '✅ Playwright 脚本执行通过' : '❌ Playwright 脚本执行失败');
  console.log(`📁 输出目录: ${outDir}`);
  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  console.error('❌', error instanceof Error ? error.message : error);
  process.exit(1);
});
