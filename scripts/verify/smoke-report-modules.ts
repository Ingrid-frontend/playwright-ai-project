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
import { discoverScriptScanTargets } from '../report/compare-screenshots-scan.js';
import { classifyComparisonSeverity } from '../report/ui-issues.js';
import * as uiIssuesMod from '../report/ui-issues-index.js';
import * as feishuMod from '../feishu/index.js';
import * as figmaMod from '../figma/index.js';

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
});
assert.match(html, /<!DOCTYPE html>/);
assert.match(html, /截图对比报告/);
assert.match(html, /function openModal/);
assert.match(html, /ov-panel/);
assert.match(html, /data-iteration="260612"/);
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

assert.equal(typeof uiIssuesMod.buildUiIssuesReport, 'function');
assert.equal(typeof uiIssuesMod.buildPlainLanguageAnalysis, 'function');
assert.equal(typeof feishuMod.fetchWithRetry, 'function');
assert.equal(typeof figmaMod.parseFigmaUrl, 'function');
pass('module barrels');

console.log('\n✅ smoke-report-modules 通过');
