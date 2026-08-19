/**
 * node scripts/verify/verify-intent-normalize.cjs
 */
const assert = require('assert');
const path = require('path');
const { require: tsxRequire } = require('tsx/cjs/api');

const mod = tsxRequire(path.join(__dirname, '../../src/utils/intent-normalize.ts'), __filename);
const { normalizeTestIntent, isWorkbenchApprovalIntent } = mod;

const raw = {
  name: '我的审批搜索',
  goal: '搜索申请人',
  env: 'dev',
  entry: '/',
  steps: [
    { id: 'x1', action: 'goto', path: '/' },
    { id: 'x2', action: 'assert', kind: 'text', expect: '我的审批' },
    { id: 'x3', action: 'click', description: '我的审批菜单' },
    { id: 'x4', action: 'fill', description: '申请人搜索输入框', value: '张三' },
    { id: 'x5', action: 'click', description: '搜索' },
    { id: 'x6', action: 'assert', kind: 'text', expect: '申请人' },
  ],
  assertions: ['我的审批'],
};

assert.strictEqual(isWorkbenchApprovalIntent(raw, '我的审批搜索申请人'), true);

const out = normalizeTestIntent(raw, { caseDescription: '我的审批搜索申请人' });
assert.strictEqual(out.entry, '/main/home');
assert.ok(out.steps.some((s) => s.action === 'click' && s.description === '顶栏工作台'));
assert.ok(out.steps.some((s) => s.action === 'click' && /我的审批/.test(s.description || '')));
assert.ok(!out.steps.some((s) => s.action === 'assert' && s.expect === '我的审批'));
const listAssert = out.steps.find((s) => s.action === 'assert' && s.expect === '审批');
assert.ok(listAssert);
const lastAssert = out.steps[out.steps.length - 1];
assert.strictEqual(lastAssert.expect, '张三');
assert.strictEqual(out.steps[0].id, 'step-1');
assert.ok(out.constraints.includes('禁止 nth()'));

const menuCase = normalizeTestIntent(
  {
    name: '菜单搜索我的审批',
    goal: '菜单搜索',
    env: 'dev',
    entry: '/main/home',
    steps: [
      { action: 'click', description: '左侧菜单搜索框' },
      { action: 'fill', description: '菜单搜索框', value: '我的审批' },
      { action: 'click', description: '菜单搜索结果我的审批' },
      { action: 'click', description: '顶栏工作台' },
      { action: 'click', description: '工作台左侧导航我的审批' },
      { action: 'fill', description: '申请人搜索输入框', value: '张三' },
    ],
  },
  { caseDescription: '在工作台左侧菜单搜索我的审批并进入' },
);
assert.ok(!menuCase.steps.some((s) => s.description === '顶栏工作台'));
assert.ok(!menuCase.steps.some((s) => s.description === '工作台左侧导航我的审批'));

const injected = normalizeTestIntent(
  { name: '侧栏搜审批', goal: '搜审批', env: 'dev', entry: '/main/home', steps: [] },
  { caseDescription: '在工作台左侧菜单搜索我的审批并进入' },
);
assert.ok(injected.steps.some((s) => s.action === 'click' && s.description === '侧栏菜单项我的审批'));

console.log('✅ verify-intent-normalize passed');
