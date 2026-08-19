#!/usr/bin/env node
/**
 * 离线校验失败排查包结构
 *   node scripts/verify/verify-failure-bundle.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { require: tsxRequire } = require('tsx/cjs/api');

const {
  FAILURE_BUNDLE_VERSION,
  buildFailureBundle,
  collectKeyScreenshots,
  formatFailureSummaryMarkdown,
  readFailureBundle,
  writeFailureBundle,
} = tsxRequire(path.join(__dirname, '../../src/runtime/failure-bundle.ts'), __filename);

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'failure-bundle-'));
  const steps = [
    { id: 's1', action: { type: 'click', description: 'A' }, passed: true, optional: false, attempts: 1, screenshot: path.join(tmp, 's1.png') },
    { id: 's2', action: { type: 'click', description: 'B' }, passed: false, optional: false, attempts: +2, error: 'not found', screenshot: path.join(tmp, 's2.png') },
  ];
  fs.writeFileSync(steps[0].screenshot, 'png');
  fs.writeFileSync(steps[1].screenshot, 'png');

  const shots = collectKeyScreenshots(steps);
  assert.strictEqual(shots.length, 2, 'should collect last passed + failed screenshots');

  const result = {
    passed: false,
    outputDir: tmp,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    steps,
    error: 'not found',
    replayRel: 'results/demo/flow.html',
  };
  const bundle = buildFailureBundle({
    kind: 'intent',
    outputDir: tmp,
    env: 'stage',
    healLogs: [
      {
        stepId: 's2',
        attempt: 2,
        engine: 'ego',
        at: '2026-01-01T00:00:01.000Z',
        error: 'not found',
        accepted: false,
      },
    ],
    result: { ...result, engine: 'ego', planName: 'demo' },
  });
  assert.strictEqual(bundle.version, FAILURE_BUNDLE_VERSION);
  assert.strictEqual(bundle.failedStep?.id, 's2');
  assert.ok(formatFailureSummaryMarkdown(bundle).includes('失败步骤'));

  const written = writeFailureBundle({
    kind: 'intent',
    outputDir: tmp,
    env: 'stage',
    healLogs: [
      {
        stepId: 's2',
        attempt: 2,
        engine: 'ego',
        at: '2026-01-01T00:00:01.000Z',
        error: 'not found',
      },
    ],
    result: { ...result, engine: 'ego', planName: 'demo' },
  });
  assert.ok(written?.bundleRel.endsWith('failure-bundle.json'));
  assert.ok(fs.existsSync(path.join(tmp, 'failure-bundle.json')));
  assert.ok(fs.existsSync(path.join(tmp, 'failure-summary.md')));
  assert.ok(fs.existsSync(path.join(tmp, 'heal', '01-s2.json')));

  const loaded = readFailureBundle(tmp);
  assert.strictEqual(loaded?.kind, 'intent');
  assert.strictEqual(loaded?.healLogs.length, 1);

  assert.strictEqual(writeFailureBundle({
    kind: 'intent',
    outputDir: tmp,
    result: { ...result, passed: true, engine: 'ego', planName: 'demo' },
  }), undefined);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('verify-failure-bundle: ok');
}

main();
