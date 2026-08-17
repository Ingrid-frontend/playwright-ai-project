#!/usr/bin/env node
/**
 * 离线校验 Intent 结构化断言
 *   node scripts/verify/verify-intent-assert.cjs
 */
const assert = require('assert');
const path = require('path');
const { require: tsxRequire } = require('tsx/cjs/api');

const { validateTestIntent, isNarrativeAssertText } = tsxRequire(
  path.join(__dirname, '../../src/types/test-intent.ts'),
  __filename,
);
const { evaluateStructuredAssert } = tsxRequire(
  path.join(__dirname, '../../src/runtime/assert-eval.ts'),
  __filename,
);
const { compileIntentToPlan } = tsxRequire(
  path.join(__dirname, '../../src/runtime/compile-intent.ts'),
  __filename,
);
const { snapshotContainsText } = tsxRequire(
  path.join(__dirname, '../../src/runtime/ego-snapshot.ts'),
  __filename,
);

function main() {
  assert.strictEqual(isNarrativeAssertText('页面包含审批相关内容'), true);
  assert.strictEqual(isNarrativeAssertText('审批'), false);

  let threw = false;
  try {
    validateTestIntent({
      name: 'bad',
      steps: [{ action: 'assert', description: '页面包含审批相关内容' }],
    });
  } catch {
    threw = true;
  }
  assert.strictEqual(threw, true, 'narrative assert must reject');

  const intent = validateTestIntent({
    name: 'ok',
    steps: [{ id: 'a', action: 'assert', kind: 'text', expect: '审批' }],
  });
  assert.strictEqual(intent.steps[0].kind, 'text');
  assert.strictEqual(intent.steps[0].expect, '审批');

  const { plan } = compileIntentToPlan({
    name: 'compile',
    steps: [{ action: 'assert', kind: 'url', expect: '/main/approve' }],
  });
  assert.strictEqual(plan.steps[0].action.type, 'assert');
  assert.strictEqual(plan.steps[0].action.kind, 'url');

  const snap = `@1 [button] "审批"\n@2 [textbox] "意见"`;
  assert.strictEqual(snapshotContainsText(snap, '审批'), true);
  assert.strictEqual(
    evaluateStructuredAssert({ kind: 'text', expect: '审批', snapshot: snap }).ok,
    true,
  );
  assert.strictEqual(
    evaluateStructuredAssert({ kind: 'text', expect: '页面包含审批相关内容', snapshot: snap }).ok,
    false,
  );
  assert.strictEqual(
    evaluateStructuredAssert({ kind: 'url', expect: '/main/approve', url: 'https://x/main/approve' }).ok,
    true,
  );

  console.log('✅ verify-intent-assert passed');
}

main();
