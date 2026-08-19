/**
 * node scripts/verify/verify-ego-nav-guard.cjs
 */
const assert = require('assert');
const path = require('path');
const { require: tsxRequire } = require('tsx/cjs/api');

const mod = tsxRequire(path.join(__dirname, '../../src/runtime/ego-nav-guard.ts'), __filename);
const {
  isApprovalFlowAdminPage,
  navClickKind,
  verifyNavClickOutcome,
  resolveNavClickOps,
  pickWorkbenchTopNav,
  isHomePath,
  normalizeHuilianyiEntryPath,
  detectHuilianyiPageContext,
  WORKBENCH_HOME_PATH,
} = mod;

const adminSnap = `
tab "工作台" [ref=1]
tab "系统管理" [ref=2]
button "导入" [ref=3]
button "导出" [ref=4]
button "批量维护" [ref=5]
text "审批流" [ref=6]
text "流程列表" [ref=7]
`;

assert.strictEqual(isApprovalFlowAdminPage(adminSnap), true);
assert.strictEqual(isApprovalFlowAdminPage('text "待办" [ref=1]'), false);

assert.strictEqual(navClickKind('顶栏工作台'), 'workbench-top');
assert.strictEqual(navClickKind('工作台左侧导航我的审批'), 'my-approval');
assert.strictEqual(navClickKind('搜索'), null);

assert.ok(verifyNavClickOutcome('workbench-top', adminSnap));
assert.ok(verifyNavClickOutcome('my-approval', adminSnap));

const nodes = [
  { ref: 10, role: 'tab', name: '工作台', raw: 'tab "工作台" [ref=10]' },
  { ref: 11, role: 'tab', name: '系统管理', raw: 'tab "系统管理" [ref=11]' },
  { ref: 12, role: 'menuitem', name: '我的审批', raw: 'menuitem "我的审批" [ref=12]' },
];

const anchorNodes = [
  { ref: 20, role: 'anchor', name: '工作台', raw: 'anchor "工作台" [ref=20]' },
  { ref: 21, role: 'anchor', name: '系统管理', raw: 'anchor "系统管理" [ref=21]' },
];

const wbOps = resolveNavClickOps(nodes, '顶栏工作台', 'workbench-top');
assert.strictEqual(wbOps?.[0]?.ref, 10);

const menuNodes = [
  { ref: 40, role: 'menu', name: '我的审批', raw: 'menu [ref=40] | text "我" | text "的" | text "审" | text "批"' },
  { ref: 41, role: 'menuitem', name: '我的代理', raw: 'menuitem "我的代理" [ref=41]' },
];
assert.strictEqual(mod.pickMenuSearchResult(menuNodes, '我的审批')?.ref, 40);
assert.strictEqual(mod.extractMenuSearchLabel('侧栏菜单项我的审批'), '我的审批');

const apOps = resolveNavClickOps(nodes, '工作台左侧导航我的审批', 'my-approval');
assert.strictEqual(apOps?.[0]?.ref, 12);

const splitMenuNodes = [
  { ref: 30, role: 'menuitem', name: '我 的 审 批', raw: 'menuitem [ref=30] | text "我" | text "的" | text "审" | text "批"' },
  { ref: 31, role: 'menuitem', name: '我的代理', raw: 'menuitem "我的代理" [ref=31]' },
];
const menuPick = mod.pickMenuSearchResult(splitMenuNodes, '我的审批');
assert.strictEqual(menuPick?.ref, 30);
const menuOps = resolveNavClickOps(splitMenuNodes, '菜单搜索结果我的审批', 'my-approval');
assert.strictEqual(menuOps?.[0]?.ref, 30);
assert.strictEqual(mod.isMenuSearchResultClick('菜单搜索结果我的审批'), true);

assert.strictEqual(pickWorkbenchTopNav(nodes)?.ref, 10);
assert.strictEqual(pickWorkbenchTopNav(anchorNodes)?.ref, 20);
assert.strictEqual(normalizeHuilianyiEntryPath('dev', '/'), WORKBENCH_HOME_PATH);
assert.strictEqual(normalizeHuilianyiEntryPath('dev', '/main/approve'), '/main/approve');
assert.strictEqual(isHomePath('/'), true);
assert.strictEqual(isHomePath('https://dev.huilianyi.com/'), true);
assert.strictEqual(isHomePath('/main/approve'), false);

const archiveSnap = `
button "重置" [ref=1]
button "搜索" [ref=2]
button "新建资料" [ref=3]
text "资料归集" [ref=4]
button "加入中转站" [ref=5]
`;
const ctx = detectHuilianyiPageContext(archiveSnap);
assert.strictEqual(ctx?.key, 'e-archive-collect');
assert.ok(mod.isEArchiveModulePage(archiveSnap));

const archiveHomeSnap = `
text "e档案" [ref=1]
text "待补充资料" [ref=2]
button "快捷入口" [ref=3]
text "管理员首页" [ref=4]
text "我的审批" [ref=5]
`;
assert.ok(mod.isEArchiveModulePage(archiveHomeSnap));
assert.ok(verifyNavClickOutcome('workbench-top', archiveHomeSnap));
assert.ok(verifyNavClickOutcome('my-approval', archiveHomeSnap));

const applicantNodes = [
  { ref: 1, role: 'textbox', name: '菜单搜索', raw: 'textbox "菜单搜索" [ref=1]' },
  { ref: 2, role: 'textbox', name: '申请人', raw: 'textbox "申请人" [ref=2]' },
];
assert.strictEqual(mod.pickApplicantSearchInput(applicantNodes)?.ref, 2);

console.log('✅ verify-ego-nav-guard passed');
