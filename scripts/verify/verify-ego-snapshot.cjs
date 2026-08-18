#!/usr/bin/env node
/**
 * 离线校验 ego Snapshot 解析（不依赖 ego lite）
 *   node scripts/verify/verify-ego-snapshot.cjs
 */
const assert = require('assert');
const path = require('path');
const { require: tsxRequire } = require('tsx/cjs/api');

const mod = tsxRequire(path.join(__dirname, '../../src/runtime/ego-snapshot.ts'), __filename);
const { parseSnapshotText, findCandidates, snapshotContainsText, isListActionProbe, pickVisibleListAction } = mod;

function main() {
  // 样本取自 ego lite 真实 snapshotText 输出：缩进树 + 名称在子 text 行
  const nested = `root
  heading
    text "我的审批"
  container
    anchor [ref=8, loc=href:/page.html#list, url=http://127.0.0.1:8799/page.html#list]
      text "审批列表"
    anchor [ref=10, loc=href:/page.html#other, url=http://127.0.0.1:8799/page.html#other]
      text "其他"
  text "关键字"
  textbox [ref=1, loc=css:input[placeholder="请输入关键字"]]
    text "请输入关键字"
    container
  button [ref=16, loc=unstable]
    text "提交"
`;

  const nodes = parseSnapshotText(nested);
  const byRef = (ref) => nodes.find((n) => n.ref === ref);
  assert.strictEqual(nodes.length, 4, `expected 4 ref nodes, got ${nodes.length}`);

  // role 不能被 loc=/url= 元数据污染，name 必须来自子 text 行
  assert.strictEqual(byRef(16)?.role, 'button');
  assert.strictEqual(byRef(16)?.name, '提交');
  assert.strictEqual(byRef(8)?.role, 'anchor');
  assert.strictEqual(byRef(8)?.name, '审批列表');
  assert.strictEqual(byRef(1)?.role, 'textbox');
  assert.strictEqual(byRef(1)?.name, '请输入关键字');

  // 确定性候选：必须唯一命中，否则执行期会退化到 LLM 兜底
  const submit = findCandidates(nodes, '提交', { roles: ['button', 'anchor'] });
  assert.deepStrictEqual(submit.map((n) => n.ref), [16]);
  const listLink = findCandidates(nodes, '审批列表', { roles: ['button', 'anchor'] });
  assert.deepStrictEqual(listLink.map((n) => n.ref), [8]);

  // 名称直接写在同一行的形态（textbox "姓名" [ref=1, …]）
  const inline = `root
  textbox "姓名" [ref=1, loc=css:input[aria-label="姓名"]]
  combobox "类型" [ref=3, loc=css:select[aria-label="类型"]]
    text "甲"
  checkbox [ref=4, loc=unstable]
  text "同意"
  button "提交表单" [ref=19, loc=css:button[aria-label="提交表单"]]
`;
  const inlineNodes = parseSnapshotText(inline);
  const inlineByRef = (ref) => inlineNodes.find((n) => n.ref === ref);
  assert.strictEqual(inlineByRef(1)?.name, '姓名');
  assert.strictEqual(inlineByRef(1)?.role, 'textbox');
  assert.strictEqual(inlineByRef(3)?.name, '类型');
  assert.strictEqual(inlineByRef(19)?.name, '提交表单');
  // 无名控件由紧邻同级 text 兄弟提供标签
  assert.strictEqual(inlineByRef(4)?.name, '同意');

  // 断言只看可见文案
  assert.strictEqual(snapshotContainsText(nested, '审批列表'), true);
  assert.strictEqual(snapshotContainsText(nested, '我的审批'), true);
  assert.strictEqual(snapshotContainsText(nested, '不存在的文案XYZ'), false);
  // 相邻 text 节点拼接
  const splitLabel = `root
  text "审批"
  text "意见"
`;
  assert.strictEqual(snapshotContainsText(splitLabel, '审批意见'), true);
  // 防元数据假阳性：css/href/url 等元数据不得让断言通过
  assert.strictEqual(snapshotContainsText(nested, 'loc=css'), false);
  assert.strictEqual(snapshotContainsText(nested, 'placeholder'), false);
  assert.strictEqual(snapshotContainsText(nested, '127.0.0.1:8799'), false);
  assert.strictEqual(snapshotContainsText(inline, 'aria-label'), false);

  const listSnap = `root
  heading "我的审批" [ref=1]
  button "详情" [ref=2]
  button "审批" [ref=3]
`;
  const listNodes = parseSnapshotText(listSnap);
  assert.strictEqual(isListActionProbe('我的审批'), false);
  assert.strictEqual(isListActionProbe('列表行的查看操作'), true);
  assert.strictEqual(isListActionProbe('查看'), true);
  const picked = pickVisibleListAction(listNodes, '列表行的查看操作', {
    roles: ['button', 'anchor', 'link'],
  });
  assert.strictEqual(picked?.name, '详情');
  assert.strictEqual(picked?.ref, 2);
  const exactView = pickVisibleListAction(listNodes, '查看', { roles: ['button'] });
  assert.strictEqual(exactView?.name, '详情');

  console.log('✅ verify-ego-snapshot passed');
}

main();
