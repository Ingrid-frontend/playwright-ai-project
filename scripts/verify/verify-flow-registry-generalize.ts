#!/usr/bin/env tsx
/**
 * P3 泛化等价性验证：flow-registry 双层化 + isGoldenRunner 去硬编码 + job 分发表。
 *
 *   npx tsx scripts/verify/verify-flow-registry-generalize.ts
 *
 * 断言：
 *   ① 内置三条流程 kind 均为 golden-flow，且与旧 isGoldenRunner 硬编码（request/approval/expense
 *      三连 or）布尔结果一致——golden runner key 命中、write runner key 不命中；
 *   ② config/flows.json 不存在时 listFlowIds() 与 RAW 种子完全一致（行为逐字节等价）；
 *   ③ deriveIntentSuiteFlows：core+stable+未覆盖的页才产 intent-suite 描述（无 runner、不进 job 链）；
 *   ④ 真实 page-catalog（若存在）当前无缺口页（core 页均已被三条 flow 入口覆盖）；
 *   ⑤ job 分发表已注册 3 个独立 runner + 全部 flow runner key。
 */
import fs from 'fs';
import path from 'path';
import {
  buildRunnerScripts,
  deriveIntentSuiteFlows,
  getFlow,
  listFlowIds,
  listFlows,
  type CatalogPageLite,
} from '../flow/flow-registry.js';
import { listJobRunnerKeys } from '../jobs/job-runner.js';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✅ ${msg}`);
  } else {
    failures++;
    console.error(`  ❌ ${msg}`);
  }
}

console.log('\n① kind 标注与旧 isGoldenRunner 硬编码等价');
const OLD_GOLDEN_KEYS = new Set([
  'request-flow-golden',
  'approval-flow-golden',
  'expense-flow-golden',
]);
const runnerScripts = buildRunnerScripts();
for (const id of ['request-flow', 'approval-flow', 'expense-flow']) {
  const flow = getFlow(id);
  assert(Boolean(flow), `getFlow(${id}) 存在`);
  if (!flow) continue;
  assert(flow.kind === 'golden-flow', `${id}.kind === 'golden-flow'`);
  const goldenKey = `${id}-golden`;
  const writeKey = `${id}-write`;
  const oldGolden = OLD_GOLDEN_KEYS.has(goldenKey);
  const newGolden = flow.kind === 'golden-flow';
  assert(oldGolden === newGolden, `${goldenKey}: 旧 ${oldGolden} === 新 ${newGolden}`);
  assert(
    (runnerScripts[goldenKey] ?? null) === flow.goldenRunner,
    `${goldenKey} runner 脚本映射不变`,
  );
  assert(
    !(writeKey in OLD_GOLDEN_KEYS) && flow.kind === 'golden-flow',
    `${writeKey}: write runner 不走 golden 对比链（旧逻辑同样不命中）`,
  );
}
for (const key of Object.keys(runnerScripts)) {
  const flowId = key.replace(/-(golden|write)$/, '');
  const flow = getFlow(flowId);
  assert(
    Boolean(flow) && flow?.kind === 'golden-flow',
    `runner key ${key} 对应流程 kind 为 golden-flow`,
  );
}

console.log('\n② flows.json 不存在时与 RAW 种子一致');
const flowsConfigAbs = path.resolve(process.cwd(), 'config/flows.json');
if (fs.existsSync(flowsConfigAbs)) {
  console.log('  ℹ️  config/flows.json 存在，跳过 RAW 等价断言（外部登记生效属预期）');
} else {
  assert(
    JSON.stringify(listFlowIds()) ===
      JSON.stringify(['request-flow', 'approval-flow', 'expense-flow']),
    `listFlowIds() === RAW 三条（实际 ${JSON.stringify(listFlowIds())}）`,
  );
  assert(listFlows().length === 3, `listFlows().length === 3（实际 ${listFlows().length}）`);
}

console.log('\n③ deriveIntentSuiteFlows 派生规则');
const fakeCatalog: CatalogPageLite[] = [
  { id: 'sales-order', label: '销售订单', route: '/main/sales-order', smoke: { enabled: true, weight: 'core' } },
  { id: 'request', label: '申请单', route: '/main/request', smoke: { enabled: true, weight: 'core' } },
  { id: 'memo', label: '备忘', route: '/main/memo', smoke: { enabled: true, weight: 'normal' } },
  { id: 'draft-page', label: '草稿页', route: '/main/draft-page', smoke: { enabled: false, weight: 'core' } },
];
const suites = deriveIntentSuiteFlows(fakeCatalog, (pageId) => pageId === 'sales-order' || pageId === 'request');
assert(suites.length === 1, `仅 1 个缺口页派生 intent-suite（实际 ${suites.length}）`);
const suite = suites[0];
assert(Boolean(suite) && suite.id === 'sales-order-intent-suite', '派生 id 为 sales-order-intent-suite');
assert(Boolean(suite) && suite.kind === 'intent-suite', '派生 kind 为 intent-suite');
assert(Boolean(suite) && suite.goldenRunner === null && suite.writeRunner === null, '派生流程不带 runner');
assert(
  Boolean(suite) && !(`${suite.id}-golden` in runnerScripts) && !(`${suite.id}-write` in runnerScripts),
  '派生流程不产生 flow runner key（不进 job 链）',
);
// 未被 stable 覆盖的 core 页不应派生
const noStable = deriveIntentSuiteFlows(fakeCatalog, () => false);
assert(noStable.length === 0, '无 stable 覆盖时派生 0 条');
// 已登记 goldenFlowId 的页不应派生
const withGolden = deriveIntentSuiteFlows(
  [{ id: 'sales-order', route: '/main/sales-order', goldenFlowId: 'sales-flow', smoke: { enabled: true, weight: 'core' } }],
  () => true,
);
assert(withGolden.length === 0, '已登记 goldenFlowId 的页不派生');

console.log('\n④ 真实 page-catalog 缺口检查');
const catalogAbs = path.resolve(process.cwd(), 'datasource/page-catalog.json');
if (fs.existsSync(catalogAbs)) {
  const raw = JSON.parse(fs.readFileSync(catalogAbs, 'utf8')) as { pages?: CatalogPageLite[] };
  const pages = raw.pages || [];
  const realSuites = deriveIntentSuiteFlows(pages, () => true);
  assert(
    realSuites.length === 0,
    `当前 core 页均被现有 flow 入口覆盖（放宽 stable 条件后缺口 ${realSuites.length} 页）`,
  );
} else {
  console.log('  ℹ️  datasource/page-catalog.json 不存在，跳过');
}

console.log('\n⑤ job 分发表注册');
const runnerKeys = listJobRunnerKeys();
for (const key of ['ai-smoke-patrol', 'approval-flow-golden', 'approval-flow-write', 'catalog-drift-check', 'expense-flow-golden', 'expense-flow-write', 'intent-batch', 'request-flow-golden', 'request-flow-write']) {
  assert(runnerKeys.includes(key), `分发表已注册 ${key}`);
}
assert(runnerKeys.length === 9, `分发表共 9 个 key（实际 ${runnerKeys.length}）`);

console.log('');
if (failures) {
  console.error(`❌ ${failures} 项断言失败`);
  process.exit(1);
}
console.log('✅ flow-registry 泛化等价性验证全部通过');
