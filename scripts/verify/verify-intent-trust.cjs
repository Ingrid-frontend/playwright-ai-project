#!/usr/bin/env node
/**
 * 离线校验 Intent 可信度
 *   node scripts/verify/verify-intent-trust.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { require: tsxRequire } = require('tsx/cjs/api');

const {
  computeSuggestedTrust,
  recordIntentTrustRun,
  resolveIntentKey,
  INTENT_TRUST_VERSION,
} = tsxRequire(path.join(__dirname, '../../src/runtime/intent-trust.ts'), __filename);

const { validateTestIntent } = tsxRequire(
  path.join(__dirname, '../../src/types/test-intent.ts'),
  __filename,
);
const { shouldAcceptAiReview } = tsxRequire(
  path.join(__dirname, '../../scripts/report/ui-issue-ai-review.ts'),
  __filename,
);

function main() {
  assert.strictEqual(
    resolveIntentKey({ scriptKey: 'intent/dev/x', name: 'n' }),
    'intent/dev/x',
  );
  assert.strictEqual(computeSuggestedTrust({ consecutivePass: 10, consecutiveFail: 0, healRate: 0.05, runs: 10, failed: 0 }), 'stable');
  assert.strictEqual(computeSuggestedTrust({ consecutivePass: 0, consecutiveFail: 2, healRate: 0, runs: 2, failed: 2 }), 'watch');
  assert.strictEqual(computeSuggestedTrust({ consecutivePass: 3, consecutiveFail: 0, healRate: 0.4, runs: 5, failed: 0 }), 'watch');

  const intent = validateTestIntent({
    name: 't',
    reviewRequired: true,
    trustLevel: 'trial',
    steps: [{ action: 'assert', kind: 'text', expect: '审批' }],
  });
  assert.strictEqual(intent.reviewRequired, true);
  assert.strictEqual(intent.trustLevel, 'trial');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-trust-'));
  const prevCwd = process.cwd();
  process.chdir(tmp);
  try {
    const rec = recordIntentTrustRun({
      intentKey: 'demo/key',
      name: 'demo',
      passed: true,
      healed: false,
    });
    assert.strictEqual(rec.version, INTENT_TRUST_VERSION);
    assert.strictEqual(rec.runs, 1);
    assert.strictEqual(rec.suggestedTrustLevel, 'trial');
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  assert.strictEqual(
    shouldAcceptAiReview(
      { verdict: 'ui_bug', reason: 'x', confidence: 0.9, source: 'rule' },
      { verdict: 'likely_noise', reason: 'y', confidence: 0.6, source: 'ai' },
    ),
    false,
  );
  assert.strictEqual(
    shouldAcceptAiReview(
      { verdict: 'needs_human', reason: 'x', confidence: 0.5, source: 'rule' },
      { verdict: 'likely_noise', reason: 'y', confidence: 0.8, source: 'ai' },
    ),
    true,
  );

  console.log('verify-intent-trust: ok');
}

main();
