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
import { classifyDifference, isProcessOnlyStep } from '../report/coverage-stats.js';
import { classifyRegionNature, isActionableNature } from '../report/change-nature.js';
import {
  friendlyScriptLabel,
  friendlyStepLabel,
  regionZoneLabel,
} from '../report/customer-report-naming.js';
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
        optimizedScreenshots: [
          {
            path: 'screenshots/260612/demo/run/step-01-home.png',
            relativePath: '../screenshots/260612/demo/run/step-01-home.png',
            timestamp: '2026-06-12T00-00-00-000Z',
            date: '260612',
            displayTimestamp: '2026-06-12 00:00:00',
            type: 'optimized' as const,
            stepName: 'home',
            browser: 'chrome',
          },
        ],
        baselineComparisons: [
          {
            difference: 0.02,
            compareKind: 'golden',
            image1Path: '../screenshots-baseline/260612/demo/run/step-01-home.png',
            image2Path: '../screenshots/260612/demo/run/step-01-home.png',
            browser: 'chrome',
          },
        ],
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
// total/blocker/noise 现为覆盖率口径：应检测步骤数 / 明显衰退 / 完全一致
assert.equal(overview.total, 1);
assert.equal(overview.blocker, 1);
assert.equal(overview.coverage?.comparedSteps, 1);
assert.ok(overview.maxDiff);
assert.ok(overview.distribution.length === 4);
pass('buildOverviewData');

const html = renderCompareReportHtml({
  overviewHtml: '<div class="ov-panel">overview</div>',
  browserFilterRow: '',
  summaryHtml: '',
  analysisHtml: '',
  issuesHtml: '',
});
assert.match(html, /<!DOCTYPE html>/);
assert.match(html, /截图对比报告/);
assert.match(html, /function openModal/);
assert.match(html, /ov-panel/);
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

// 白底页面的未变化像素必须被 diffMask 排除，否则整页会被误判为差异区
const whitePage = new PNG({ width: 40, height: 40 });
for (let i = 0; i < whitePage.data.length; i += 4) {
  whitePage.data[i] = 255;
  whitePage.data[i + 1] = 255;
  whitePage.data[i + 2] = 255;
  whitePage.data[i + 3] = 0; // alpha=0 表示该像素无差异
}
assert.equal(clusterDiffRegions(whitePage).length, 0);
pass('clusterDiffRegions 不把白底误判为差异');

// 客户口径三档分级：小面积差异不得标红
const minor = classifyDifference(0.0012, [
  { x: 10, y: 10, w: 24, h: 12, pixels: 180, ratio: 0.0002, severity: 'medium' },
]);
assert.equal(minor.status, 'minor');
const major = classifyDifference(0.0012, [
  { x: 0, y: 0, w: 400, h: 120, pixels: 9000, ratio: 0.0098, severity: 'high' },
]);
assert.equal(major.status, 'regress');
assert.equal(classifyDifference(0, []).status, 'pass');
assert.ok(isProcessOnlyStep('step-4-action-before__main_home'));
assert.ok(!isProcessOnlyStep('step-4-工作台-after__main_home'));
pass('classifyDifference 三档分级');

// 缺少区域明细时（旧缓存）不得把真实衰退悄悄降级
const noRegions = classifyDifference(0.02, undefined);
assert.equal(noRegions.status, 'regress');
assert.match(noRegions.evidence.reason, /无区域明细/);
pass('classifyDifference 缺区域时按占比兜底');

// 贴右边缘的窄长条是滚动条，不算 UI 衰退
const scrollbarOnly = classifyDifference(
  0.012,
  [{ x: 1266, y: 42, w: 14, h: 636, pixels: 5169, ratio: 0.0056, severity: 'high' }],
  undefined,
  { width: 1280, height: 720 },
);
assert.equal(scrollbarOnly.status, 'minor');
pass('滚动条条带不判为衰退');

// 展示名清洗：客户看不到内部 stepName / 带时间戳的目录
assert.equal(friendlyStepLabel('DEV管理员-after'), 'DEV管理员');
assert.equal(friendlyStepLabel('返-回-after'), '返回');
assert.equal(friendlyStepLabel('action-before'), '操作（操作前）');
assert.equal(friendlyStepLabel('导航到页面'), '导航到页面');
assert.equal(friendlyScriptLabel('dev/260911/工作台_2026-08-20_19-29-59'), '开发环境 · 工作台');
assert.equal(friendlyScriptLabel('intent/dev/审批列表页可见'), '开发环境 · 审批列表页可见');
assert.equal(regionZoneLabel({ x: 0, y: 0, w: 40, h: 20 }, 1280, 720), '页面上部左侧');
pass('客户报告展示名清洗');

// ---- 变化性质识别：这是「差异不大却标红」的治理核心 ----

/** 造一张白底图，在 (x,y) 处画一个黑块 */
function pageWithBlock(w: number, h: number, bx: number, by: number, bw: number, bh: number): PNG {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (w * y + x) << 2;
      const inside = x >= bx && x < bx + bw && y >= by && y < by + bh;
      const v = inside ? 0 : 255;
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
  }
  return png;
}

const roi = { x: 10, y: 10, w: 80, h: 40, pixels: 0, ratio: 0, severity: 'high' as const };

// 同样的内容整体右移 9px：内容没变，只是位置变了
const shiftedNature = classifyRegionNature(
  pageWithBlock(120, 80, 20, 20, 30, 20),
  pageWithBlock(120, 80, 29, 20, 30, 20),
  roi,
);
assert.equal(shiftedNature.nature, 'shifted');
// shiftX 为正表示当前截图的内容相对基线右移了 9px
assert.equal(shiftedNature.shiftX, 9);
assert.equal(isActionableNature('shifted'), false);
pass('classifyRegionNature 识别整体位移（超出 8px 也能对齐）');

// 基线侧空白、当前侧出现明显内容：真衰退
const appearedNature = classifyRegionNature(
  pageWithBlock(120, 80, 0, 0, 0, 0),
  pageWithBlock(120, 80, 20, 20, 40, 25),
  roi,
);
assert.equal(appearedNature.nature, 'appeared');
assert.ok(isActionableNature('appeared'));
pass('classifyRegionNature 识别新增内容');

// 只有极轻微的灰度抖动：肉眼不可见，不能算内容变化
const jitterBase = pageWithBlock(120, 80, 20, 20, 30, 20);
const jitterCur = pageWithBlock(120, 80, 20, 20, 30, 20);
for (let i = 0; i < jitterCur.data.length; i += 4) {
  jitterCur.data[i] = Math.max(0, jitterCur.data[i]! - 6);
  jitterCur.data[i + 1] = Math.max(0, jitterCur.data[i + 1]! - 6);
  jitterCur.data[i + 2] = Math.max(0, jitterCur.data[i + 2]! - 6);
}
assert.equal(classifyRegionNature(jitterBase, jitterCur, roi).nature, 'rendering');
pass('classifyRegionNature 把不可见抖动归为渲染差异');

// 判定口径：整块区域够大，但性质只是位移时不得标红
const bigButShifted = classifyDifference(
  0.012,
  [
    {
      x: 100,
      y: 100,
      w: 400,
      h: 120,
      pixels: 9000,
      ratio: 0.0098,
      severity: 'high',
      nature: 'shifted',
      shiftX: -9,
      shiftY: 0,
    },
  ],
  undefined,
  { width: 1280, height: 720 },
);
assert.equal(bigButShifted.status, 'minor');
assert.equal(bigButShifted.evidence.actionableRegions, 0);
assert.match(bigButShifted.evidence.reason, /平移 9px|内容完全一致/);
pass('大面积位移不判为衰退');

// 同样大小的区域，性质是新增内容时必须标红
const bigAndReal = classifyDifference(
  0.012,
  [
    {
      x: 100,
      y: 100,
      w: 400,
      h: 120,
      pixels: 9000,
      ratio: 0.0098,
      severity: 'high',
      nature: 'appeared',
    },
  ],
  undefined,
  { width: 1280, height: 720 },
);
assert.equal(bigAndReal.status, 'regress');
assert.ok(bigAndReal.evidence.actionableRegions > 0);
pass('大面积新增内容仍判为衰退');

// 性质未知（旧缓存）时保守当作实质变化，绝不悄悄降级
const unknownNature = classifyDifference(
  0.012,
  [{ x: 100, y: 100, w: 400, h: 120, pixels: 9000, ratio: 0.0098, severity: 'high' }],
  undefined,
  { width: 1280, height: 720 },
);
assert.equal(unknownNature.status, 'regress');
pass('性质未知时保守判为衰退');

console.log('\n✅ smoke-report-modules 通过');
