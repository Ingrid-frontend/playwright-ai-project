import fs from 'fs';
import path from 'path';
import { isDisabledViewportScreenshot } from './ui-regression-config.js';
import { assertRunEligibleForGolden } from '../../src/utils/baseline-quality.js';

export const BASELINE_ROOT = 'screenshots-baseline';
export const UI_REGRESSION_DIR = 'results/ui-regression';
export const MANIFEST_PATH = path.join(UI_REGRESSION_DIR, 'baseline-manifest.json');
export const LAST_GREEN_PATH = path.join(UI_REGRESSION_DIR, 'last-green-run.json');

export type ResolvedBaselineKind = 'golden' | 'last-green' | 'oldest';

export interface BaselineManifestEntry {
  scriptKey: string;
  browser: string;
  runSegment: string;
  sourceRunTimestamp: string;
  promotedAt: string;
  sourceScreenshotDir: string;
  promotedSteps?: string[];
}

export interface BaselineManifest {
  version: 1;
  entries: BaselineManifestEntry[];
}

export interface LastGreenRunMap {
  [scriptKey: string]: {
    [browser: string]: {
      runTimestamp: string;
      recordedAt: string;
      runSegment: string;
    };
  };
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function browserToRunSegment(browser: string): string {
  const b = browser.toLowerCase();
  if (b === 'webkit') return 'run-webkit-optimized';
  if (b === 'firefox') return 'run-firefox-optimized';
  return 'run-chromium-optimized';
}

export function runSegmentToBrowser(runSegment: string): string {
  if (/webkit/i.test(runSegment)) return 'webkit';
  if (/firefox/i.test(runSegment)) return 'firefox';
  return 'chrome';
}

export function goldenDirForScript(scriptKey: string, runSegment: string): string {
  return path.join(BASELINE_ROOT, scriptKey, runSegment);
}

export function goldenFilePath(scriptKey: string, runSegment: string, stepFileName: string): string {
  return path.join(goldenDirForScript(scriptKey, runSegment), stepFileName);
}

export function loadManifest(): BaselineManifest {
  return readJson<BaselineManifest>(MANIFEST_PATH, { version: 1, entries: [] });
}

export function saveManifest(manifest: BaselineManifest): void {
  writeJson(MANIFEST_PATH, manifest);
}

export function loadLastGreenMap(): LastGreenRunMap {
  return readJson<LastGreenRunMap>(LAST_GREEN_PATH, {});
}

export function saveLastGreenMap(map: LastGreenRunMap): void {
  writeJson(LAST_GREEN_PATH, map);
}

export function recordLastGreenRun(
  scriptKey: string,
  browser: string,
  runTimestamp: string,
  runSegment?: string,
): void {
  const map = loadLastGreenMap();
  if (!map[scriptKey]) map[scriptKey] = {};
  map[scriptKey][browser] = {
    runTimestamp,
    recordedAt: new Date().toISOString(),
    runSegment: runSegment || browserToRunSegment(browser),
  };
  saveLastGreenMap(map);
}

export function hasGoldenStep(scriptKey: string, runSegment: string, stepFileName: string): boolean {
  return fs.existsSync(goldenFilePath(scriptKey, runSegment, stepFileName));
}

export function promoteRunToGolden(opts: {
  scriptKey: string;
  sourceRunTimestamp: string;
  browser?: string;
  screenshotsRoot?: string;
}): { copied: number; goldenDir: string } {
  const screenshotsRoot = opts.screenshotsRoot || 'screenshots';
  const browser = opts.browser || 'chrome';
  const runSegment = browserToRunSegment(browser);
  const sourceDir = path.join(
    screenshotsRoot,
    opts.scriptKey,
    runSegment,
    opts.sourceRunTimestamp,
  );

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`源运行目录不存在: ${sourceDir}`);
  }

  assertRunEligibleForGolden(sourceDir);

  const goldenDir = goldenDirForScript(opts.scriptKey, runSegment);
  const pngs = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.png') && f.startsWith('step-'));

  // 原子操作：先复制到临时目录，再 rename 替换旧基线
  const tmpDir = `${goldenDir}.tmp-${Date.now()}`;
  const bakDir = fs.existsSync(goldenDir) ? `${goldenDir}.bak-${Date.now()}` : null;
  try {
    ensureDir(tmpDir);
    let copied = 0;
    for (const file of pngs) {
      if (isDisabledViewportScreenshot(file)) continue;
      fs.copyFileSync(path.join(sourceDir, file), path.join(tmpDir, file));
      copied++;
      const meta = file.replace(/\.png$/i, '.meta.json');
      const metaSrc = path.join(sourceDir, meta);
      if (fs.existsSync(metaSrc)) {
        fs.copyFileSync(metaSrc, path.join(tmpDir, meta));
      }
    }
    // 旧基线重命名为备份（原子），临时目录 rename 为正式基线
    if (bakDir) fs.renameSync(goldenDir, bakDir);
    fs.renameSync(tmpDir, goldenDir);
    // 成功后清理备份
    if (bakDir) {
      try { fs.rmSync(bakDir, { recursive: true, force: true }); } catch { /* 忽略清理失败 */ }
    }

    const manifest = loadManifest();
    manifest.entries = manifest.entries.filter(
      (e) => !(e.scriptKey === opts.scriptKey && e.browser === browser),
    );
    manifest.entries.push({
      scriptKey: opts.scriptKey,
      browser,
      runSegment,
      sourceRunTimestamp: opts.sourceRunTimestamp,
      promotedAt: new Date().toISOString(),
      sourceScreenshotDir: sourceDir,
    });
    saveManifest(manifest);

    return { copied, goldenDir };
  } catch (err) {
    // 失败时回滚：恢复备份、清理临时目录
    if (bakDir && fs.existsSync(bakDir) && !fs.existsSync(goldenDir)) {
      try { fs.renameSync(bakDir, goldenDir); } catch { /* 回滚失败则跳过 */ }
    }
    if (fs.existsSync(tmpDir)) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    }
    throw err;
  }
}

export function promoteStepsToGolden(opts: {
  scriptKey: string;
  sourceRunTimestamp: string;
  browser?: string;
  stepFileNames: string[];
  screenshotsRoot?: string;
}): { copied: number; goldenDir: string } {
  const screenshotsRoot = opts.screenshotsRoot || 'screenshots';
  const browser = opts.browser || 'chrome';
  const runSegment = browserToRunSegment(browser);
  const sourceDir = path.join(
    screenshotsRoot,
    opts.scriptKey,
    runSegment,
    opts.sourceRunTimestamp,
  );

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`源运行目录不存在: ${sourceDir}`);
  }

  assertRunEligibleForGolden(sourceDir);

  const names = [...new Set(opts.stepFileNames.map((n) => path.basename(n)).filter((n) => n.endsWith('.png')))];
  if (!names.length) {
    throw new Error('promoteStepsToGolden 需要至少一个 step PNG 文件名');
  }

  const goldenDir = goldenDirForScript(opts.scriptKey, runSegment);
  ensureDir(goldenDir);

  let copied = 0;
  for (const file of names) {
    if (isDisabledViewportScreenshot(file)) continue;
    const src = path.join(sourceDir, file);
    if (!fs.existsSync(src)) {
      throw new Error(`源截图不存在: ${src}`);
    }
    const dest = path.join(goldenDir, file);
    const tmp = `${dest}.tmp-${Date.now()}`;
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dest);
    copied++;
    const meta = file.replace(/\.png$/i, '.meta.json');
    const metaSrc = path.join(sourceDir, meta);
    if (fs.existsSync(metaSrc)) {
      const metaDest = path.join(goldenDir, meta);
      const metaTmp = `${metaDest}.tmp-${Date.now()}`;
      fs.copyFileSync(metaSrc, metaTmp);
      fs.renameSync(metaTmp, metaDest);
    }
  }

  const manifest = loadManifest();
  const existing = manifest.entries.find((e) => e.scriptKey === opts.scriptKey && e.browser === browser);
  const prevSteps = existing?.promotedSteps || [];
  manifest.entries = manifest.entries.filter(
    (e) => !(e.scriptKey === opts.scriptKey && e.browser === browser),
  );
  manifest.entries.push({
    scriptKey: opts.scriptKey,
    browser,
    runSegment,
    sourceRunTimestamp: opts.sourceRunTimestamp,
    promotedAt: new Date().toISOString(),
    sourceScreenshotDir: sourceDir,
    promotedSteps: [...new Set([...prevSteps, ...names])],
  });
  saveManifest(manifest);

  return { copied, goldenDir };
}

export function revertGolden(scriptKey: string, browser?: string): number {
  const manifest = loadManifest();
  let removed = 0;
  const targets = manifest.entries.filter((e) => {
    if (e.scriptKey !== scriptKey) return false;
    if (browser && e.browser !== browser) return false;
    return true;
  });

  for (const entry of targets) {
    const dir = goldenDirForScript(entry.scriptKey, entry.runSegment);
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.png') || f.endsWith('.meta.json')) {
          fs.unlinkSync(path.join(dir, f));
          if (f.endsWith('.png')) removed++;
        }
      }
    }
  }

  manifest.entries = manifest.entries.filter((e) => {
    if (e.scriptKey !== scriptKey) return true;
    if (browser && e.browser !== browser) return true;
    return false;
  });
  saveManifest(manifest);
  return removed;
}

export function resolveScreenshotPath(
  screenshotsRoot: string,
  scriptKey: string,
  runSegment: string,
  runTimestamp: string,
  stepFileName: string,
): string {
  return path.join(screenshotsRoot, scriptKey, runSegment, runTimestamp, stepFileName);
}

export function getLastGreenScreenshotPath(
  screenshotsRoot: string,
  scriptKey: string,
  browser: string,
  stepFileName: string,
): string | null {
  const map = loadLastGreenMap();
  const entry = map[scriptKey]?.[browser];
  if (!entry) return null;
  const p = resolveScreenshotPath(
    screenshotsRoot,
    scriptKey,
    entry.runSegment,
    entry.runTimestamp,
    stepFileName,
  );
  return fs.existsSync(p) ? p : null;
}

export function getGoldenScreenshotPath(
  scriptKey: string,
  browser: string,
  stepFileName: string,
): string | null {
  const runSegment = browserToRunSegment(browser);
  const p = goldenFilePath(scriptKey, runSegment, stepFileName);
  return fs.existsSync(p) ? p : null;
}

export function stepFileNameFromScreenshot(fullPath: string): string {
  return path.basename(fullPath);
}
