#!/usr/bin/env tsx
import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { getBaseEnvConfig, resolveStorageState } from '../../src/utils/env-config.js';
import { verifyStorageStateForRun } from '../../src/runtime/pw-page-context.js';
import { writeFlowReplay } from '../../src/runtime/flow-replay.js';

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
const videoDir = process.env.AI_TEST_VIDEO_DIR || '';
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  ...(baseURL ? { baseURL } : {}),
  ...(storageState && fs.existsSync(storageState) ? { storageState } : {}),
  ...(videoDir ? { recordVideo: { dir: videoDir + '/_pw-video', size: { width: 1280, height: 720 } } } : {}),
});
const page = await context.newPage();
page.setDefaultTimeout(30000);

async function studioPickVisible(root, candidates, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const loc of candidates) {
      try {
        if ((await loc.count()) > 0 && (await loc.first().isVisible())) return loc.first();
      } catch {}
    }
    await root.waitForTimeout(400);
  }
  return null;
}

async function studioOpenFirstListRow(root) {
  await root.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
  const roots = [root];
  try {
    for (const frame of root.frames()) roots.push(frame);
  } catch {}
  for (let i = 0; i < 8; i++) {
    const top = root.frameLocator('iframe').nth(i);
    roots.push(top);
    for (let j = 0; j < 4; j++) roots.push(top.frameLocator('iframe').nth(j));
  }
  const candidates = [];
  for (const frame of roots) {
    candidates.push(frame.getByText(/CD\\d{10,}/).filter({ visible: true }));
    candidates.push(frame.getByRole('link', { name: /CD\\d|申请单|单据/ }).filter({ visible: true }));
    candidates.push(frame.getByRole('cell', { name: '1', exact: true }).filter({ visible: true }));
    candidates.push(frame.getByRole('gridcell', { name: '1', exact: true }).filter({ visible: true }));
    candidates.push(frame.getByRole('row').filter({ visible: true }).nth(1));
  }
  const row = await studioPickVisible(root, candidates, 15000);
  if (!row) {
    console.log('studioOpenFirstListRow: 未找到可点击的列表数据行（已扫 page + 嵌套 iframe，含单号）');
    return null;
  }
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.click({ timeout: 10000 });
  console.log('studioOpenFirstListRow: 已点击首条数据行');
  return row;
}

async function studioDumpFrames(root) {
  for (const frame of root.frames()) {
    const text = await frame
      .evaluate(() => (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 800))
      .catch(() => '');
    if (text) console.log('[frame] ' + (frame.url() || '') + '\\n' + text);
  }
}

try {
  const target = /^https?:\\/\\//i.test(entry) || entry.startsWith('data:')
    ? entry
    : entry.startsWith('/')
      ? entry
      : \`/\${entry}\`;
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
${indentCode(code, 2)}
} catch (err) {
  await studioDumpFrames(page).catch(() => {});
  throw err;
} finally {
  try {
    const video = page.video && page.video();
    await context.close();
    if (video && videoDir) {
      const src = await video.path();
      if (src) fs.copyFileSync(src, videoDir + '/flow.webm');
    }
  } catch {
    await context.close().catch(() => {});
  }
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
    AI_TEST_VIDEO_DIR: outDir,
  };
  ensureBrowsersPath(spawnEnv);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: !hasFlag('headed') });
  try {
    const storageCheck = await verifyStorageStateForRun(browser, storageState, {
      baseURL,
      entry,
      allowMissing: !storageState,
    });
    if (!storageCheck.valid) {
      throw new Error(storageCheck.reason || 'storageState 不可用，请先执行 npm run login');
    }
  } finally {
    await browser.close().catch(() => {});
  }

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
  const videoAbs = path.join(outDir, 'flow.webm');
  const flow = writeFlowReplay({
    outputDir: outDir,
    title: '口语试跑',
    videoAbs: fs.existsSync(videoAbs) ? videoAbs : undefined,
  });
  const result = {
    passed,
    exitCode,
    outputDir: outDir,
    script: scriptPath,
    error: passed ? undefined : (stderr || stdout || `退出码 ${exitCode}`).trim().slice(0, 800),
    videoRel: flow.videoRel,
    replayRel: flow.replayRel,
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
