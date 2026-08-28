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
  note?: string;
}

export interface FigmaBaselineHit {
  imagePath: string;
  url: string;
  source: 'cli-url' | 'cli-image' | 'config' | 'store';
}

export interface FigmaBaselineManifestEntry {
  script: string;
  step?: string;
  figmaUrl: string;
  fileKey: string;
  nodeId: string;
  note?: string;
  syncedAt: string;
}

export interface FigmaBaselineManifest {
  version: number;
  syncedAt?: string;
  entries: FigmaBaselineManifestEntry[];
  images: Record<string, { imageFile: string; syncedAt: string; figmaUrl: string }>;
}

interface FigmaBaselineConfig {
  mappings?: FigmaMapping[];
}

const DEFAULT_CONFIG = path.join('config', 'figma-baselines.json');
export const FIGMA_BASELINE_STORE_DIR = path.join('screenshots-baseline', 'figma');
export const FIGMA_BASELINE_IMAGES_DIR = path.join(FIGMA_BASELINE_STORE_DIR, 'images');
export const FIGMA_BASELINE_MANIFEST_PATH = path.join(FIGMA_BASELINE_STORE_DIR, 'manifest.json');

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

export function baselineImageFileName(ref: FigmaNodeRef): string {
  return `${ref.fileKey}_${ref.nodeId.replace(/:/g, '-')}.png`;
}

export function baselineImageAbsPath(ref: FigmaNodeRef, root = process.cwd()): string {
  return path.join(root, FIGMA_BASELINE_IMAGES_DIR, baselineImageFileName(ref));
}

export function nodeCacheKey(ref: FigmaNodeRef): string {
  return `${ref.fileKey}:${ref.nodeId}`;
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

export function loadFigmaBaselineManifest(manifestPath = FIGMA_BASELINE_MANIFEST_PATH): FigmaBaselineManifest | null {
  const abs = path.resolve(process.cwd(), manifestPath);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8')) as FigmaBaselineManifest;
  } catch {
    return null;
  }
}

export function syncFigmaBaselineManifest(manifest: Omit<FigmaBaselineManifest, 'version'>): void {
  const abs = path.resolve(process.cwd(), FIGMA_BASELINE_MANIFEST_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const payload: FigmaBaselineManifest = { version: 1, ...manifest };
  fs.writeFileSync(abs, JSON.stringify(payload, null, 2), 'utf-8');
}

/** 合并写入 manifest（保留既有 audit entries，追加 images） */
export function mergeFigmaBaselineManifest(
  patch: Partial<Omit<FigmaBaselineManifest, 'version'>> & {
    images?: Record<string, { imageFile: string; syncedAt: string; figmaUrl: string }>;
    entries?: FigmaBaselineManifestEntry[];
  },
): void {
  const prev = loadFigmaBaselineManifest();
  const entries = [...(prev?.entries ?? [])];
  const entryKeys = new Set(entries.map((e) => `${e.script}\0${e.step ?? ''}`));
  for (const e of patch.entries ?? []) {
    const k = `${e.script}\0${e.step ?? ''}`;
    if (entryKeys.has(k)) continue;
    entries.push(e);
    entryKeys.add(k);
  }
  syncFigmaBaselineManifest({
    syncedAt: patch.syncedAt ?? prev?.syncedAt,
    entries,
    images: { ...(prev?.images ?? {}), ...(patch.images ?? {}) },
  });
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

function readStoreImage(ref: FigmaNodeRef): string | null {
  const abs = baselineImageAbsPath(ref);
  if (fs.existsSync(abs) && fs.statSync(abs).size > 32) return abs;

  const manifest = loadFigmaBaselineManifest();
  const hit = manifest?.images?.[nodeCacheKey(ref)];
  if (!hit?.imageFile) return null;
  const fromManifest = path.resolve(process.cwd(), FIGMA_BASELINE_STORE_DIR, hit.imageFile);
  if (fs.existsSync(fromManifest) && fs.statSync(fromManifest).size > 32) return fromManifest;
  return null;
}

async function downloadPng(url: string, dest: string): Promise<void> {
  const res = await fetchWithRetry(url, { timeout: 45_000, retries: 1 });
  if (!res.ok) throw new Error(`下载 Figma 图失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 32 || buf[0] !== 0x89) throw new Error('Figma 返回的不是 PNG');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

/** 仅 sync 脚本调用：从 Figma API 拉取并写入 screenshots-baseline/figma/images/ */
export async function fetchFigmaPng(
  ref: FigmaNodeRef,
  opts?: { force?: boolean },
): Promise<string> {
  const cachePath = baselineImageAbsPath(ref);
  if (!opts?.force && fs.existsSync(cachePath) && fs.statSync(cachePath).size > 32) {
    return cachePath;
  }

  const token = resolveFigmaToken();
  if (!token) throw new Error('未配置 FIGMA_ACCESS_TOKEN');

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
  const imageUrl =
    json.images?.[ref.nodeId] ||
    json.images?.[ref.nodeId.replace(/:/g, '-')] ||
    Object.values(json.images || {})[0];
  if (!imageUrl) throw new Error(`Figma 未返回节点 ${ref.nodeId} 的导出地址`);
  await downloadPng(imageUrl, cachePath);
  return cachePath;
}

let missingCacheWarned = false;

/**
 * 解析审计用 Figma 基准图。
 * 默认只读本地 screenshots-baseline/figma/，不访问 Figma API。
 * 设计稿更新后请运行：npm run figma:sync-baselines
 */
export async function resolveFigmaBaseline(opts: {
  scriptKey: string;
  stepName: string;
  stepNumber?: number;
  cliFigmaUrl?: string;
  cliFigmaImage?: string;
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

  const storePath = readStoreImage(ref);
  if (storePath) {
    return { imagePath: storePath, url, source: 'store' };
  }

  if (!missingCacheWarned) {
    console.log(
      '⚠️  本地无 Figma 设计稿缓存，跳过双图对比。请运行: npm run figma:sync-baselines',
    );
    missingCacheWarned = true;
  }
  return null;
}
