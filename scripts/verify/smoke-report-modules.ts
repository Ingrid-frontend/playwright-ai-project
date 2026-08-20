import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildOverviewData, countComparisonSeverities } from '../report/compare-screenshots-overview.js';
import {
  buildIterationTabs,
  collectBrowserFilterList,
  renderCompareReportHtml,
} from '../report/compare-screenshots-report.js';
import { extractCalendarDayKey } from '../report/compare-screenshots-render-date.js';
import { isNoiseLine } from '../optimize/optimize-raw-passes.js';
import { buildJobFailReasons } from '../jobs/job-notify.js';
import { discoverScriptScanTargets, getAllScreenshots } from '../report/compare-screenshots-scan.js';
import { classifyComparisonSeverity } from '../report/ui-issues-index.js';
import { loadFlakeHistory } from '../report/flake-history.js';
import { isDateCategoryDirSegment } from '../../src/utils/date-category.js';
import { isLoginLikeText, isLoginLikeUrl } from '../../src/utils/login-detection.js';
import { parseSnapshotIdentity } from '../report/compare-screenshots-utils.js';
import { clusterDiffRegions } from '../report/image-diff.js';
import { PNG } from 'pngjs';
import * as uiIssuesMod from '../report/ui-issues-index.js';
import * as feishuMod from '../feishu/index.js';

function pass(name: string) {
  console.log(`  ✓ ${name}`);
}

const fixture = [
  {
    testDir: '260612/demo',
    comparisons: [
      {
        stepNumber: 1,
        optimizedComparisons: [
          { difference: 0, compareKind: 'golden' },
          { difference: 0.002, compareKind: 'golden' },
          { difference: 0.02, compareKind: 'golden' },
          { difference: 0.002, compareKind: 'cross-browser' },
        ],
        crossBrowserComparisons: [],
      },
    ],
  },
];

assert.equal(classifyComparisonSeverity(0, 'golden'), 'pass');
assert.equal(classifyComparisonSeverity(0.02, 'cross-browser'), 'warning');
pass('classifyComparisonSeverity');

const counts = countComparisonSeverities(fixture);
assert.equal(counts.total, 4);
assert.equal(counts.blocker, 1);
assert.ok(counts.warning >= 1);
assert.ok(counts.noise >= 1);
pass('countComparisonSeverities');

const overview = buildOverviewData(fixture, {
  totalSteps: 1,
  totalScreenshots: 2,
  totalExecutions: 1,
  generatedAt: '2026-08-14 00:00:00',
});
assert.equal(overview.total, 4);
assert.equal(overview.blocker, 1);
assert.ok(overview.maxDiff);
assert.ok(overview.distribution.length === 4);
pass('buildOverviewData');

const html = renderCompareReportHtml({
  overviewHtml: '<div class="ov-panel">overview</div>',
  iterationTabs: buildIterationTabs(['260612']),
  scriptTabRows: '',
  browserFilterRow: '',
  crossBrowserOn: false,
  optimizedByIteration: '<div>opt</div>',
  optimizedDiffByIteration: '',
  diffOnlyByIteration: '',
  heatmapHtml: '',
  summaryHtml: '',
  analysisHtml: '',
  issuesHtml: '',
  visualReviewHtml: '',
});
assert.match(html, /<!DOCTYPE html>/);
assert.match(html, /截图对比报告/);
assert.match(html, /function openModal/);
assert.match(html, /ov-panel/);
assert.match(html, /data-iteration="260612"/);
assert.match(html, /Visual Review/);
pass('renderCompareReportHtml');

const browsers = collectBrowserFilterList(
  [{ optimizedScreenshots: [{ browser: 'chrome' }, { browser: 'webkit' }, { browser: 'firefox' }] }],
  true,
);
assert.deepEqual(browsers, ['chrome', 'webkit', 'cross']);
pass('collectBrowserFilterList');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-scan-'));
fs.mkdirSync(path.join(tmp, '260612', 'demo', 'run-chromium-optimized'), { recursive: true });
const targets = discoverScriptScanTargets(tmp);
assert.equal(targets.length, 1);
assert.equal(targets[0]?.testDir, '260612/demo');
fs.rmSync(tmp, { recursive: true, force: true });
pass('discoverScriptScanTargets');

const shotTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-shot-'));
const runDir = path.join(shotTmp, 'run-chromium-optimized');
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(runDir, 'step-1-home.png'), '');
const shots = getAllScreenshots(shotTmp, 'optimized', path.join(shotTmp, 'results', 'out.html'));
assert.equal(shots.get(1)?.length, 1);
assert.equal(shots.get(1)?.[0]?.browser, 'chrome');
assert.equal(shots.get(1)?.[0]?.stepName, 'home');
fs.rmSync(shotTmp, { recursive: true, force: true });
pass('getAllScreenshots');

assert.equal(extractCalendarDayKey('2026-08-14_10-00-00'), '2026-08-14');
assert.equal(extractCalendarDayKey('foo'), null);
pass('extractCalendarDayKey');

assert.equal(isNoiseLine(`await page.getByText('ok').click()`), false);
assert.equal(isNoiseLine(`await page.getByText('${'x'.repeat(16)}').click()`), true);
pass('optimize-raw-passes isNoiseLine');

assert.deepEqual(
  buildJobFailReasons({
    testPassed: true,
    comparePassed: true,
    compareSkipped: true,
    aborted: true,
    failCount: 0,
  }),
  ['执行已中断'],
);
pass('buildJobFailReasons');

assert.equal(typeof uiIssuesMod.buildUiIssuesReport, 'function');
assert.equal(typeof uiIssuesMod.buildPlainLanguageAnalysis, 'function');
assert.equal(typeof feishuMod.fetchWithRetry, 'function');
pass('module barrels');

assert.equal(isDateCategoryDirSegment('260814'), true);
assert.equal(isDateCategoryDirSegment('foo'), false);
pass('date-category ESM');

assert.equal(isLoginLikeUrl('https://x.example/login'), true);
assert.equal(isLoginLikeUrl('https://x.example/home'), false);
assert.equal(isLoginLikeText('二维码登录\n账号登录\n请使用汇联易STAGE APP扫码登录'), true);
assert.equal(isLoginLikeText('工作台 我的审批'), false);
pass('login-detection');

const flakeTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-flake-'));
const emptyFlake = loadFlakeHistory(flakeTmp);
assert.equal(emptyFlake.trend.length, 0);
fs.writeFileSync(
  path.join(flakeTmp, '2026-08-14.json'),
  JSON.stringify({ entries: [{ failed: 2, flakeFailed: 1 }] }),
);
const flake = loadFlakeHistory(flakeTmp);
assert.equal(flake.latest?.flakeFailed, 1);
assert.equal(flake.latest?.failed, 2);
fs.rmSync(flakeTmp, { recursive: true, force: true });
pass('flake-history');

assert.deepEqual(parseSnapshotIdentity('approval-list__normal'), { snapshotName: 'approval-list', state: 'normal' });
assert.deepEqual(parseSnapshotIdentity('我的审批-after'), {});
pass('parseSnapshotIdentity');

const png = new PNG({ width: 20, height: 20 });
png.data.fill(0);
for (let y = 2; y < 8; y++) {
  for (let x = 2; x < 14; x++) {
    const i = (y * 20 + x) * 4;
    png.data[i] = 255;
    png.data[i + 3] = 255;
  }
}
const regions = clusterDiffRegions(png);
assert.ok(regions.length >= 1);
assert.equal(regions[0]!.w, 12);
assert.equal(regions[0]!.h, 6);
pass('clusterDiffRegions');

console.log('\n✅ smoke-report-modules 通过');
