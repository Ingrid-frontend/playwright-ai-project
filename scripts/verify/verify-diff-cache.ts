import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { compareImagesWithDiff, loadCachedDiffResult, readDiffMeta, writeDiffMeta } from '../report/image-diff.js';
import { loadUiRegressionConfig } from '../report/ui-regression-config.js';
import { screenshotsForMainReport } from '../report/customer-report-run-history.js';
import type { ScriptRunHistoryEntry } from '../report/customer-report-run-meta.js';
import type { ScreenshotInfo } from '../report/compare-screenshots-utils.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-cache-'));
const config = loadUiRegressionConfig();
const original = structuredClone(config);
const first = path.join(root, 'first.png');
const second = path.join(root, 'second.png');
const output = path.join(root, 'diff.png');
const expected = { threshold: 0.1, includeAA: true, scriptKey: 'cache-fixture' };
const cached = () => loadCachedDiffResult(first, second, output, expected);

try {
  const reportEntry = fs.readFileSync(fileURLToPath(new URL('../report/compare-screenshots-customer.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(reportEntry, /readUiCompareCache|shouldReuseCompareCache|cachedHit|reuse-compare/);
  assert.match(reportEntry, /generateTestComparisons\(testDir, filtered, outputPath\)/);
  const readyEntry = fs.readFileSync(fileURLToPath(new URL('../feishu/deliver-ready.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(readyEntry, /reuse-compare/);
  config.ignoreRegions = [];
  config.compareAlign = { enabled: false, maxShift: 8, minGain: 0.12 };
  config.watermarkSuppress = { enabled: false, maskAtCapture: false, minLuminance: 200, maxChannelDelta: 20, maxLuminanceDelta: 20 };
  const image = new PNG({ width: 32, height: 32 });
  image.data.fill(255);
  const bytes = PNG.sync.write(image);
  fs.writeFileSync(first, bytes);
  fs.writeFileSync(second, bytes);
  const row = (runId: string, screenshotCount: number, isLatest: boolean): ScriptRunHistoryEntry => ({
    runId, screenshotCount, isLatest, runIndex: isLatest ? 2 : 1,
    comparedSteps: 0, passSteps: 0, minorSteps: 0, regressSteps: 0,
    maxDifference: 0, verdict: 'empty', verdictLabel: 'offline',
  });
  const shot = (timestamp: string, file: string): ScreenshotInfo => ({
    timestamp, path: file, relativePath: file, date: '2026-09-01',
    displayTimestamp: timestamp, type: 'optimized', stepName: 'home', browser: 'chrome',
  });
  const screenshots = new Map([
    [1, [shot('complete-run', first), shot('latest-partial', second)]],
    [2, [shot('complete-run', first)]],
  ]);
  const selected = screenshotsForMainReport(screenshots, [row('complete-run', 2, false), row('latest-partial', 1, true)]);
  assert.equal(selected.runId, 'complete-run');
  assert.equal(selected.latestIncomplete, true);
  assert.equal(selected.filtered.size, 2);
  assert.ok([...selected.filtered.values()].flat().every((image) => image.path === first && image.timestamp === selected.runId));
  await compareImagesWithDiff(first, second, output, expected.threshold, expected);
  assert.equal(cached()?.difference, 0);
  assert.equal(fs.existsSync(output), false);
  assert.equal(loadCachedDiffResult(first, second, output, { ...expected, threshold: 0.2 }), null);
  assert.equal(loadCachedDiffResult(first, second, output, { ...expected, includeAA: false }), null);

  config.ignoreRegions = [{ x: 0, y: 0, width: 4, height: 4, script: 'other-script' }];
  assert.equal(cached()?.difference, 0);
  config.ignoreRegions[0].script = expected.scriptKey;
  assert.equal(cached(), null);
  config.ignoreRegions = [];
  config.compareAlign.maxShift += 1;
  assert.equal(cached(), null);
  config.compareAlign.maxShift -= 1;
  config.watermarkSuppress.maxChannelDelta += 1;
  assert.equal(cached(), null);
  config.watermarkSuppress.maxChannelDelta -= 1;
  const regions = config.diffRegions!;
  const previousGrid = regions.gridSize;
  regions.gridSize = (previousGrid ?? 16) + 1;
  assert.equal(cached(), null);
  regions.gridSize = previousGrid;
  assert.equal(cached()?.difference, 0);

  const meta = readDiffMeta(output)!;
  writeDiffMeta(output, { ...meta, natureVersion: -1 });
  assert.equal(cached(), null);
  writeDiffMeta(output, { ...meta, configFingerprint: undefined });
  assert.equal(cached(), null);
  writeDiffMeta(output, meta);
  const copy = path.join(root, 'copy.png');
  fs.copyFileSync(first, copy);
  assert.equal(loadCachedDiffResult(copy, second, output, expected), null);

  image.data.fill(0);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
  fs.writeFileSync(second, PNG.sync.write(image));
  assert.equal(cached(), null);
  const result = await compareImagesWithDiff(first, second, output, expected.threshold, expected);
  assert.ok(result.difference > 0);
  assert.deepEqual(cached(), result);
  fs.unlinkSync(output.replace(/\.png$/, '-overlay.png'));
  assert.equal(cached(), null);

  await compareImagesWithDiff(first, second, output, expected.threshold, expected);
  const stat = fs.statSync(first);
  fs.utimesSync(first, stat.atime, new Date(stat.mtimeMs + 1000));
  fs.utimesSync(output, new Date(), new Date(stat.mtimeMs + 2000));
  assert.equal(cached(), null);
  console.log('diff cache verification passed');
} finally {
  Object.assign(config, original);
  fs.rmSync(root, { recursive: true, force: true });
}
