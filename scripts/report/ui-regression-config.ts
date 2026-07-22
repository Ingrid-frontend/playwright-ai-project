import fs from 'fs';
import path from 'path';

export type BaselineStrategy = 'hybrid' | 'golden' | 'last-green' | 'oldest';

export interface UiRegressionConfig {
  blockerRatio: number;
  warningRatio: number;
  diffOnlyTabMinRatio: number;
  defaultBrowsers: string[];
  compareCrossBrowser: boolean;
  baselineStrategy: BaselineStrategy;
  ignoreRegions: Array<{ x: number; y: number; width: number; height: number }>;
  maskSelectors: string[];
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
  defaultBrowsers: ['chrome', 'webkit'],
  compareCrossBrowser: true,
  baselineStrategy: 'hybrid',
  ignoreRegions: [],
  maskSelectors: [],
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
