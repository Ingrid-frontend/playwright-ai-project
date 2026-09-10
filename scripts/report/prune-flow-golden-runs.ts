#!/usr/bin/env tsx
/**
 * Golden 回归：与基线完全一致时，只保留「最新一次」run 的截图；
 * 更早的完全一致 run 清理截图，仅保留 .golden-match.json 判定结果。
 * 验收基线本身在 screenshots-baseline/，不在此清理。
 */
import fs from 'fs';
import path from 'path';
import { runTimestampSortKey } from './baseline-comparisons.js';
import {
  browserToFlowRunSegment,
  getGoldenScreenshotPath,
  hasGoldenBaseline,
  resolveSourceRunDir,
} from './baseline-manager.js';
import { compareImagesWithDiff } from './image-diff.js';
import { resolveCustomerReportConfig, resolveSameBrowserPixelmatch } from './ui-regression-config.js';

export const GOLDEN_MATCH_VERDICT = '.golden-match.json';

export type GoldenMatchVerdict = {
  match: boolean;
  checkedAt: string;
  scriptKey: string;
  runId: string;
  browser: string;
  steps: number;
  maxDifference: number;
  prunedScreenshots?: number;
};

export type PruneFlowGoldenResult = {
  currentMatch: boolean;
  prunedRunId?: string;
  prunedScreenshots?: number;
  prunedRuns?: Array<{ runId: string; prunedScreenshots: number }>;
  skipped?: string;
};

export function readGoldenMatchVerdict(runDir: string): GoldenMatchVerdict | null {
  return readVerdict(runDir);
}

export function readGoldenMatchVerdictForScriptRun(
  scriptPath: string,
  runId: string,
  browser = 'chrome',
): GoldenMatchVerdict | null {
  const runDir = path.join(scriptPath, browserToFlowRunSegment(browser), runId);
  if (!fs.existsSync(runDir)) return null;
  return readVerdict(runDir);
}

function readVerdict(runDir: string): GoldenMatchVerdict | null {
  const p = path.join(runDir, GOLDEN_MATCH_VERDICT);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as GoldenMatchVerdict;
  } catch {
    return null;
  }
}

function writeVerdict(runDir: string, verdict: GoldenMatchVerdict): void {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, GOLDEN_MATCH_VERDICT), JSON.stringify(verdict, null, 2), 'utf-8');
}

function listRunIds(scriptKey: string, browser: string, screenshotsRoot: string): string[] {
  const seg = browserToFlowRunSegment(browser);
  const root = path.join(screenshotsRoot, scriptKey, seg);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => {
      const abs = path.join(root, name);
      return fs.statSync(abs).isDirectory() && name !== GOLDEN_MATCH_VERDICT;
    })
    .sort((a, b) => runTimestampSortKey(a) - runTimestampSortKey(b));
}

function listStepPngs(runDir: string): string[] {
  if (!fs.existsSync(runDir)) return [];
  return fs
    .readdirSync(runDir)
    .filter((f) => f.endsWith('.png') && f.startsWith('step-'))
    .sort();
}

async function isRunGoldenPerfect(
  runDir: string,
  scriptKey: string,
  browser: string,
): Promise<{ match: boolean; steps: number; maxDifference: number }> {
  const pngs = listStepPngs(runDir);
  if (!pngs.length) return { match: false, steps: 0, maxDifference: 1 };

  const { threshold, includeAA } = resolveSameBrowserPixelmatch();
  const identicalRatio = resolveCustomerReportConfig().identicalRatio;
  let maxDifference = 0;

  for (const file of pngs) {
    const goldenPath = getGoldenScreenshotPath(scriptKey, browser, file);
    if (!goldenPath) return { match: false, steps: pngs.length, maxDifference: 1 };

    const currentPath = path.join(runDir, file);
    const result = await compareImagesWithDiff(goldenPath, currentPath, '', threshold, {
      includeAA,
      writeDiffImage: false,
      scriptKey,
    });
    maxDifference = Math.max(maxDifference, result.difference);
    if (result.sizeMismatch || result.difference > identicalRatio) {
      return { match: false, steps: pngs.length, maxDifference };
    }
  }

  return { match: true, steps: pngs.length, maxDifference };
}

function shouldPruneStaleGoldenRun(
  verdict: GoldenMatchVerdict | null,
  opts?: { aggressive?: boolean },
): boolean {
  if (!verdict) return true;
  if (verdict.match) return true;
  const cfg = resolveCustomerReportConfig();
  if (opts?.aggressive) {
    return verdict.maxDifference < cfg.multiSpotRegressRatio;
  }
  return verdict.maxDifference <= cfg.identicalRatio;
}

function pruneRunScreenshots(runDir: string): number {
  if (!fs.existsSync(runDir)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(runDir)) {
    if (name === GOLDEN_MATCH_VERDICT) continue;
    if (!name.endsWith('.png') && !name.endsWith('.meta.json')) continue;
    fs.unlinkSync(path.join(runDir, name));
    if (name.endsWith('.png')) removed++;
  }
  return removed;
}

function resolveRunDir(
  scriptKey: string,
  runId: string,
  browser: string,
  screenshotsRoot: string,
): string | null {
  try {
    return resolveSourceRunDir({
      scriptKey,
      sourceRunTimestamp: runId,
      browser,
      screenshotsRoot,
    });
  } catch {
    return null;
  }
}

/** 保留 keepRunId，清理更早且可视为冗余的一致 run 截图 */
export function pruneOlderMatchingGoldenRuns(opts: {
  repoRoot?: string;
  scriptKey: string;
  keepRunId: string;
  browser?: string;
  aggressive?: boolean;
}): Array<{ runId: string; prunedScreenshots: number }> {
  const repoRoot = opts.repoRoot || process.cwd();
  const browser = opts.browser || 'chrome';
  const scriptKey = opts.scriptKey.replace(/\\/g, '/').replace(/^\/+/, '');
  const screenshotsRoot = path.join(repoRoot, 'screenshots');
  const runIds = listRunIds(scriptKey, browser, screenshotsRoot);
  const keepIdx = runIds.indexOf(opts.keepRunId);
  if (keepIdx <= 0) return [];

  const pruned: Array<{ runId: string; prunedScreenshots: number }> = [];
  for (let i = 0; i < keepIdx; i++) {
    const oldRunId = runIds[i]!;
    const oldDir = resolveRunDir(scriptKey, oldRunId, browser, screenshotsRoot);
    if (!oldDir) continue;
    const oldVerdict = readVerdict(oldDir);
    if (!shouldPruneStaleGoldenRun(oldVerdict, { aggressive: opts.aggressive })) continue;
    if (!listStepPngs(oldDir).length) continue;
    const count = pruneRunScreenshots(oldDir);
    if (count > 0 && oldVerdict) {
      writeVerdict(oldDir, { ...oldVerdict, prunedScreenshots: count });
      pruned.push({ runId: oldRunId, prunedScreenshots: count });
      console.log(
        `[golden-prune] ${scriptKey} · 已清理 ${oldRunId} 的 ${count} 张截图（保留最新一致 run ${opts.keepRunId}）`,
      );
    }
  }
  return pruned;
}

/** 对已有 run 回填：找到最后一次完全一致的 run，清理更早的一致 run */
export function backfillPruneFlowGoldenRuns(opts: {
  repoRoot?: string;
  scriptKey: string;
  browser?: string;
}): PruneFlowGoldenResult {
  const repoRoot = opts.repoRoot || process.cwd();
  const browser = opts.browser || 'chrome';
  const scriptKey = opts.scriptKey.replace(/\\/g, '/').replace(/^\/+/, '');
  const screenshotsRoot = path.join(repoRoot, 'screenshots');

  if (process.env.FLOW_GOLDEN_PRUNE === '0') {
    return { currentMatch: false, skipped: 'FLOW_GOLDEN_PRUNE=0' };
  }
  if (!hasGoldenBaseline(scriptKey, browser)) {
    return { currentMatch: false, skipped: 'no-golden-baseline' };
  }

  const runIds = listRunIds(scriptKey, browser, screenshotsRoot);
  let keepRunId = '';
  for (let i = runIds.length - 1; i >= 0; i--) {
    const runId = runIds[i]!;
    const dir = resolveRunDir(scriptKey, runId, browser, screenshotsRoot);
    if (!dir) continue;
    const verdict = readVerdict(dir);
    if (verdict?.match) {
      keepRunId = runId;
      break;
    }
  }
  if (!keepRunId) return { currentMatch: false, skipped: 'no-match-run' };

  const prunedRuns = pruneOlderMatchingGoldenRuns({ repoRoot, scriptKey, keepRunId, browser, aggressive: true });
  return {
    currentMatch: true,
    prunedRunId: prunedRuns[prunedRuns.length - 1]?.runId,
    prunedScreenshots: prunedRuns.reduce((n, r) => n + r.prunedScreenshots, 0),
    prunedRuns,
  };
}

export async function pruneFlowGoldenRunScreenshots(opts: {
  repoRoot?: string;
  scriptKey: string;
  runId: string;
  browser?: string;
}): Promise<PruneFlowGoldenResult> {
  const repoRoot = opts.repoRoot || process.cwd();
  const browser = opts.browser || 'chrome';
  const scriptKey = opts.scriptKey.replace(/\\/g, '/').replace(/^\/+/, '');
  const runId = opts.runId.trim();
  const screenshotsRoot = path.join(repoRoot, 'screenshots');

  if (process.env.FLOW_GOLDEN_PRUNE === '0') {
    return { currentMatch: false, skipped: 'FLOW_GOLDEN_PRUNE=0' };
  }

  if (!hasGoldenBaseline(scriptKey, browser)) {
    return { currentMatch: false, skipped: 'no-golden-baseline' };
  }

  let runDir: string;
  try {
    runDir = resolveSourceRunDir({
      scriptKey,
      sourceRunTimestamp: runId,
      browser,
      screenshotsRoot,
    });
  } catch {
    return { currentMatch: false, skipped: 'run-dir-missing' };
  }

  const { match, steps, maxDifference } = await isRunGoldenPerfect(runDir, scriptKey, browser);
  const checkedAt = new Date().toISOString();

  writeVerdict(runDir, {
    match,
    checkedAt,
    scriptKey,
    runId,
    browser,
    steps,
    maxDifference,
  });

  if (!match) return { currentMatch: false };

  const prunedRuns = pruneOlderMatchingGoldenRuns({
    repoRoot,
    scriptKey,
    keepRunId: runId,
    browser,
  });
  if (!prunedRuns.length) return { currentMatch: true };

  const total = prunedRuns.reduce((n, r) => n + r.prunedScreenshots, 0);
  return {
    currentMatch: true,
    prunedRunId: prunedRuns[prunedRuns.length - 1]?.runId,
    prunedScreenshots: total,
    prunedRuns,
  };
}

function parseArgs(argv: string[]) {
  let scriptKey = '';
  let runId = '';
  let browser = 'chrome';
  let backfill = false;
  for (const arg of argv) {
    if (arg.startsWith('--script=')) scriptKey = arg.slice(9).trim();
    else if (arg.startsWith('--run=')) runId = arg.slice(6).trim();
    else if (arg.startsWith('--browser=')) browser = arg.slice(10).trim() || 'chrome';
    else if (arg === '--backfill') backfill = true;
  }
  return { scriptKey, runId, browser, backfill };
}

async function main() {
  const { scriptKey, runId, browser, backfill } = parseArgs(process.argv.slice(2));
  if (!scriptKey) {
    console.error('用法: prune-flow-golden-runs --script=<flows/...> [--run=<runId> | --backfill] [--browser=chrome]');
    process.exit(1);
  }
  if (backfill || !runId) {
    if (!backfill && !runId) {
      console.error('需要 --run=<runId> 或 --backfill');
      process.exit(1);
    }
    const result = backfillPruneFlowGoldenRuns({ scriptKey, browser });
    if (result.skipped && process.env.FLOW_GOLDEN_PRUNE_VERBOSE === '1') {
      console.log(`[golden-prune] 跳过: ${result.skipped}`);
    } else if (result.prunedScreenshots) {
      console.log(`[golden-prune] 回填完成 · 清理 ${result.prunedRuns?.length || 0} 次 run · ${result.prunedScreenshots} 张截图`);
    } else {
      console.log('[golden-prune] 回填完成 · 无需清理');
    }
    return;
  }
  const result = await pruneFlowGoldenRunScreenshots({ scriptKey, runId, browser });
  if (result.skipped && process.env.FLOW_GOLDEN_PRUNE_VERBOSE === '1') {
    console.log(`[golden-prune] 跳过: ${result.skipped}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
