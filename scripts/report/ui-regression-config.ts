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
}

export interface StructureCheckItem {
  key: string;
  selector: string;
  script?: string;
  required?: boolean;
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

export interface UiRegressionConfig {
  blockerRatio: number;
  warningRatio: number;
  diffOnlyTabMinRatio: number;
  defaultBrowsers: string[];
  compareCrossBrowser: boolean;
  baselineStrategy: BaselineStrategy;
  ignoreRegions: IgnoreRegion[];
  maskSelectors: MaskSelector[];
  viewports: SnapshotViewport[];
  structureChecks: StructureChecksConfig;
  screenshot: {
    freezeAnimations: boolean;
    deviceScaleFactor: number;
  };
  crossBrowser: {
    blockerRatio: number;
    warningRatio: number;
    countAsBlockerInGate: boolean;
    /** 跨浏览器 pixelmatch 颜色阈值（0~1），默认可比同浏览器更宽松 */
    pixelmatchThreshold: number;
    /** 跨浏览器是否将抗锯齿像素计为差异，默认 false 以降低引擎渲染噪声 */
    includeAA: boolean;
  };
  autoPromote?: {
    maxDiffRatio: number;
  };
}

export interface PixelmatchOptions {
  threshold: number;
  includeAA: boolean;
}

const DEFAULT_CONFIG: UiRegressionConfig = {
  blockerRatio: 0.005,
  warningRatio: 0.001,
  diffOnlyTabMinRatio: 0.003,
  defaultBrowsers: ['chrome', 'webkit', 'firefox'],
  compareCrossBrowser: true,
  baselineStrategy: 'hybrid',
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
  screenshot: {
    freezeAnimations: true,
    deviceScaleFactor: 1,
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
};

const CONFIG_PATH = path.join(process.cwd(), 'config/ui-regression.json');

let cached: UiRegressionConfig | null = null;

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
        autoPromote: { ...DEFAULT_CONFIG.autoPromote, ...raw.autoPromote },
        structureChecks: { ...DEFAULT_CONFIG.structureChecks, ...raw.structureChecks },
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

export function resolveSnapshotViewports(): SnapshotViewport[] {
  const all = loadUiRegressionConfig().viewports;
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

export function resolveStructureCheckItems(scriptKey?: string): StructureCheckItem[] {
  const items = loadUiRegressionConfig().structureChecks?.items || [];
  return items.filter((item) => scriptKeyMatches(item.script, scriptKey));
}

/** 从截图路径解析 scriptKey，如 screenshots/stage/260612/foo/run-chromium-optimized/ts/step.png */
export function scriptKeyFromScreenshotPath(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, '/');
  const m = normalized.match(/screenshots\/(.+?)\/run-(?:chromium|webkit|firefox|safari|edge)-/i);
  if (m?.[1]) return m[1];
  const legacy = normalized.match(/screenshots\/(.+?)\/[^/]+\/step-/);
  return legacy?.[1];
}
