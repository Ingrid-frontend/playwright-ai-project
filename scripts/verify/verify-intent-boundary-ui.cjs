#!/usr/bin/env node
/**
 * Studio 边界辅助离线校验
 *   node scripts/verify/verify-intent-boundary-ui.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  collectRunBoundary,
  listTrustRecords,
  loadHealSuggestFromRun,
  loadTrustRecord,
} = require('../../pw-files/lib/intent-boundary');

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-boundary-'));
  const runRel = 'results/intent-runs/demo-run';
  const runAbs = path.join(tmp, runRel);
  fs.mkdirSync(runAbs, { recursive: true });
  fs.writeFileSync(
    path.join(runAbs, 'intent.json'),
    JSON.stringify({ name: 'demo', scriptKey: 'mock/demo', reviewRequired: true }),
  );
  fs.writeFileSync(
    path.join(runAbs, 'heal-suggest.json'),
    JSON.stringify({
      version: 1,
      patches: [{ stepId: 'c1', accepted: true, fields: { description: '确认' } }],
      skipped: [],
    }),
  );
  fs.mkdirSync(path.join(tmp, 'results/history/intent-trust'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'results/history/intent-trust/mock__demo.json'),
    JSON.stringify({
      intentKey: 'mock/demo',
      name: 'demo',
      suggestedTrustLevel: 'trial',
      trustLevel: 'trial',
      runs: 1,
      passed: 1,
      healRate: 0,
      alerts: ['reviewRequired=true：合并前须人审'],
      updatedAt: '2026-08-20T00:00:00.000Z',
    }),
  );

  const hs = loadHealSuggestFromRun(tmp, runRel);
  assert.strictEqual(hs.patches.length, 1);
  const trust = loadTrustRecord(tmp, { scriptKey: 'mock/demo' });
  assert.strictEqual(trust.name, 'demo');
  const boundary = collectRunBoundary(tmp, runAbs, 'tests/definitions/demo.yaml');
  assert.strictEqual(boundary.reviewRequired, true);
  assert.ok(boundary.healSuggest);
  assert.ok(boundary.trust);
  assert.strictEqual(listTrustRecords(tmp).length, 1);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('verify-intent-boundary-ui: ok');
}

main();
