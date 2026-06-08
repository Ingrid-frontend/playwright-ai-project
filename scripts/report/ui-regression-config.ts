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
  };
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
    blockerRatio: 0.01,
    warningRatio: 0.003,
    countAsBlockerInGate: false,
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

export function resolveBaselineStrategy(): BaselineStrategy {
  return loadUiRegressionConfig().baselineStrategy;
}
