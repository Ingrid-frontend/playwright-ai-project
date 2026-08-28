#!/usr/bin/env tsx
/**
 * Golden 回归：连续两次与基线判定完全一致时，清理上一次 run 的截图，仅保留 .golden-match.json 判定结果。
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
import { resolveSameBrowserPixelmatch } from './ui-regression-config.js';

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
  skipped?: string;
};

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
    if (result.sizeMismatch || result.difference > 0) {
      return { match: false, steps: pngs.length, maxDifference };
    }
  }

  return { match: true, steps: pngs.length, maxDifference: 0 };
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

  const runIds = listRunIds(scriptKey, browser, screenshotsRoot);
  const idx = runIds.indexOf(runId);
  if (idx <= 0) return { currentMatch: true };

  const prevRunId = runIds[idx - 1]!;
  let prevDir: string;
  try {
    prevDir = resolveSourceRunDir({
      scriptKey,
      sourceRunTimestamp: prevRunId,
      browser,
      screenshotsRoot,
    });
  } catch {
    return { currentMatch: true };
  }

  const prevVerdict = readVerdict(prevDir);
  if (!prevVerdict?.match) return { currentMatch: true };

  const prunedScreenshots = pruneRunScreenshots(prevDir);
  if (prunedScreenshots > 0) {
    writeVerdict(prevDir, { ...prevVerdict, prunedScreenshots });
    console.log(
      `[golden-prune] ${scriptKey} · 已清理 ${prevRunId} 的 ${prunedScreenshots} 张截图（与基线连续一致，仅保留判定结果）`,
    );
    return { currentMatch: true, prunedRunId: prevRunId, prunedScreenshots };
  }

  return { currentMatch: true };
}

function parseArgs(argv: string[]) {
  let scriptKey = '';
  let runId = '';
  let browser = 'chrome';
  for (const arg of argv) {
    if (arg.startsWith('--script=')) scriptKey = arg.slice(9).trim();
    else if (arg.startsWith('--run=')) runId = arg.slice(6).trim();
    else if (arg.startsWith('--browser=')) browser = arg.slice(10).trim() || 'chrome';
  }
  return { scriptKey, runId, browser };
}

async function main() {
  const { scriptKey, runId, browser } = parseArgs(process.argv.slice(2));
  if (!scriptKey || !runId) {
    console.error('用法: prune-flow-golden-runs --script=<flows/...> --run=<runId> [--browser=chrome]');
    process.exit(1);
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
