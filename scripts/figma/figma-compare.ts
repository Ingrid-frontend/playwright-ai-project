#!/usr/bin/env tsx
/**
 * Figma 设计稿 vs 线上页面截图对比
 *
 * 用法:
 *   FIGMA_TOKEN=xxx npx tsx scripts/figma/figma-compare.ts \
 *     --figma="https://www.figma.com/design/{fileKey}/{name}?node-id={nodeId}" \
 *     --url="https://stage.huilianyi.com/" \
 *     --out="results/figma-compare/demo"
 *
 *   --url 可省略或使用相对路径，此时按 --env 的 baseURL 解析
 *   --out 省略时自动生成 results/figma-compare/<timestamp>
 *   --refresh-design  忽略 results/figma-cache/ 缓存，重新调用 Figma API 导出
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { resolveStorageState, getBaseEnvConfig } from '../../src/utils/env-config.js';

dotenv.config();

function ensureBrowsersPath(): void {
  const cur = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const mac = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const valid = (p: string) => {
    if (!p || !fs.existsSync(p)) return false;
    try {
      return fs.readdirSync(p).some(n => n.startsWith('chromium'));
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
    if (process.platform === 'darwin') {
      return await chromium.launch({ channel: 'chrome', headless: true });
    }
    throw e;
  }
}

const FIGMA_API = 'https://api.figma.com';
const TOKEN = process.env.FIGMA_TOKEN || process.env.FIGMA_ACCESS_TOKEN || '';

interface ParsedFigmaUrl {
  fileKey: string;
  nodeId?: string;
}

function parseFigmaUrl(raw: string): ParsedFigmaUrl {
  const m = raw.match(/figma\.com\/(?:design|file|proto)\/([^/?#]+)/);
  if (!m) throw new Error(`无法解析 Figma 链接: ${raw}`);
  const fileKey = m[1]!.split('-')[0]!;
  const nodeMatch = raw.match(/[?&]node-id=([^&#]+)/);
  const nodeId = nodeMatch ? decodeURIComponent(nodeMatch[1]!) : undefined;
  return { fileKey, nodeId };
}

async function figmaFetch(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'X-Figma-Token': TOKEN },
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Figma API ${res.status}: 非 JSON 响应 ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`Figma API ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

/** Figma 链接中 node-id 用连字符（16627-178005），API 用冒号（16627:178005） */
function canonicalNodeId(id: string): string {
  return id.replace(/-/g, ':');
}

async function resolveNodeId(fileKey: string, nodeId?: string): Promise<string> {
  if (nodeId) return nodeId;
  const file = await figmaFetch(`${FIGMA_API}/v1/files/${fileKey}`);
  const firstPage = file?.document?.children?.[0];
  if (!firstPage?.id) throw new Error('Figma 文件中未找到页面节点');
  return firstPage.id;
}

/** 查询 Figma 节点是否存在，返回可读信息 */
async function describeFigmaNode(fileKey: string, nodeId: string): Promise<string> {
  try {
    const file = await figmaFetch(
      `${FIGMA_API}/v1/files/${fileKey}?ids=${encodeURIComponent(canonicalNodeId(nodeId))}`,
    );
    const n = file?.nodes?.[nodeId]?.document;
    if (n) return `节点存在: ${n.name}（${n.type}）`;
    return '节点不存在，请检查 Figma 链接中的 node-id';
  } catch (e: any) {
    return `节点查询失败: ${e?.message || String(e)}`;
  }
}

async function downloadImage(url: string, outPath: string): Promise<void> {
  const res = await fetch(url, { headers: { 'X-Figma-Token': TOKEN } });
  if (!res.ok) throw new Error(`下载设计稿失败: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

async function exportFigmaPng(fileKey: string, nodeId: string, outPath: string): Promise<void> {
  const apiNodeId = canonicalNodeId(nodeId);
  const img = await figmaFetch(
    `${FIGMA_API}/v1/images/${fileKey}?ids=${encodeURIComponent(apiNodeId)}&format=png&scale=1`,
  );
  const hasKey = img?.images && (nodeId in img.images || apiNodeId in img.images);
  const url = hasKey ? (img.images[nodeId] ?? img.images[apiNodeId]) : undefined;

  if (!hasKey || !url) {
    const nodeInfo = await describeFigmaNode(fileKey, nodeId);
    const apiDetail = img ? JSON.stringify(img).slice(0, 300) : '无 API 响应';
    throw new Error(`Figma 未返回渲染图（${nodeInfo}）。API 响应: ${apiDetail}`);
  }

  await downloadImage(url, outPath);
}

async function captureLive(url: string, env: string, profile: string, outPath: string): Promise<void> {
  let storageRel: string | undefined;
  let storageAbs: string | undefined;
  try {
    storageRel = resolveStorageState(env, profile);
    storageAbs = path.resolve(process.cwd(), storageRel);
  } catch {
    storageRel = undefined;
    storageAbs = undefined;
  }
  if (!storageAbs || !fs.existsSync(storageAbs)) {
    console.log(`⚠️ 未找到登录态 ${storageRel || '(未配置)'}，线上截图可能停在登录页`);
    console.log('   → Studio：开始录制 → 浏览器登录 → 停止录制，会自动保存登录态');
  } else {
    try {
      const raw = JSON.parse(fs.readFileSync(storageAbs, 'utf-8')) as { cookies?: unknown[] };
      if (!raw.cookies?.length) {
        console.log(`⚠️ 登录态 ${storageRel} 无 cookies（可能已过期），请重新录制登录`);
      } else {
        console.log(`🔐 使用登录态: ${storageRel}（${raw.cookies.length} cookies）`);
      }
    } catch {
      console.log(`🔐 使用登录态: ${storageRel}`);
    }
  }
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ...(storageAbs && fs.existsSync(storageAbs) ? { storageState: storageAbs } : {}),
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(800);
    const finalUrl = page.url();
    if (/login|signin|auth|oauth|passport/i.test(finalUrl)) {
      console.log(`⚠️ 当前停在登录页: ${finalUrl}`);
      console.log('   → 请在 Studio 重新录制并登录，或执行: PLAYWRIGHT_ENV=stage npx playwright test --project=setup');
    }
    await page.screenshot({ path: outPath, fullPage: false });
    await context.close();
  } finally {
    await browser.close();
  }
}

/** 最近邻缩放 PNG 到目标尺寸 */
function resizePng(src: PNG, tw: number, th: number): PNG {
  const out = new PNG({ width: tw, height: th });
  const sx = src.width / tw;
  const sy = src.height / th;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const si = ((Math.min(src.height - 1, Math.floor(y * sy)) * src.width) + Math.min(src.width - 1, Math.floor(x * sx))) * 4;
      const di = (y * tw + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}


interface CropMeta {
  index: number;
  y: number;
  h: number;
  difference: number;
  designCrop: string;
  liveCrop: string;
  diffCrop: string;
}

/** 按高度将设计稿/线上截图切成多个区块，每个区块单独对比，便于看细节 */
function generateCrops(designPath: string, livePath: string, cropsDir: string, blockH = 360): CropMeta[] {
  const design = PNG.sync.read(fs.readFileSync(designPath));
  const live = PNG.sync.read(fs.readFileSync(livePath));
  const d = design.width !== live.width || design.height !== live.height
    ? resizePng(design, live.width, live.height)
    : design;
  const w = live.width;
  const h = live.height;
  const rows = Math.max(1, Math.ceil(h / blockH));
  const crops: CropMeta[] = [];
  fs.mkdirSync(cropsDir, { recursive: true });

  const crop = (src: PNG, y: number, ch: number): PNG => {
    const out = new PNG({ width: w, height: ch });
    PNG.bitblt(src, out, 0, y, w, ch, 0, 0);
    return out;
  };

  for (let r = 0; r < rows; r++) {
    const y = r * blockH;
    const ch = Math.min(blockH, h - y);
    if (ch <= 0) break;
    const index = r + 1;
    const cd = crop(d, y, ch);
    const cl = crop(live, y, ch);
    const diff = new PNG({ width: w, height: ch });
    const num = pixelmatch(cd.data, cl.data, diff.data, w, ch, { threshold: 0.1, includeAA: false });
    const prefix = `block-${index}`;
    fs.writeFileSync(path.join(cropsDir, `${prefix}-design.png`), PNG.sync.write(cd));
    fs.writeFileSync(path.join(cropsDir, `${prefix}-live.png`), PNG.sync.write(cl));
    fs.writeFileSync(path.join(cropsDir, `${prefix}-diff.png`), PNG.sync.write(diff));
    crops.push({
      index,
      y,
      h: ch,
      difference: num / (w * ch),
      designCrop: `crops/${prefix}-design.png`,
      liveCrop: `crops/${prefix}-live.png`,
      diffCrop: `crops/${prefix}-diff.png`,
    });
  }
  return crops.sort((a, b) => b.difference - a.difference);
}

function comparePng(designPath: string, livePath: string, diffPath: string): {
  difference: number;
  sizeMismatch: boolean;
} {
  const design = PNG.sync.read(fs.readFileSync(designPath));
  const live = PNG.sync.read(fs.readFileSync(livePath));
  const sizeMismatch = design.width !== live.width || design.height !== live.height;

  // 尺寸不同时把设计稿缩放到线上截图尺寸，保证 pixelmatch 可运行
  const img1 = sizeMismatch ? resizePng(design, live.width, live.height) : design;
  const img2 = live;
  const w = img1.width;
  const h = img1.height;

  const diff = new PNG({ width: w, height: h });
  const num = pixelmatch(img1.data, img2.data, diff.data, w, h, {
    threshold: 0.1,
    includeAA: false,
  });
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  return { difference: num / (w * h), sizeMismatch };
}

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

function designCacheDir(fileKey: string, nodeId: string): string {
  return path.join(process.cwd(), 'results', 'figma-cache', fileKey, safeNodeId(nodeId));
}

function designCachePath(fileKey: string, nodeId: string): string {
  return path.join(designCacheDir(fileKey, nodeId), 'design.png');
}

async function ensureDesignPng(
  fileKey: string,
  nodeId: string,
  outPath: string,
  figmaUrl: string,
  refresh: boolean,
): Promise<{ fromCache: boolean }> {
  const cachePath = designCachePath(fileKey, nodeId);
  if (!refresh && fs.existsSync(cachePath)) {
    fs.copyFileSync(cachePath, outPath);
    console.log(`♻️ 复用已缓存设计稿: ${path.relative(process.cwd(), cachePath)}`);
    return { fromCache: true };
  }
  if (!TOKEN) {
    throw new Error('未配置 FIGMA_TOKEN，且本地无该节点缓存，请先导出一次或配置 Token');
  }
  await exportFigmaPng(fileKey, nodeId, outPath);
  const cacheDir = designCacheDir(fileKey, nodeId);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.copyFileSync(outPath, cachePath);
  fs.writeFileSync(
    path.join(cacheDir, 'meta.json'),
    JSON.stringify({ figmaUrl, fileKey, nodeId, exportedAt: new Date().toISOString() }, null, 2),
    'utf-8',
  );
  console.log(`✅ 设计稿已导出: ${outPath}`);
  console.log(`💾 已写入缓存: ${path.relative(process.cwd(), cachePath)}`);
  return { fromCache: false };
}

async function main(): Promise<void> {
  ensureBrowsersPath();
  const figmaUrl = parseArg('figma');
  const targetUrl = parseArg('url');
  const outArg = parseArg('out');
  const env = parseArg('env') || process.env.PLAYWRIGHT_ENV || 'stage';
  const profile = parseArg('profile') || 'default';
  const refreshDesign = hasFlag('refresh-design');

  if (!figmaUrl) {
    console.error('❌ 缺少 --figma 参数');
    process.exit(1);
  }

  const outDir = outArg
    ? path.resolve(process.cwd(), outArg)
    : path.join(process.cwd(), 'results', 'figma-compare', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(outDir, { recursive: true });

  let liveUrl = targetUrl || '';
  if (liveUrl.startsWith('/')) {
    const base = getBaseEnvConfig(env)?.baseURL;
    if (!base) throw new Error(`环境 ${env} 未配置 baseURL`);
    liveUrl = `${base.replace(/\/$/, '')}${liveUrl}`;
  }
  if (!liveUrl) {
    liveUrl = getBaseEnvConfig(env)?.baseURL || '';
    if (!liveUrl) throw new Error('未提供 --url 且环境无 baseURL');
  }

  const { fileKey, nodeId: rawNode } = parseFigmaUrl(figmaUrl);
  const nodeId = await resolveNodeId(fileKey, rawNode);

  console.log(`📐 Figma: ${fileKey} / ${nodeId}`);
  console.log(`🌐 线上: ${liveUrl}`);

  const designPath = path.join(outDir, 'design.png');
  const livePath = path.join(outDir, 'live.png');
  const diffPath = path.join(outDir, 'diff.png');

  const { fromCache } = await ensureDesignPng(fileKey, nodeId, designPath, figmaUrl, refreshDesign);
  await captureLive(liveUrl, env, profile, livePath);
  console.log(`✅ 线上截图完成: ${livePath}`);

  const { difference, sizeMismatch } = comparePng(designPath, livePath, diffPath);
  console.log(`🔍 差异率: ${(difference * 100).toFixed(2)}%${sizeMismatch ? '（尺寸不一致）' : ''}`);

  const blockH = Number(parseArg('block-h') || 360) || 360;
  const crops = generateCrops(designPath, livePath, path.join(outDir, 'crops'), blockH);
  const top = crops[0];
  if (top) console.log(`🧱 区块: ${crops.length} 个，最大差异区块 #${top.index} ${(top.difference * 100).toFixed(2)}%`);

  const result = {
    generatedAt: new Date().toISOString(),
    crops,
    figmaUrl,
    fileKey,
    nodeId,
    targetUrl: liveUrl,
    difference,
    sizeMismatch,
    designFromCache: fromCache,
    designCache: path.relative(process.cwd(), designCachePath(fileKey, nodeId)),
    designImage: 'design.png',
    liveImage: 'live.png',
    diffImage: 'diff.png',
    outDir,
  };
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2), 'utf-8');
  console.log(JSON.stringify(result));
}

main().catch((e) => {
  console.error('❌ Figma 对比失败:', e.message);
  process.exit(1);
});
