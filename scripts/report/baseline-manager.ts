import fs from 'fs';
import path from 'path';
import { isDisabledViewportScreenshot } from './ui-regression-config.js';
import { assertRunEligibleForGolden, assertStepMetasEligibleForGolden } from '../../src/utils/baseline-quality.js';

export const BASELINE_ROOT = 'screenshots-baseline';
export const UI_REGRESSION_DIR = 'results/ui-regression';
export const MANIFEST_PATH = path.join(UI_REGRESSION_DIR, 'baseline-manifest.json');
export const LAST_GREEN_PATH = path.join(UI_REGRESSION_DIR, 'last-green-run.json');
export const BASELINE_META_FILE = '.baseline-meta.json';
export const BASELINE_LOCK_DIR = '.baseline-lock';

export interface BaselineMeta {
  revision: number;
  promotedAt: string;
  promotedBy?: string;
  sourceRun?: string;
}

const LOCK_TTL_MS = 10 * 60 * 1000;

function baselineMetaPath(goldenDir: string): string {
  return path.join(goldenDir, BASELINE_META_FILE);
}

export function readBaselineMeta(goldenDir: string): BaselineMeta | null {
  const p = baselineMetaPath(goldenDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as BaselineMeta;
  } catch {
    return null;
  }
}

function writeBaselineMeta(goldenDir: string, meta: BaselineMeta): void {
  ensureDir(goldenDir);
  writeJson(baselineMetaPath(goldenDir), meta);
}

function cleanupStaleLock(lockDir: string): void {
  if (!fs.existsSync(lockDir)) return;
  try {
    const stat = fs.statSync(lockDir);
    if (Date.now() - stat.mtimeMs > LOCK_TTL_MS) {
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
}

export function acquireBaselineLock(goldenDir: string, promotedBy?: string): void {
  ensureDir(goldenDir);
  const lockDir = path.join(goldenDir, BASELINE_LOCK_DIR);
  cleanupStaleLock(lockDir);
  try {
    fs.mkdirSync(lockDir);
    fs.writeFileSync(
      path.join(lockDir, 'info.json'),
      JSON.stringify({ pid: process.pid, at: new Date().toISOString(), promotedBy: promotedBy || '' }),
    );
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
    if (code === 'EEXIST') {
      throw new Error(`基线目录被锁定，请稍后重试: ${lockDir}`);
    }
    throw new Error(
      `无法创建基线锁 ${lockDir}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function releaseBaselineLock(goldenDir: string): void {
  const lockDir = path.join(goldenDir, BASELINE_LOCK_DIR);
  try {
    if (fs.existsSync(lockDir)) fs.rmSync(lockDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function assertExpectedRevision(goldenDir: string, expectedRevision?: number): number {
  const cur = readBaselineMeta(goldenDir);
  const revision = cur?.revision ?? 0;
  if (expectedRevision !== undefined && expectedRevision !== revision) {
    throw new Error(
      `基线 revision 不匹配：当前 ${revision}，期望 ${expectedRevision}。请先拉取最新基线再晋升。`,
    );
  }
  return revision;
}

function bumpBaselineRevision(
  goldenDir: string,
  opts: { promotedBy?: string; sourceRun?: string },
  prevRevision: number,
): BaselineMeta {
  const meta: BaselineMeta = {
    revision: prevRevision + 1,
    promotedAt: new Date().toISOString(),
    promotedBy: opts.promotedBy,
    sourceRun: opts.sourceRun,
  };
  writeBaselineMeta(goldenDir, meta);
  return meta;
}

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

/** 是否已有可对比的 Golden 基线（至少一张 step PNG） */
export function hasGoldenBaseline(scriptKey: string, browser = 'chrome'): boolean {
  const dir = goldenDirForScript(scriptKey, browserToRunSegment(browser));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  return fs.readdirSync(dir).some((f) => f.endsWith('.png') && f.startsWith('step-'));
}

function browserRunPrefix(browser: string): string {
  const b = browser.toLowerCase();
  if (b === 'webkit') return 'run-webkit-';
  if (b === 'firefox') return 'run-firefox-';
  return 'run-chromium-';
}

/** Intent 旧目录 run-chromium-{stamp} 与现约定 run-*-optimized/{stamp} */
export function resolveSourceRunDir(opts: {
  scriptKey: string;
  sourceRunTimestamp: string;
  browser?: string;
  screenshotsRoot?: string;
}): string {
  const screenshotsRoot = opts.screenshotsRoot || 'screenshots';
  const browser = opts.browser || 'chrome';
  const ts = opts.sourceRunTimestamp;
  const runSegment = browserToRunSegment(browser);
  const prefix = browserRunPrefix(browser);
  const candidates = [
    path.join(screenshotsRoot, opts.scriptKey, runSegment, ts),
    path.join(screenshotsRoot, opts.scriptKey, `${prefix}${ts}`),
    path.join(screenshotsRoot, opts.scriptKey, ts),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  throw new Error(`源运行目录不存在: ${candidates[0]}`);
}

export function findLatestRunTimestamp(
  scriptKey: string,
  browser = 'chrome',
  screenshotsRoot = 'screenshots',
): string | null {
  const prefix = browserRunPrefix(browser);
  const runSegment = browserToRunSegment(browser);
  const hits: Array<{ ts: string; mtime: number }> = [];

  const optimizedRoot = path.join(screenshotsRoot, scriptKey, runSegment);
  if (fs.existsSync(optimizedRoot) && fs.statSync(optimizedRoot).isDirectory()) {
    for (const name of fs.readdirSync(optimizedRoot)) {
      const abs = path.join(optimizedRoot, name);
      if (!fs.statSync(abs).isDirectory()) continue;
      hits.push({ ts: name, mtime: fs.statSync(abs).mtimeMs });
    }
  }

  const scriptRoot = path.join(screenshotsRoot, scriptKey);
  if (fs.existsSync(scriptRoot) && fs.statSync(scriptRoot).isDirectory()) {
    for (const name of fs.readdirSync(scriptRoot)) {
      if (name === runSegment || !name.startsWith(prefix)) continue;
      const abs = path.join(scriptRoot, name);
      if (!fs.statSync(abs).isDirectory()) continue;
      hits.push({ ts: name.slice(prefix.length), mtime: fs.statSync(abs).mtimeMs });
    }
  }

  hits.sort((a, b) => b.mtime - a.mtime);
  return hits[0]?.ts || null;
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
  expectedRevision?: number;
  promotedBy?: string;
}): { copied: number; goldenDir: string; revision: number } {
  const screenshotsRoot = opts.screenshotsRoot || 'screenshots';
  const browser = opts.browser || 'chrome';
  const runSegment = browserToRunSegment(browser);
  const sourceDir = resolveSourceRunDir({
    scriptKey: opts.scriptKey,
    sourceRunTimestamp: opts.sourceRunTimestamp,
    browser,
    screenshotsRoot,
  });

  assertRunEligibleForGolden(sourceDir);

  const goldenDir = goldenDirForScript(opts.scriptKey, runSegment);
  acquireBaselineLock(goldenDir, opts.promotedBy);
  const prevRevision = assertExpectedRevision(goldenDir, opts.expectedRevision);

  const pngs = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.png') && f.startsWith('step-'));

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

    const meta = bumpBaselineRevision(goldenDir, {
      promotedBy: opts.promotedBy,
      sourceRun: opts.sourceRunTimestamp,
    }, prevRevision);

    return { copied, goldenDir, revision: meta.revision };
  } catch (err) {
    // 失败时回滚：恢复备份、清理临时目录
    if (bakDir && fs.existsSync(bakDir) && !fs.existsSync(goldenDir)) {
      try { fs.renameSync(bakDir, goldenDir); } catch { /* 回滚失败则跳过 */ }
    }
    if (fs.existsSync(tmpDir)) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    }
    throw err;
  } finally {
    releaseBaselineLock(goldenDir);
  }
}

export function promoteStepsToGolden(opts: {
  scriptKey: string;
  sourceRunTimestamp: string;
  browser?: string;
  stepFileNames: string[];
  screenshotsRoot?: string;
  expectedRevision?: number;
  promotedBy?: string;
}): { copied: number; goldenDir: string; revision: number } {
  const screenshotsRoot = opts.screenshotsRoot || 'screenshots';
  const browser = opts.browser || 'chrome';
  const runSegment = browserToRunSegment(browser);
  const sourceDir = resolveSourceRunDir({
    scriptKey: opts.scriptKey,
    sourceRunTimestamp: opts.sourceRunTimestamp,
    browser,
    screenshotsRoot,
  });

  const names = [...new Set(opts.stepFileNames.map((n) => path.basename(n)).filter((n) => n.endsWith('.png')))];
  if (!names.length) {
    throw new Error('promoteStepsToGolden 需要至少一个 step PNG 文件名');
  }

  assertStepMetasEligibleForGolden(sourceDir, names);

  const goldenDir = goldenDirForScript(opts.scriptKey, runSegment);
  acquireBaselineLock(goldenDir, opts.promotedBy);
  const prevRevision = assertExpectedRevision(goldenDir, opts.expectedRevision);
  try {
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

  const meta = bumpBaselineRevision(goldenDir, {
    promotedBy: opts.promotedBy,
    sourceRun: opts.sourceRunTimestamp,
  }, prevRevision);

  return { copied, goldenDir, revision: meta.revision };
  } finally {
    releaseBaselineLock(goldenDir);
  }
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

/** step-01-foo.png / step-2-foo.png → foo */
export function stepSemanticKey(stepFileName: string): string | null {
  const base = path.basename(stepFileName);
  const m = base.match(/^step-(\d+)-(.+)\.png$/i);
  return m ? m[2]! : null;
}

function stepOrdinal(stepFileName: string): number | null {
  const m = path.basename(stepFileName).match(/^step-(\d+)-/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * 在目录中解析步骤 PNG：精确名 → 语义后缀（忽略 step 序号）→ snapshotName__state。
 * 多匹配且无法用序号消歧时返回 null（计为未检测，不瞎选）。
 */
export function findStepPngInDir(dir: string, stepFileName: string): string | null {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const wantName = path.basename(stepFileName);
  const exact = path.join(dir, wantName);
  if (fs.existsSync(exact)) return exact;

  const semantic = stepSemanticKey(wantName);
  if (!semantic) return null;

  const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png') && /^step-\d+-/i.test(f));
  const bySemantic = pngs.filter((f) => stepSemanticKey(f) === semantic);
  if (bySemantic.length === 1) return path.join(dir, bySemantic[0]!);
  if (bySemantic.length > 1) {
    const wantOrd = stepOrdinal(wantName);
    if (wantOrd != null) {
      const sameOrd = bySemantic.filter((f) => stepOrdinal(f) === wantOrd);
      if (sameOrd.length === 1) return path.join(dir, sameOrd[0]!);
    }
    console.warn(
      `[baseline] 多基线匹配跳过: dir=${dir} want=${wantName} hits=${bySemantic.join(',')}`,
    );
    return null;
  }

  const snapSep = semantic.indexOf('__');
  if (snapSep > 0) {
    const snapshotName = semantic.slice(0, snapSep);
    const rest = semantic.slice(snapSep + 2);
    const state = rest.includes('__') ? rest.slice(0, rest.indexOf('__')) : rest || 'normal';
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.meta.json')) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8')) as {
          snapshotName?: string;
          state?: string;
        };
        if (meta.snapshotName === snapshotName && (meta.state || 'normal') === state) {
          const pngPath = path.join(dir, name.replace(/\.meta\.json$/i, '.png'));
          if (fs.existsSync(pngPath)) return pngPath;
        }
      } catch {
        /* skip */
      }
    }
  }

  return null;
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
  const runDir = path.join(
    screenshotsRoot,
    scriptKey,
    entry.runSegment,
    entry.runTimestamp,
  );
  return findStepPngInDir(runDir, stepFileName);
}

export function getGoldenScreenshotPath(
  scriptKey: string,
  browser: string,
  stepFileName: string,
): string | null {
  const runSegment = browserToRunSegment(browser);
  return findStepPngInDir(goldenDirForScript(scriptKey, runSegment), stepFileName);
}

export function getGoldenBySnapshot(
  scriptKey: string,
  browser: string,
  snapshotName: string,
  state: string,
): { pngPath: string; metaPath: string } | null {
  const runSegment = browserToRunSegment(browser);
  const dir = goldenDirForScript(scriptKey, runSegment);
  if (!fs.existsSync(dir)) return null;

  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.meta.json')) continue;
    const metaPath = path.join(dir, name);
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
        snapshotName?: string;
        state?: string;
      };
      if (meta.snapshotName === snapshotName && (meta.state || 'normal') === state) {
        const pngPath = metaPath.replace(/\.meta\.json$/i, '.png');
        if (fs.existsSync(pngPath)) return { pngPath, metaPath };
      }
    } catch {
      /* skip */
    }
  }

  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.png')) continue;
    const match = name.match(/step-\d+-(.+)\.png$/i);
    if (!match) continue;
    const part = match[1]!;
    const j = part.indexOf('__');
    if (j <= 0) continue;
    if (part.slice(0, j) === snapshotName && part.slice(j + 2) === state) {
      const pngPath = path.join(dir, name);
      return { pngPath, metaPath: metaPathForPng(pngPath) };
    }
  }
  return null;
}

function metaPathForPng(pngPath: string): string {
  return pngPath.replace(/\.png$/i, '.meta.json');
}

export function stepFileNameFromScreenshot(fullPath: string): string {
  return path.basename(fullPath);
}
