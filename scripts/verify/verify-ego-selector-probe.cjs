#!/usr/bin/env node
/**
 * 离线校验 ego 选择器体检的两块纯逻辑：
 *   1. spec 定位链解析（scanSpecSelectors / parseLocatorExpression）
 *   2. 多 frame 结果合并（mergeFrameResults）
 *
 * 不依赖 ego lite / 浏览器，可在 CI 中运行：
 *   node scripts/verify/verify-ego-selector-probe.cjs
 */
const assert = require('assert');
const path = require('path');
const { loadTsUtil } = require('../../src/utils/load-ts-util.cjs');

const ROOT = path.resolve(__dirname, '../..');

function main() {
  const { parseLocatorExpression } = loadTsUtil('spec-selectors.ts');
  const { mergeFrameResults } = loadTsUtil('ego-selector-probe.ts');

  // 1) getByText + filter/first 收窄调用应被跳过
  const textChain = parseLocatorExpression(
    "baseContext.getByText('我的审批').filter({ visible: true }).first()",
  );
  assert.deepStrictEqual(textChain, [{ kind: 'text', value: '我的审批', exact: false }]);

  // 2) getByRole 的 name/exact 选项与链式收窄
  const roleChain = parseLocatorExpression(
    "baseContext.getByRole('cell', { name: '1', exact: true }).filter({ visible: true }).first()",
  );
  assert.deepStrictEqual(roleChain, [{ kind: 'role', role: 'cell', name: '1', exact: true }]);

  // 3) 多段链：role -> label
  const nested = parseLocatorExpression(
    "baseContext.getByRole('columnheader', { name: '图标: down' }).getByLabel('', { exact: true }).first()",
  );
  assert.strictEqual(nested.length, 2);
  assert.strictEqual(nested[0].kind, 'role');
  assert.strictEqual(nested[1].kind, 'label');

  // 4) CSS 选择器
  const css = parseLocatorExpression(
    "baseContext.locator('.ant-table-selection-down > .anticon > svg').first()",
  );
  assert.deepStrictEqual(css, [{ kind: 'css', value: '.ant-table-selection-down > .anticon > svg' }]);

  // 5) 不含已知定位方法的表达式应返回 null（进 unparsed，交人工确认）
  assert.strictEqual(parseLocatorExpression('someHelper(page)'), null);

  // 6) 多 frame 合并：主 frame missing、子 frame ok，应取 ok 并带上 frameUrl
  const steps = [
    { index: 1, stepName: '我的审批', line: 46, raw: 'x', inFrame: true, parts: [], optional: false },
  ];
  const merged = mergeFrameResults(steps, [
    {
      frameUrl: 'https://app.example.com/',
      text: '',
      results: [{ index: 1, stepName: '我的审批', line: 46, raw: 'x', optional: false, total: 0, visible: 0, brokenAtPart: 1, samples: [], verdict: 'missing' }],
    },
    {
      frameUrl: 'https://app.example.com/inner',
      text: '',
      results: [{ index: 1, stepName: '我的审批', line: 46, raw: 'x', optional: false, total: 1, visible: 1, brokenAtPart: 0, samples: ['a :: "我的审批"'], verdict: 'ok' }],
    },
  ]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].verdict, 'ok');
  assert.strictEqual(merged[0].frameUrl, 'https://app.example.com/inner');

  // 7) 所有 frame 都没有该步骤结果时，降级为 missing 而不是抛错
  const orphan = mergeFrameResults(steps, [{ frameUrl: 'https://a/', text: '', results: [] }]);
  assert.strictEqual(orphan[0].verdict, 'missing');

  console.log('✅ ego 选择器体检逻辑校验通过（7 项）');
  console.log(`   项目根: ${ROOT}`);
}

try {
  main();
} catch (e) {
  console.error('❌', e && e.stack ? e.stack : e);
  process.exit(1);
}
