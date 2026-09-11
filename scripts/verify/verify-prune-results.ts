#!/usr/bin/env tsx
/**
 * 本地 results 清理脚本离线校验：批次分组、dry-run / --apply、受保护路径。
 *   npx tsx scripts/verify/verify-prune-results.ts
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlowBatchDirName, planFlowBatchPrune, runFlowBatchPrune } from '../report/prune-flow-batches.js';
import { pairedAssetDirNames, planStandalonePrune, runStandalonePrune } from '../report/prune-standalone-reports.js';
import { formatBytes, isForbiddenAbs, isJobsPath } from '../report/prune-results-shared.js';

function pass(name: string) {
  console.log(`  ✓ ${name}`);
}

function writeFile(p: string, body = 'x') {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

function fillDir(dir: string, bytes = 32) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'marker.txt'), 'm'.repeat(bytes));
}

function main() {
  const parsed = [
    parseFlowBatchDirName('request-flow-stage9084-2026-09-10T07-18-19-409Z'),
    parseFlowBatchDirName('approval-flow-dev-2026-09-11T01-02-03-004Z'),
    parseFlowBatchDirName('request-flow-uat-2026-09-08T00-00-00-000Z'),
    parseFlowBatchDirName('demo-customer-2026-09-10T00-00-00-000Z'),
    parseFlowBatchDirName('demo-foo'),
    parseFlowBatchDirName('misc-notes'),
    parseFlowBatchDirName('invoice-flow-stage-2026-09-10T00-00-00-000Z'),
  ];
  assert.equal(parsed[0]!.key, 'request-flow::stage9084');
  assert.equal(parsed[0]!.kind, 'flow-env');
  assert.equal(parsed[1]!.key, 'approval-flow::dev');
  assert.equal(parsed[2]!.key, 'request-flow::uat');
  assert.equal(parsed[3]!.kind, 'demo');
  assert.equal(parsed[3]!.key, 'demo');
  assert.equal(parsed[4]!.kind, 'demo');
  assert.equal(parsed[5]!.kind, 'other');
  assert.equal(parsed[5]!.key, 'misc-notes');
  assert.equal(parsed[6]!.key, 'invoice-flow::stage');
  assert.ok((parsed[0]!.timeMs || 0) > (parsed[2]!.timeMs || 0));
  pass('parseFlowBatchDirName');

  assert.deepEqual(pairedAssetDirNames('ui-regression-customer.standalone.html'), [
    'ui-regression-customer-assets',
    'ui-regression-customer.standalone-assets',
  ]);
  pass('pairedAssetDirNames');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-results-'));
  const results = path.join(tmp, 'results');
  const batches = path.join(results, 'flow-report-batches');
  const jobs = path.join(results, 'jobs', 'nightly');
  const baseline = path.join(tmp, 'screenshots-baseline', 'keep.png');
  const envFile = path.join(tmp, '.env');

  fillDir(path.join(batches, 'request-flow-stage9084-2026-09-10T07-18-19-409Z'), 80);
  fillDir(path.join(batches, 'request-flow-stage9084-2026-09-09T07-18-19-409Z'), 40);
  fillDir(path.join(batches, 'approval-flow-dev-2026-09-10T01-00-00-000Z'), 20);
  fillDir(path.join(batches, 'demo-foo-2026-09-10T00-00-00-000Z'), 16);
  fillDir(path.join(batches, 'demo-bar-2026-09-09T00-00-00-000Z'), 16);
  fillDir(jobs, 99);
  writeFile(baseline, 'png');
  writeFile(envFile, 'SECRET=1');
  writeFile(path.join(results, 'ui-regression-customer.standalone.html'), '<html>s</html>');
  writeFile(path.join(results, 'ui-regression-customer.html'), '<html>n</html>');
  writeFile(path.join(results, 'ui-regression-customer-dev.standalone.html'), '<html>d</html>');
  fillDir(path.join(results, 'ui-regression-customer-assets'), 50);
  writeFile(path.join(jobs, 'secret.standalone.html'), 'job');
  writeFile(path.join(results, 'flow-run-summary.html'), '<html>keep</html>');

  const batchPlan = planFlowBatchPrune({ resultsRoot: results, keep: 1, keepDemo: 1 });
  const dropNames = batchPlan.removeItems.map((i) => path.basename(i.abs)).sort();
  assert.deepEqual(dropNames, [
    'demo-bar-2026-09-09T00-00-00-000Z',
    'request-flow-stage9084-2026-09-09T07-18-19-409Z',
  ]);
  assert.equal(batchPlan.keepItems.length, 3);
  pass('planFlowBatchPrune keep latest');

  const dropDemo = planFlowBatchPrune({ resultsRoot: results, keep: 1, keepDemo: 0 });
  assert.ok(dropDemo.removeItems.some((i) => i.abs.includes('demo-foo')));
  assert.ok(dropDemo.removeItems.some((i) => i.abs.includes('demo-bar')));
  pass('planFlowBatchPrune --keep-demo=0');

  const dryCode = runFlowBatchPrune(['--results', results], tmp);
  assert.equal(dryCode, 0);
  assert.ok(fs.existsSync(path.join(batches, 'request-flow-stage9084-2026-09-09T07-18-19-409Z')));
  pass('flow-batches dry-run 不删');

  const applyCode = runFlowBatchPrune(['--results', results, '--apply'], tmp);
  assert.equal(applyCode, 0);
  assert.ok(fs.existsSync(path.join(batches, 'request-flow-stage9084-2026-09-10T07-18-19-409Z')));
  assert.ok(!fs.existsSync(path.join(batches, 'request-flow-stage9084-2026-09-09T07-18-19-409Z')));
  assert.ok(fs.existsSync(path.join(batches, 'demo-foo-2026-09-10T00-00-00-000Z')));
  assert.ok(!fs.existsSync(path.join(batches, 'demo-bar-2026-09-09T00-00-00-000Z')));
  assert.ok(fs.existsSync(jobs), 'results/jobs 必须保留');
  assert.ok(fs.existsSync(baseline));
  assert.ok(fs.existsSync(envFile));
  pass('flow-batches --apply 只删过期批次');

  const standPlan = planStandalonePrune({ resultsRoot: results });
  const standRels = standPlan.htmlItems.map((i) => i.rel).sort();
  assert.deepEqual(standRels, [
    'ui-regression-customer-dev.standalone.html',
    'ui-regression-customer.standalone.html',
  ]);
  assert.equal(standPlan.assetItems.length, 0);
  assert.ok(standPlan.skippedHtml.includes('ui-regression-customer.html'));
  pass('planStandalonePrune 只选 standalone');

  const assetPlan = planStandalonePrune({ resultsRoot: results, assets: true });
  assert.ok(assetPlan.assetItems.some((i) => i.rel === 'ui-regression-customer-assets'));
  pass('planStandalonePrune --assets');

  const standDry = runStandalonePrune(['--results', results], tmp);
  assert.equal(standDry, 0);
  assert.ok(fs.existsSync(path.join(results, 'ui-regression-customer.standalone.html')));
  pass('standalone dry-run 不删');

  const standApply = runStandalonePrune(['--results', results, '--apply', '--assets'], tmp);
  assert.equal(standApply, 0);
  assert.ok(!fs.existsSync(path.join(results, 'ui-regression-customer.standalone.html')));
  assert.ok(!fs.existsSync(path.join(results, 'ui-regression-customer-dev.standalone.html')));
  assert.ok(!fs.existsSync(path.join(results, 'ui-regression-customer-assets')));
  assert.ok(fs.existsSync(path.join(results, 'ui-regression-customer.html')));
  assert.ok(fs.existsSync(path.join(results, 'flow-run-summary.html')));
  assert.ok(fs.existsSync(path.join(jobs, 'secret.standalone.html')));
  pass('standalone --apply --assets 不碰普通 html / jobs');

  assert.equal(formatBytes(0), '0 B');
  assert.match(formatBytes(2048), /KB/);
  assert.equal(isJobsPath(path.join(results, 'jobs', 'x'), results), true);
  assert.equal(isForbiddenAbs(path.join(results, 'jobs', 'x'), results), true);
  pass('shared helpers');

  const missing = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-empty-'));
  const emptyCode = runFlowBatchPrune(['--results', path.join(missing, 'results')], missing);
  const emptyStand = runStandalonePrune(['--results', path.join(missing, 'no-such')], missing);
  assert.equal(emptyCode, 0);
  assert.equal(emptyStand, 0);
  pass('缺失 results 树 dry-run 退出 0');

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const helpBatch = spawnSync('npx', ['tsx', 'scripts/report/prune-flow-batches.ts', '--help'], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  const emptyCli = spawnSync(
    'npx',
    ['tsx', 'scripts/report/prune-standalone-reports.ts', `--results=${path.join(missing, 'no-such')}`],
    { encoding: 'utf8', cwd: repoRoot },
  );
  assert.equal(helpBatch.status, 0, helpBatch.stderr);
  assert.match(helpBatch.stdout, /--apply/);
  assert.equal(emptyCli.status, 0, emptyCli.stderr);
  assert.match(emptyCli.stdout, /无需清理|预览/);
  pass('CLI --help / 空树 dry-run');

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(missing, { recursive: true, force: true });
  console.log('verify-prune-results: ok');
}

main();
