import {
  isHomePath,
  isHuilianyiEnv,
  normalizeHuilianyiEntryPath,
  WORKBENCH_HOME_PATH,
} from '../runtime/ego-nav-guard.js';
import type { TestIntent, TestIntentStep } from '../types/test-intent.js';

const DEFAULT_CONSTRAINTS = ['禁止 nth()', '禁止把 @N 写入定义'];

const OP_ASSERT = ['查看', '编辑', '删除', '通过', '提交', '取消', '关闭'];

export type NormalizeTestIntentOpts = {
  caseDescription?: string;
};

function blob(intent: TestIntent, caseText?: string): string {
  return [
    intent.name,
    intent.goal,
    intent.description,
    caseText,
    ...(intent.assertions || []),
    ...intent.steps.map((s) => s.description || s.expect || ''),
  ]
    .filter(Boolean)
    .join(' ');
}

export function isWorkbenchApprovalIntent(intent: TestIntent, caseText?: string): boolean {
  return /我的审批|待办|搜.*申请人|申请人.*搜/.test(blob(intent, caseText));
}

function stepPath(step: TestIntentStep): string | undefined {
  return step.path || step.url;
}

function normalizeEntry(intent: TestIntent): void {
  const env = intent.env || 'stage';
  if (intent.entry) {
    intent.entry = normalizeHuilianyiEntryPath(env, intent.entry) || intent.entry;
  }
}

function normalizeGotoSteps(intent: TestIntent): void {
  const env = intent.env || 'stage';
  for (const step of intent.steps) {
    if (step.action !== 'goto') continue;
    const raw = step.path || step.url;
    if (!raw) continue;
    const normalized = normalizeHuilianyiEntryPath(env, raw);
    if (!normalized || normalized === raw) continue;
    if (step.path) step.path = normalized;
    else step.url = normalized;
  }
}

function dedupeEntryGoto(intent: TestIntent): void {
  const entry = intent.entry?.trim();
  if (!entry || intent.steps.length < 2 || intent.steps[0].action !== 'goto') return;

  const env = intent.env || 'stage';
  const gotoRaw = stepPath(intent.steps[0]);
  if (!gotoRaw) return;
  const normEntry = normalizeHuilianyiEntryPath(env, entry) || entry;
  const normGoto = normalizeHuilianyiEntryPath(env, gotoRaw) || gotoRaw;
  if (normEntry === normGoto || entry === gotoRaw) intent.steps.shift();
}

function hasWorkbenchTopClick(steps: TestIntentStep[]): boolean {
  return steps.some(
    (s) =>
      s.action === 'click' &&
      /工作台/.test(s.description || '') &&
      (/顶栏|顶部|导航/.test(s.description || '') || s.description === '工作台'),
  );
}

function hasMyApprovalClick(steps: TestIntentStep[]): boolean {
  return steps.some((s) => s.action === 'click' && /我的审批/.test(s.description || ''));
}

function injectWorkbenchNav(intent: TestIntent, caseText?: string): void {
  if (!isWorkbenchApprovalIntent(intent, caseText)) return;

  const env = intent.env || 'stage';
  if (isHuilianyiEnv(env) && intent.entry && isHomePath(intent.entry)) {
    intent.entry = WORKBENCH_HOME_PATH;
  }

  const toInsert: TestIntentStep[] = [];
  if (!hasWorkbenchTopClick(intent.steps)) {
    toInsert.push({ action: 'click', description: '顶栏工作台', optional: false });
  }
  if (!hasMyApprovalClick(intent.steps)) {
    toInsert.push({ action: 'click', description: '工作台左侧导航我的审批', optional: false });
  }
  if (!toInsert.length) return;

  let at = 0;
  if (intent.steps[0]?.action === 'goto') at = 1;
  intent.steps.splice(at, 0, ...toInsert);
}

function stripSpuriousAsserts(intent: TestIntent, caseText?: string): void {
  const steps = intent.steps;
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.action !== 'assert') continue;
    const expect = (step.expect || step.description || '').trim();
    const next = steps[i + 1];

    if (next && (next.action === 'click' || next.action === 'fill' || next.action === 'select')) {
      const desc = (next.description || '').trim();
      if (desc && (desc.includes(expect) || expect.includes(desc))) {
        steps.splice(i, 1);
        continue;
      }
    }

    if (isWorkbenchApprovalIntent(intent, caseText) && expect === '我的审批') {
      steps.splice(i, 1);
      continue;
    }

    if (OP_ASSERT.some((w) => expect === w)) steps.splice(i, 1);
  }
}

function normalizeListAsserts(intent: TestIntent, caseText?: string): void {
  if (!isWorkbenchApprovalIntent(intent, caseText)) return;
  for (const step of intent.steps) {
    if (step.action !== 'assert') continue;
    const expect = (step.expect || '').trim();
    if (expect === '我的审批' || expect === '待办') {
      step.expect = '审批';
      step.description = '审批';
      step.kind = 'text';
    }
  }
  if (intent.assertions) {
    intent.assertions = intent.assertions.map((a) =>
      a === '我的审批' || a === '待办' ? '审批' : a,
    );
  }
}

function normalizeSearchAsserts(intent: TestIntent): void {
  for (let i = 0; i < intent.steps.length; i++) {
    const step = intent.steps[i];
    if (step.action !== 'fill' || !step.value) continue;
    const next = intent.steps[i + 1];
    if (next?.action !== 'assert') continue;
    if (/申请人|名称|搜索|关键字|关键词/.test(step.description || '')) {
      next.expect = step.value;
      next.description = step.value;
      next.kind = next.kind || 'text';
    }
  }

  for (const step of intent.steps) {
    if (step.action !== 'assert') continue;
    const expect = (step.expect || '').trim();
    if (!/^(申请人|名称|关键字|关键词)$/.test(expect)) continue;
    for (let j = intent.steps.indexOf(step) - 1; j >= 0; j--) {
      const prev = intent.steps[j];
      if (prev.action === 'fill' && prev.value) {
        step.expect = prev.value;
        step.description = prev.value;
        break;
      }
    }
  }
}

function renumberSteps(intent: TestIntent): void {
  intent.steps.forEach((step, i) => {
    step.id = `step-${i + 1}`;
  });
}

function mergeConstraints(intent: TestIntent): void {
  const set = new Set(DEFAULT_CONSTRAINTS);
  for (const c of intent.constraints || []) set.add(c);
  intent.constraints = [...set];
}

function ensureListAssert(intent: TestIntent, caseText?: string): void {
  if (!isWorkbenchApprovalIntent(intent, caseText)) return;
  const hasListAssert = intent.steps.some(
    (s) => s.action === 'assert' && /^(待办|审批|单据)$/.test((s.expect || '').trim()),
  );
  if (hasListAssert) return;

  let idx = intent.steps.findIndex((s) => s.action === 'click' && /我的审批/.test(s.description || ''));
  if (idx < 0) {
    idx = intent.steps.findIndex(
      (s) => s.action === 'click' && /工作台/.test(s.description || '') && /导航|顶栏|左侧/.test(s.description || ''),
    );
  }
  if (idx < 0) return;

  intent.steps.splice(idx + 1, 0, {
    action: 'assert',
    kind: 'text',
    expect: '审批',
    description: '审批',
    optional: false,
    evidence: ['screenshot'],
  });
}

function needsMenuSearch(caseText?: string): boolean {
  return Boolean(caseText && /搜索.*菜单|菜单.*搜索/.test(caseText));
}

function injectMenuSearch(intent: TestIntent, caseText?: string): void {
  if (!needsMenuSearch(caseText) || !isWorkbenchApprovalIntent(intent, caseText)) return;
  const hasMenuFill = intent.steps.some(
    (s) => s.action === 'fill' && /菜单/.test(s.description || '') && s.value?.includes('我的审批'),
  );
  if (hasMenuFill) return;

  let at = 0;
  if (intent.steps[0]?.action === 'goto') at = 1;
  if (!hasWorkbenchTopClick(intent.steps)) {
    intent.steps.splice(at, 0, { action: 'click', description: '顶栏工作台', optional: false });
    at += 1;
  }
  intent.steps.splice(
    at,
    0,
    { action: 'click', description: '左侧菜单搜索框', optional: false },
    { action: 'fill', description: '菜单搜索框', value: '我的审批', optional: false },
    { action: 'click', description: '侧栏菜单项我的审批', optional: false },
  );
}

function dedupeNavAfterMenuSearch(intent: TestIntent): void {
  let menuIdx = -1;
  for (let i = 0; i < intent.steps.length; i++) {
    const s = intent.steps[i];
    if (s.action !== 'fill' || !/菜单/.test(s.description || '')) continue;
    if (intent.steps[i + 1]?.action === 'click') menuIdx = i + 1;
  }
  if (menuIdx < 0) {
    menuIdx = intent.steps.findIndex(
      (s) => s.action === 'click' && /侧栏菜单项|菜单搜索|搜索结果/.test(s.description || ''),
    );
  }
  if (menuIdx < 0) return;
  intent.steps = intent.steps.filter((s, i) => {
    if (i <= menuIdx) return true;
    if (s.action !== 'click') return true;
    const d = s.description || '';
    if (/顶栏工作台/.test(d) || /工作台左侧导航我的审批/.test(d)) return false;
    return true;
  });
}

export function normalizeTestIntent(intent: TestIntent, opts: NormalizeTestIntentOpts = {}): TestIntent {
  const out: TestIntent = JSON.parse(JSON.stringify(intent)) as TestIntent;
  const caseText = opts.caseDescription?.trim();

  normalizeEntry(out);
  normalizeGotoSteps(out);
  dedupeEntryGoto(out);
  injectWorkbenchNav(out, caseText);
  injectMenuSearch(out, caseText);
  dedupeNavAfterMenuSearch(out);
  normalizeListAsserts(out, caseText);
  stripSpuriousAsserts(out, caseText);
  ensureListAssert(out, caseText);
  normalizeSearchAsserts(out);
  renumberSteps(out);
  mergeConstraints(out);

  return out;
}

export function summarizeRunSteps(
  steps: Array<{
    id?: string;
    passed?: boolean;
    action?: { type?: string; description?: string; path?: string; expect?: string };
  }>,
): string {
  return steps
    .map((s) => {
      const act = s.action || {};
      const label =
        act.description ||
        act.expect ||
        act.path ||
        act.type ||
        '';
      const mark = s.passed ? 'ok' : 'fail';
      return `${mark} ${s.id || '?'}: ${act.type || '?'} ${label}`.trim();
    })
    .join('\n');
}
