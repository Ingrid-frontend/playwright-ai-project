import fs from 'fs';
import path from 'path';

export type BaselineStrategy = 'hybrid' | 'golden' | 'last-green' | 'oldest';

export interface IgnoreRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  script?: string;
  label?: string;
}

export type MaskSelector = string | { selector: string; script?: string };

export interface SnapshotViewport {
  name: string;
  width: number;
  height: number;
  default?: boolean;
  enabled?: boolean;
}

export interface ElementFingerprint {
  tag: string;
  stableAttributes: Record<string, string>;
  textHint: string;
  xpath: string;
  fallbackSelectors: string[];
  baselineRect: { x: number; y: number; width: number; height: number };
  baselinePageWidth: number;
  baselinePageHeight: number;
}

export interface StructureCheckItem {
  key: string;
  selector: string;
  script?: string;
  required?: boolean;
  /** main=主文档（默认）；first=第一个子 frame（iframe 内页面） */
  frame?: 'main' | 'first';
  /** 仅在该 snapshot 截图上采集/对比；不传则对所有步骤生效 */
  snapshotName?: string;
  state?: string;
  /** 采集时自动写入，用于 selector 失效后兜底 */
  fingerprint?: ElementFingerprint;
}

export interface StyleCheckItem {
  key: string;
  selector: string;
  script?: string;
  required?: boolean;
  frame?: 'main' | 'first';
  props?: string[];
  label?: string;
  snapshotName?: string;
  state?: string;
}

export interface StyleChecksConfig {
  enabled: boolean;
  tolerance: {
    fontSizePx?: number;
    colorDelta?: number;
  };
  items: StyleCheckItem[];
}

export interface GateConfig {
  mode: 'style-only' | 'pixel' | 'hybrid';
  /** scriptKey 以此前缀开头时，style-only 下 golden/last-green blocker 仍会使 --gate 失败 */
  pixelScriptPrefixes?: string[];
}

export interface ChangeDetectionSection {
  key: string;
  selector: string;
  watch?: Array<'structure' | 'text' | 'style'>;
}

export interface ChangeDetectionConfig {
  enabled: boolean;
  sections: ChangeDetectionSection[];
  textNormalize: string[];
  severity: {
    contentOnly: 'info' | 'warning' | 'blocker';
    structureOnly: 'info' | 'warning' | 'blocker';
    structureAndPixel: 'info' | 'warning' | 'blocker';
  };
}

export interface UiRegressionConfig {
  blockerRatio: number;
  warningRatio: number;
  diffOnlyTabMinRatio: number;
  defaultBrowsers: string[];
  compareCrossBrowser: boolean;
  compareRunDrift: boolean;
  baselineStrategy: BaselineStrategy;
  ignoreRegions: IgnoreRegion[];
  maskSelectors: MaskSelector[];
  viewports: SnapshotViewport[];
  structureChecks: StructureChecksConfig;
  styleChecks: StyleChecksConfig;
  gate: GateConfig;
  screenshot: {
    freezeAnimations: boolean;
    deviceScaleFactor: number;
    fullPage: boolean;
  };
  crossBrowser: {
    blockerRatio: number;
    warningRatio: number;
    countAsBlockerInGate: boolean;
    pixelmatchThreshold: number;
    includeAA: boolean;
  };
  autoPromote?: {
    maxDiffRatio: number;
  };
  aiReview?: AiReviewConfig;
  diffRegions?: DiffRegionsConfig;
  changeDetection?: ChangeDetectionConfig;
}

export interface AiReviewConfig {
  enabled: boolean;
  minSeverity: 'warning' | 'blocker';
  maxItems: number;
  /** 规则/AI 判定为 ui_bug 时是否让 --gate 失败（默认 false，兼容旧行为） */
  failOnUiBug: boolean;
}

export interface StructureChecksConfig {
  enabled: boolean;
  bboxTolerancePx: number;
  failOnOverflow: boolean;
  failOnPageError: boolean;
  /** 对比 structureChecks.items 对应节点的 DOM 指纹 */
  checkDomHash: boolean;
  /** 可选：页面级 DOM 指纹根节点 */
  domHashRoot?: string;
  items: StructureCheckItem[];
}

export interface DiffRegionsConfig {
  enabled: boolean;
  highRatio: number;
  highMinWidth: number;
  highMinHeight: number;
  lowMaxPixels: number;
}

export interface PixelmatchOptions {
  threshold: number;
  includeAA: boolean;
}

const DEFAULT_CONFIG: UiRegressionConfig = {
  blockerRatio: 0.005,
  warningRatio: 0.001,
  diffOnlyTabMinRatio: 0.003,
  defaultBrowsers: ['chrome', 'webkit'],
  compareCrossBrowser: true,
  compareRunDrift: false,
  baselineStrategy: 'golden',
  ignoreRegions: [],
  maskSelectors: [],
  viewports: [{ name: 'desktop', width: 1280, height: 720, default: true }],
  structureChecks: {
    enabled: true,
    bboxTolerancePx: 4,
    failOnOverflow: true,
    failOnPageError: false,
    checkDomHash: true,
    domHashRoot: 'body',
    items: [],
  },
  styleChecks: {
    enabled: true,
    tolerance: { fontSizePx: 0, colorDelta: 0 },
    items: [],
  },
  gate: {
    mode: 'style-only',
    pixelScriptPrefixes: ['intent/'],
  },
  screenshot: {
    freezeAnimations: true,
    deviceScaleFactor: 1,
    fullPage: false,
  },
  crossBrowser: {
    blockerRatio: 0.03,
    warningRatio: 0.003,
    countAsBlockerInGate: false,
    pixelmatchThreshold: 0.1,
    includeAA: false,
  },
  autoPromote: {
    maxDiffRatio: 0.005,
  },
  aiReview: {
    enabled: false,
    minSeverity: 'warning',
    maxItems: 20,
    failOnUiBug: false,
  },
  diffRegions: {
    enabled: true,
    highRatio: 0.002,
    highMinWidth: 80,
    highMinHeight: 40,
    lowMaxPixels: 40,
  },
  changeDetection: {
    enabled: false,
    sections: [],
    textNormalize: ['num', 'id', 'time', 'money', 'count'],
    severity: {
      contentOnly: 'info',
      structureOnly: 'warning',
      structureAndPixel: 'blocker',
    },
  },
};

const CONFIG_PATH = path.join(process.cwd(), 'config/ui-regression.json');

let cached: UiRegressionConfig | null = null;
const runtimeStyleChecks = new Map<string, StyleCheckItem[]>();

export function registerRuntimeStyleChecks(scriptKey: string, items: StyleCheckItem[]): void {
  runtimeStyleChecks.set(scriptKey, items);
}

export function clearRuntimeStyleChecks(): void {
  runtimeStyleChecks.clear();
}

/** 清除缓存并重新加载配置（用于配置变更后热更新） */
export function reloadUiRegressionConfig(): UiRegressionConfig {
  cached = null;
  return loadUiRegressionConfig();
}

export function loadUiRegressionConfig(): UiRegressionConfig {
  if (cached) return cached;

  let merged = { ...DEFAULT_CONFIG };
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Partial<UiRegressionConfig>;
      merged = {
        ...DEFAULT_CONFIG,
        ...raw,
        screenshot: { ...DEFAULT_CONFIG.screenshot, ...raw.screenshot },
        crossBrowser: { ...DEFAULT_CONFIG.crossBrowser, ...raw.crossBrowser },
        autoPromote: {
          ...DEFAULT_CONFIG.autoPromote,
          ...raw.autoPromote,
        } as NonNullable<UiRegressionConfig['autoPromote']>,
        structureChecks: { ...DEFAULT_CONFIG.structureChecks, ...raw.structureChecks },
        styleChecks: {
          ...DEFAULT_CONFIG.styleChecks,
          ...raw.styleChecks,
          tolerance: { ...DEFAULT_CONFIG.styleChecks.tolerance, ...raw.styleChecks?.tolerance },
          items: raw.styleChecks?.items ?? DEFAULT_CONFIG.styleChecks.items,
        },
        gate: { ...DEFAULT_CONFIG.gate, ...raw.gate },
        aiReview: { ...DEFAULT_CONFIG.aiReview, ...raw.aiReview } as AiReviewConfig,
        diffRegions: { ...DEFAULT_CONFIG.diffRegions, ...raw.diffRegions } as DiffRegionsConfig,
        changeDetection: { ...DEFAULT_CONFIG.changeDetection, ...raw.changeDetection } as ChangeDetectionConfig,
        viewports: raw.viewports?.length ? raw.viewports : DEFAULT_CONFIG.viewports,
      };
    } catch (e) {
      console.warn(`⚠️  无法解析 ${CONFIG_PATH}，使用默认配置`, e);
    }
  }

  const envStrategy = process.env.PLAYWRIGHT_COMPARE_BASELINE?.toLowerCase();
  if (
    envStrategy === 'hybrid' ||
    envStrategy === 'golden' ||
    envStrategy === 'last-green' ||
    envStrategy === 'oldest'
  ) {
    merged.baselineStrategy = envStrategy;
  }

  cached = merged;
  return merged;
}

/** 同浏览器 golden / run-drift 等对比的 pixelmatch 参数（由 compare-screenshots 环境变量控制） */
export function resolveSameBrowserPixelmatch(): PixelmatchOptions {
  let threshold = 0.06;
  const envThreshold = process.env.PLAYWRIGHT_PIXELMATCH_THRESHOLD;
  if (envThreshold !== undefined && envThreshold !== '' && !Number.isNaN(Number.parseFloat(envThreshold))) {
    threshold = Number.parseFloat(envThreshold);
  }

  let includeAA = true;
  const envAa = (process.env.PLAYWRIGHT_PIXELMATCH_INCLUDE_AA ?? '').toLowerCase();
  if (envAa === '0' || envAa === 'false' || envAa === 'no') includeAA = false;

  return { threshold, includeAA };
}

/** 跨浏览器对比专用 pixelmatch 参数（默认可比同浏览器更宽松） */
export function resolveCrossBrowserPixelmatch(): PixelmatchOptions {
  const cfg = loadUiRegressionConfig();
  let threshold = cfg.crossBrowser.pixelmatchThreshold;
  let includeAA = cfg.crossBrowser.includeAA;

  const envThreshold = process.env.PLAYWRIGHT_CROSS_BROWSER_PIXELMATCH_THRESHOLD;
  if (envThreshold !== undefined && envThreshold !== '' && !Number.isNaN(Number.parseFloat(envThreshold))) {
    threshold = Number.parseFloat(envThreshold);
  }

  const envAa = (process.env.PLAYWRIGHT_CROSS_BROWSER_PIXELMATCH_INCLUDE_AA ?? '').toLowerCase();
  if (envAa === '0' || envAa === 'false' || envAa === 'no') includeAA = false;
  if (envAa === '1' || envAa === 'true' || envAa === 'yes') includeAA = true;

  return { threshold, includeAA };
}

export function resolveCompareCrossBrowser(): boolean {
  const env = process.env.PLAYWRIGHT_COMPARE_CROSS_BROWSER?.trim();
  if (env) {
    const v = env.toLowerCase();
    if (v === '0' || v === 'false' || v === 'no') return false;
    if (v === '1' || v === 'true' || v === 'yes') return true;
  }
  return loadUiRegressionConfig().compareCrossBrowser !== false;
}

export function resolveBaselineStrategy(): BaselineStrategy {
  return loadUiRegressionConfig().baselineStrategy;
}

/** region/mask 的 script 与 testDir / 截图路径 scriptKey 对齐（支持带 env 前缀） */
export function scriptKeyMatches(regionScript: string | undefined, scriptKey: string | undefined): boolean {
  if (!regionScript) return true;
  if (!scriptKey) return false;
  if (scriptKey === regionScript) return true;
  if (scriptKey.endsWith(`/${regionScript}`)) return true;
  return scriptKey.includes(regionScript);
}

export function resolveDefaultBrowsers(): string[] {
  return loadUiRegressionConfig().defaultBrowsers;
}

export function resolveIgnoreRegions(scriptKey?: string): IgnoreRegion[] {
  return loadUiRegressionConfig().ignoreRegions.filter((r) => scriptKeyMatches(r.script, scriptKey));
}

export function resolveMaskSelectors(scriptKey?: string): string[] {
  const out: string[] = [];
  for (const item of loadUiRegressionConfig().maskSelectors) {
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    if (item?.selector && scriptKeyMatches(item.script, scriptKey)) {
      out.push(item.selector);
    }
  }
  return out;
}

function activeViewports(all: SnapshotViewport[]): SnapshotViewport[] {
  return all.filter((v) => v.enabled !== false);
}

export function resolveSnapshotViewports(): SnapshotViewport[] {
  const all = activeViewports(loadUiRegressionConfig().viewports);
  const env = process.env.SCREENSHOT_VIEWPORTS?.trim();
  if (!env) {
    const def = all.find((v) => v.default) || all[0];
    return def ? [def] : all.slice(0, 1);
  }
  if (env === 'all') return all;
  const names = new Set(env.split(',').map((s) => s.trim()).filter(Boolean));
  const picked = all.filter((v) => names.has(v.name));
  return picked.length ? picked : [all.find((v) => v.default) || all[0]!];
}

export function isDisabledViewportScreenshot(fileName: string): boolean {
  const inactive = loadUiRegressionConfig().viewports.filter((v) => v.enabled === false);
  for (const vp of inactive) {
    if (fileName.endsWith(`__${vp.name}.png`)) return true;
  }
  return false;
}

export function resolveStructureCheckItems(scriptKey?: string): StructureCheckItem[] {
  const items = loadUiRegressionConfig().structureChecks?.items || [];
  return items.filter((item) => scriptKeyMatches(item.script, scriptKey));
}

export function resolveStyleCheckItems(scriptKey?: string): StyleCheckItem[] {
  const fromConfig = loadUiRegressionConfig().styleChecks?.items || [];
  const configFiltered = fromConfig.filter((item) => scriptKeyMatches(item.script, scriptKey));
  const runtime = scriptKey ? runtimeStyleChecks.get(scriptKey) || [] : [];
  const keys = new Set(runtime.map((i) => i.key));
  return [...runtime, ...configFiltered.filter((i) => !keys.has(i.key))];
}

export function snapshotFromStepName(stepName: string): { snapshotName?: string; state?: string } {
  const i = stepName.indexOf('__');
  if (i <= 0) return {};
  return { snapshotName: stepName.slice(0, i), state: stepName.slice(i + 2) || 'normal' };
}

export function resolveSnapshotContext(
  meta?: { snapshotName?: string; state?: string } | null,
  stepName?: string,
): { snapshotName?: string; state?: string } {
  if (meta?.snapshotName) return { snapshotName: meta.snapshotName, state: meta.state || 'normal' };
  if (stepName) return snapshotFromStepName(stepName);
  return {};
}

export function filterCheckItemsBySnapshot<T extends { snapshotName?: string; state?: string }>(
  items: T[],
  snap?: { snapshotName?: string; state?: string },
): T[] {
  return items.filter((item) => {
    if (!item.snapshotName) return true;
    if (!snap?.snapshotName) return false;
    if (item.snapshotName !== snap.snapshotName) return false;
    if (item.state && item.state !== (snap.state || 'normal')) return false;
    return true;
  });
}

export function resolveCompareRunDrift(): boolean {
  return loadUiRegressionConfig().compareRunDrift === true;
}

export function resolveGateMode(): GateConfig['mode'] {
  return loadUiRegressionConfig().gate?.mode || 'style-only';
}

export function resolvePixelScriptPrefixes(): string[] {
  const prefixes = loadUiRegressionConfig().gate?.pixelScriptPrefixes;
  return Array.isArray(prefixes) ? prefixes.filter((p) => typeof p === 'string' && p.trim()) : [];
}

export function scriptKeyHitsPixelGate(scriptKey: string | undefined): boolean {
  const key = String(scriptKey || '').replace(/\\/g, '/');
  if (!key) return false;
  return resolvePixelScriptPrefixes().some((prefix) => key === prefix || key.startsWith(prefix));
}

export function resolveScreenshotFullPage(): boolean {
  return loadUiRegressionConfig().screenshot?.fullPage === true;
}

/**
 * 截图基准视口 + DPR。像素比对要求当前图与基线图尺寸严格一致，
 * 因此非 Playwright 引擎（如 ego）也必须复用这里的值来覆盖真实窗口大小。
 */
export function resolveScreenshotViewport(): { width: number; height: number; deviceScaleFactor: number } {
  const cfg = loadUiRegressionConfig();
  const vp = resolveSnapshotViewports()[0] || cfg.viewports[0];
  const dsf = Number(cfg.screenshot?.deviceScaleFactor);
  return {
    width: Number(vp?.width) > 0 ? Number(vp.width) : 1280,
    height: Number(vp?.height) > 0 ? Number(vp.height) : 720,
    deviceScaleFactor: Number.isFinite(dsf) && dsf > 0 ? dsf : 1,
  };
}

export function resolveAiReviewConfig(): AiReviewConfig {
  const base = { ...(loadUiRegressionConfig().aiReview ?? DEFAULT_CONFIG.aiReview!) };
  const env = process.env.PLAYWRIGHT_UI_AI_REVIEW?.trim().toLowerCase();
  if (env === '1' || env === 'true' || env === 'yes') base.enabled = true;
  if (env === '0' || env === 'false' || env === 'no') base.enabled = false;
  return base;
}

export function resolveDiffRegionsConfig(): DiffRegionsConfig {
  return { ...(loadUiRegressionConfig().diffRegions ?? DEFAULT_CONFIG.diffRegions!) };
}

export function resolveChangeDetectionConfig(): ChangeDetectionConfig {
  return { ...(loadUiRegressionConfig().changeDetection ?? DEFAULT_CONFIG.changeDetection!) };
}

/** 变化检测分区：优先 changeDetection.sections；为空时不额外采集（仍可由 structureChecks 派生） */
export function resolveChangeDetectionSections(): ChangeDetectionSection[] {
  const cfg = resolveChangeDetectionConfig();
  if (!cfg.enabled) return [];
  return Array.isArray(cfg.sections) ? cfg.sections.filter((s) => s?.key && s?.selector) : [];
}

/** 从 Golden 基线 meta 回填元素指纹，供主 selector 失效时兜底定位 */
export function loadGoldenSelectorFingerprints(
  scriptKey: string | undefined,
): Record<string, ElementFingerprint> {
  if (!scriptKey) return {};
  const root = path.join('screenshots-baseline', scriptKey);
  if (!fs.existsSync(root)) return {};
  const out: Record<string, ElementFingerprint> = {};
  const walk = (dir: string) => {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith('.meta.json')) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(full, 'utf-8')) as {
          selectors?: Record<string, { fingerprint?: ElementFingerprint }>;
        };
        for (const [key, probe] of Object.entries(meta.selectors || {})) {
          if (probe?.fingerprint && !out[key]) out[key] = probe.fingerprint;
        }
      } catch {
        /* ignore */
      }
    }
  };
  walk(root);
  return out;
}

export function enrichStructureItemsWithFingerprints(
  scriptKey: string | undefined,
  items: StructureCheckItem[],
): StructureCheckItem[] {
  if (!items.length) return items;
  const fps = loadGoldenSelectorFingerprints(scriptKey);
  if (!Object.keys(fps).length) return items;
  return items.map((item) => ({
    ...item,
    fingerprint: item.fingerprint || fps[item.key],
  }));
}

/** 从截图路径解析 scriptKey，如 screenshots/stage/260612/foo/run-chromium-optimized/ts/step.png */
export function scriptKeyFromScreenshotPath(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, '/');
  const m = normalized.match(/screenshots\/(.+?)\/run-(?:chromium|webkit|firefox|safari|edge)-/i);
  if (m?.[1]) return m[1];
  const legacy = normalized.match(/screenshots\/(.+?)\/[^/]+\/step-/);
  return legacy?.[1];
}
