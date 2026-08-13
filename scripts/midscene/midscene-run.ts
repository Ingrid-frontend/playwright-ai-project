#!/usr/bin/env tsx
/**
 * Midscene AI 浏览器任务演示/调试入口
 *
 * 用法:
 *   MIDSCENE_FALLBACK=1 npx tsx scripts/midscene/midscene-run.ts \
 *     --url="https://stage.huilianyi.com/main/approve" \
 *     --task="点击「我的审批」并确认列表加载"
 *
 *   --assert="页面包含待审批列表"
 *   --query='{"title":"当前页签","count":0}，提取当前页签名称'
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { resolveStorageState } from '../../src/utils/env-config.js';
import { midsceneAct, midsceneAssert, midsceneQuery } from '../../src/utils/midscene.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function ensureBrowsersPath(): void {
  const cur = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const mac = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const valid = (p: string): boolean => {
    if (!p || !fs.existsSync(p)) return false;
    try {
      return fs.readdirSync(p).some((n) => n.startsWith('chromium'));
    } catch {
      return false;
    }
  };
  if (!valid(cur || '') && valid(mac)) process.env.PLAYWRIGHT_BROWSERS_PATH = mac;
  else if (cur?.includes('cursor-sandbox-cache') && !valid(cur)) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
}

async function main(): Promise<void> {
  const url = parseArg('url');
  const task = parseArg('task');
  const assertion = parseArg('assert');
  const query = parseArg('query');
  const env = parseArg('env') || process.env.PLAYWRIGHT_ENV || 'stage';
  const profile = parseArg('profile') || 'default';

  if (!task && !assertion && !query) {
    console.error('❌ 需要 --task / --assert / --query 至少一个');
    process.exit(1);
  }
  if (!url) {
    console.error('❌ 需要 --url');
    process.exit(1);
  }

  ensureBrowsersPath();
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    let storageAbs: string | undefined;
    try {
      storageAbs = path.resolve(process.cwd(), resolveStorageState(env, profile));
    } catch {
      storageAbs = undefined;
    }
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ...(storageAbs && fs.existsSync(storageAbs) ? { storageState: storageAbs } : {}),
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1200);

    if (task) {
      console.log(`🤖 Midscene 执行: ${task}`);
      const result = await midsceneAct(page, task);
      console.log(result ? `✅ 执行完成: ${result}` : '⚠️ Midscene 未返回明确结果');
    }
    if (assertion) {
      const ok = await midsceneAssert(page, assertion);
      if (!ok) {
        console.error(`❌ 断言失败: ${assertion}`);
        process.exitCode = 1;
      } else {
        console.log(`✅ 断言通过: ${assertion}`);
      }
    }
    if (query) {
      const data = await midsceneQuery(page, query);
      console.log(JSON.stringify(data, null, 2));
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
