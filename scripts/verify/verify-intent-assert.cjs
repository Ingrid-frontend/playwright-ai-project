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
const { evaluateStructuredAssert, shouldSkipUnobservedAssert, formatMissingAssertDetail } = tsxRequire(
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
    evaluateStructuredAssert({
      kind: 'text',
      expect: '审批意见',
      snapshot: 'text "其它"',
      frameTexts: ['提交 审批意见 取消'],
    }).ok,
    true,
  );

  assert.strictEqual(
    shouldSkipUnobservedAssert('查看', { type: 'click', description: '列表行的查看操作' }),
    true,
  );
  assert.strictEqual(
    shouldSkipUnobservedAssert('我的审批', { type: 'click', description: '列表行的查看操作' }),
    false,
  );

  const miss = formatMissingAssertDetail('查看', '@1 [button] "详情"\n@2 [button] "审批"');
  assert.ok(miss.includes('详情'), miss);
  assert.ok(miss.includes('审批'), miss);

  const { plan: compiled } = compileIntentToPlan({
    name: 'dup-assert',
    assertions: ['我的审批', '查看', '审批'],
    steps: [
      { id: 'step-5', action: 'assert', kind: 'text', expect: '查看' },
      { id: 'step-6', action: 'click', description: '列表行的查看操作' },
    ],
  });
  const extraAsserts = compiled.steps.filter(
    (s) => s.action.type === 'assert' && s.action.expect === '查看',
  );
  assert.strictEqual(extraAsserts.length, 1, 'duplicate 查看 assert must not be appended');
  assert.ok(
    !compiled.steps.some((s) => s.id && String(s.id).startsWith('assert-') && s.action.expect === '查看'),
    'click 重叠的顶层 assertions 不应再追加',
  );

  console.log('✅ verify-intent-assert passed');
}

main();
