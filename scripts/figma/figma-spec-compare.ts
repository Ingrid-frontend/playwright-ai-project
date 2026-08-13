#!/usr/bin/env tsx
/**
 * 设计稿规范对比（语义校验版）
 *
 * 用法:
 *   FIGMA_TOKEN=xxx npx tsx scripts/figma/figma-spec-compare.ts \
 *     --figma="https://www.figma.com/design/{fileKey}/{name}?node-id={nodeId}" \
 *     --url="https://stage.huilianyi.com/main/approve" \
 *     --out="results/figma-compare/demo"
 *
 *   --spec-only         只导出设计稿规范，不采集线上页面
 *   --refresh           忽略 Figma 节点/图片缓存
 *   --env=<stage>       环境，默认 stage
 *   --profile=<default> 登录态档案
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { resolveStorageState, getBaseEnvConfig } from '../../src/utils/env-config.js';
import { parseFigmaUrl, fetchFigmaNode, extractDesignSpec } from './design-spec.js';
import { captureLiveSpec } from './live-spec.js';
import { loadSpecConfig, runSpecChecks, summarizeChecks } from './spec-checks.js';
import { writeSpecReport, writeDesignSpecOnly } from './spec-report.js';
import type { DesignSpec } from './figma-spec-types.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const FIGMA_API = 'https://api.figma.com';
const TOKEN = process.env.FIGMA_TOKEN || process.env.FIGMA_ACCESS_TOKEN || '';

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function safeNodeId(id: string): string {
  return id.replace(/:/g, '-').replace(/[^a-zA-Z0-9._-]/g, '_');
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

async function launchBrowser() {
  ensureBrowsersPath();
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch({ headless: true });
  } catch (e) {
    if (process.platform === 'darwin') return await chromium.launch({ channel: 'chrome', headless: true });
    throw e;
  }
}

async function figmaFetch(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'X-Figma-Token': TOKEN } });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Figma API ${res.status}: 非 JSON 响应 ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`Figma API ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function ensureDesignPng(fileKey: string, nodeId: string, outPath: string, refresh: boolean): Promise<void> {
  const cachePath = path.join(
    process.cwd(),
    'results',
    'figma-cache',
    fileKey,
    safeNodeId(nodeId),
    'design.png',
  );
  if (!refresh && fs.existsSync(cachePath)) {
    fs.copyFileSync(cachePath, outPath);
    return;
  }
  if (!TOKEN) throw new Error('未配置 FIGMA_TOKEN，且本地无设计稿 PNG 缓存');
  const apiNodeId = nodeId.replace(/-/g, ':');
  const img = await figmaFetch(
    `${FIGMA_API}/v1/images/${fileKey}?ids=${encodeURIComponent(apiNodeId)}&format=png&scale=1`,
  );
  const url = img?.images?.[apiNodeId] || img?.images?.[nodeId];
  if (!url) throw new Error(`Figma 未返回渲染图: ${JSON.stringify(img).slice(0, 200)}`);
  const res = await fetch(url, { headers: { 'X-Figma-Token': TOKEN } });
  if (!res.ok) throw new Error(`下载设计稿失败: ${res.status}`);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, Buffer.from(await res.arrayBuffer()));
  fs.copyFileSync(cachePath, outPath);
}

function resolveLiveUrl(raw: string | undefined, env: string): string {
  let url = raw || '';
  if (url.startsWith('/')) {
    const base = getBaseEnvConfig(env)?.baseURL;
    if (!base) throw new Error(`环境 ${env} 未配置 baseURL`);
    url = `${base.replace(/\/$/, '')}${url}`;
  }
  if (!url) {
    url = getBaseEnvConfig(env)?.baseURL || '';
    if (!url) throw new Error('未提供 --url 且环境无 baseURL');
  }
  return url;
}

function printSummary(design: DesignSpec, summary: ReturnType<typeof summarizeChecks>, warnings: string[]): void {
  console.log(`\n📐 设计稿: ${design.source.nodeName}（${design.canvas.width}x${design.canvas.height}）`);
  console.log(`📋 校验: 通过 ${summary.pass} / 警告 ${summary.warn} / 失败 ${summary.fail} / 信息 ${summary.info}`);
  for (const w of warnings) console.log(`ℹ️  ${w}`);
}

async function main(): Promise<void> {
  const figmaUrl = parseArg('figma');
  const targetUrl = parseArg('url');
  const outArg = parseArg('out');
  const env = parseArg('env') || process.env.PLAYWRIGHT_ENV || 'stage';
  const profile = parseArg('profile') || 'default';
  const refresh = hasFlag('refresh');
  const specOnly = hasFlag('spec-only');

  if (!figmaUrl) {
    console.error('❌ 缺少 --figma 参数');
    process.exit(1);
  }

  const { fileKey, nodeId: rawNode } = parseFigmaUrl(figmaUrl);
  const { node, nodeId, fromCache } = await fetchFigmaNode(fileKey, rawNode, {
    figmaUrl,
    refresh,
  });
  const source = {
    fileKey,
    nodeId,
    nodeName: node.name || '',
    figmaUrl,
    fetchedAt: new Date().toISOString(),
    fromCache,
  };
  const config = loadSpecConfig();
  const design = extractDesignSpec(node, source, config);

  const outDir = outArg
    ? path.resolve(process.cwd(), outArg)
    : path.join(
        process.cwd(),
        'results',
        'figma-compare',
        new Date().toISOString().replace(/[:.]/g, '-') + '-spec',
      );
  fs.mkdirSync(outDir, { recursive: true });

  if (specOnly) {
    writeDesignSpecOnly(outDir, design);
    console.log(`✅ 设计稿规范已导出: ${path.join(outDir, 'design-spec.md')}`);
    console.log(`   JSON: ${path.join(outDir, 'design-spec.json')}`);
    return;
  }

  const liveUrl = resolveLiveUrl(targetUrl, env);
  console.log(`🌐 线上页面: ${liveUrl}`);
  console.log(`📐 设计稿节点: ${fileKey} / ${nodeId}`);

  const browser = await launchBrowser();
  try {
    let storageAbs: string | undefined;
    try {
      storageAbs = path.resolve(process.cwd(), resolveStorageState(env, profile));
    } catch {
      storageAbs = undefined;
    }
    const context = await browser.newContext({
      viewport: { width: Math.round(design.canvas.width), height: Math.round(design.canvas.height) },
      ...(storageAbs && fs.existsSync(storageAbs) ? { storageState: storageAbs } : {}),
    });
    const page = await context.newPage();
    await page.goto(liveUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForSelector('iframe', { state: 'attached', timeout: 15000 }).catch(() => {});
    for (const frame of page.frames()) {
      try {
        await frame.waitForSelector('.ant-table, .ant-tabs, table', { state: 'attached', timeout: 15000 });
      } catch {
        // 允许部分 frame 没有表格/页签
      }
    }
    await page.waitForTimeout(800);

    const live = await captureLiveSpec(page, config);
    const livePath = path.join(outDir, 'live.png');
    await page.screenshot({ path: livePath, fullPage: false });
    const designPath = path.join(outDir, 'design.png');
    try {
      await ensureDesignPng(fileKey, nodeId, designPath, refresh);
    } catch (e: any) {
      console.warn(`⚠️  设计稿 PNG 导出失败（不影响规范校验）: ${e.message}`);
    }

    const checks = runSpecChecks(design, live, config);
    const summary = writeSpecReport(outDir, design, live, checks);
    printSummary(design, summary, live.warnings);
    console.log(`✅ 报告: ${path.join(outDir, 'report.html')}`);
    console.log(`   JSON: ${path.join(outDir, 'result.json')}`);
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('❌ 设计稿规范对比失败:', e.message);
  process.exit(1);
});
