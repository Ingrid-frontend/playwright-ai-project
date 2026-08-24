import fs from 'fs';
import path from 'path';
import { fetchWithRetry } from '../feishu/index.js';

export interface FigmaNodeRef {
  fileKey: string;
  nodeId: string;
  url: string;
}

export interface FigmaMapping {
  script: string;
  step?: string;
  figmaUrl: string;
}

export interface FigmaBaselineHit {
  imagePath: string;
  url: string;
  source: 'cli-url' | 'cli-image' | 'config';
}

interface FigmaBaselineConfig {
  mappings?: FigmaMapping[];
}

const DEFAULT_CONFIG = path.join('config', 'figma-baselines.json');

export function parseFigmaUrl(input: string): FigmaNodeRef | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!url.hostname.includes('figma.com')) return null;
  const m = url.pathname.match(/\/(file|design|proto)\/([A-Za-z0-9_-]+)/);
  const fileKey = m?.[2];
  if (!fileKey) return null;
  const nodeRaw = url.searchParams.get('node-id') || url.searchParams.get('node_id') || '';
  const nodeId = nodeRaw.replace(/-/g, ':').trim();
  if (!nodeId) return null;
  return { fileKey, nodeId, url: raw };
}

export function resolveFigmaToken(): string | undefined {
  for (const key of ['FIGMA_ACCESS_TOKEN', 'FIGMA_TOKEN', 'FIGMA_API_TOKEN']) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function loadFigmaBaselineConfig(configPath = DEFAULT_CONFIG): FigmaMapping[] {
  const abs = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(abs)) return [];
  try {
    const json = JSON.parse(fs.readFileSync(abs, 'utf-8')) as FigmaBaselineConfig;
    return Array.isArray(json.mappings) ? json.mappings.filter((x) => x && x.script && x.figmaUrl) : [];
  } catch {
    return [];
  }
}

export function matchFigmaMapping(
  mappings: FigmaMapping[],
  scriptKey: string,
  stepName: string,
  stepNumber?: number,
): FigmaMapping | null {
  const script = String(scriptKey || '');
  const step = String(stepName || '');
  const num = stepNumber != null ? String(stepNumber) : '';
  let fallback: FigmaMapping | null = null;
  for (const item of mappings) {
    if (!script.includes(item.script) && item.script !== script) continue;
    if (!item.step) {
      if (!fallback) fallback = item;
      continue;
    }
    if (item.step === num || step.includes(item.step) || `step-${item.step}` === step) return item;
  }
  return fallback;
}

async function downloadPng(url: string, dest: string): Promise<void> {
  const res = await fetchWithRetry(url, { timeout: 45_000, retries: 1 });
  if (!res.ok) throw new Error(`下载 Figma 图失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 32 || buf[0] !== 0x89) throw new Error('Figma 返回的不是 PNG');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

export async function fetchFigmaPng(
  ref: FigmaNodeRef,
  cacheDir: string,
  token: string,
): Promise<string> {
  const cacheName = `${ref.fileKey}_${ref.nodeId.replace(/:/g, '-')}.png`;
  const cachePath = path.join(cacheDir, cacheName);
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 32) return cachePath;

  const api = `https://api.figma.com/v1/images/${encodeURIComponent(ref.fileKey)}?ids=${encodeURIComponent(ref.nodeId)}&format=png&scale=2`;
  const res = await fetchWithRetry(api, {
    headers: { 'X-Figma-Token': token },
    timeout: 30_000,
    retries: 1,
  });
  if (!res.ok) {
    throw new Error(`Figma images API ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  const json = (await res.json()) as { err?: string; images?: Record<string, string | null> };
  if (json.err) throw new Error(json.err);
  const imageUrl = json.images?.[ref.nodeId] || json.images?.[ref.nodeId.replace(/:/g, '-')] || Object.values(json.images || {})[0];
  if (!imageUrl) throw new Error(`Figma 未返回节点 ${ref.nodeId} 的导出地址`);
  await downloadPng(imageUrl, cachePath);
  return cachePath;
}

let missingTokenWarned = false;

export async function resolveFigmaBaseline(opts: {
  scriptKey: string;
  stepName: string;
  stepNumber?: number;
  cliFigmaUrl?: string;
  cliFigmaImage?: string;
  cacheDir: string;
  configPath?: string;
}): Promise<FigmaBaselineHit | null> {
  if (opts.cliFigmaImage) {
    const imagePath = path.resolve(process.cwd(), opts.cliFigmaImage);
    if (!fs.existsSync(imagePath)) {
      console.log(`⚠️  --figma-image 不存在: ${opts.cliFigmaImage}`);
      return null;
    }
    return { imagePath, url: imagePath, source: 'cli-image' };
  }

  let url = opts.cliFigmaUrl?.trim() || '';
  let source: FigmaBaselineHit['source'] = 'cli-url';
  if (!url) {
    const hit = matchFigmaMapping(
      loadFigmaBaselineConfig(opts.configPath),
      opts.scriptKey,
      opts.stepName,
      opts.stepNumber,
    );
    if (!hit) return null;
    url = hit.figmaUrl;
    source = 'config';
  }

  const ref = parseFigmaUrl(url);
  if (!ref) {
    console.log(`⚠️  无法解析 Figma URL（需要含 node-id）: ${url}`);
    return null;
  }
  const token = resolveFigmaToken();
  if (!token) {
    if (!missingTokenWarned) {
      console.log('⚠️  未配置 FIGMA_ACCESS_TOKEN，跳过 Figma 设计稿拉取');
      missingTokenWarned = true;
    }
    return null;
  }
  try {
    const imagePath = await fetchFigmaPng(ref, opts.cacheDir, token);
    return { imagePath, url, source };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`⚠️  拉取 Figma 设计稿失败: ${msg.slice(0, 160)}`);
    return null;
  }
}
