import type { EvidenceKind, ExecutionStrategy, SemanticScope } from './ai-test-plan.js';

const ACTION_TYPES = new Set([
  'goto',
  'act',
  'click',
  'fill',
  'select',
  'assert',
  'wait',
  'screenshot',
]);

const STRATEGIES = new Set<ExecutionStrategy>(['deterministic', 'hybrid', 'visual']);
const EVIDENCE = new Set<EvidenceKind>(['screenshot', 'dom', 'console']);
const ASSERT_KINDS = new Set(['text', 'visible', 'url', 'count']);

export type AssertKind = 'text' | 'visible' | 'url' | 'count';

export interface TestIntentStep {
  id?: string;
  action: string;
  path?: string;
  url?: string;
  description?: string;
  instruction?: string;
  value?: string;
  /** assert: text|visible|url|count */
  kind?: AssertKind;
  /** assert 期望值（可见原文 / url 片段 / 数量） */
  expect?: string;
  /** count 断言可选目标描述 */
  target?: string;
  scope?: SemanticScope;
  locatorHint?: string;
  label?: string;
  snapshotName?: string;
  state?: string;
  mode?: 'stable' | 'fast';
  timeoutMs?: number;
  strategy?: ExecutionStrategy;
  optional?: boolean;
  retries?: number;
  evidence?: EvidenceKind[];
}

export interface TestIntent {
  name: string;
  goal?: string;
  description?: string;
  env?: string;
  profile?: string;
  entry?: string;
  scriptKey?: string;
  styleChecks?: Array<{
    key: string;
    selector: string;
    required?: boolean;
    frame?: 'main' | 'first';
    props?: string[];
    label?: string;
    snapshotName?: string;
    state?: string;
  }>;
  preconditions?: string[];
  constraints?: string[];
  assertions?: string[];
  steps: TestIntentStep[];
}

/** 叙述句：不能当可见文案断言 */
const NARRATIVE_RE =
  /页面包含|应该|应当|相关内容|出现了|可以看到|验证|确保|成功提示|变为|变成|必须|需要/;

export function isNarrativeAssertText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (NARRATIVE_RE.test(t)) return true;
  if (t.length > 24 && /[\u4e00-\u9fa5]{2,}.*(包含|出现|显示)/.test(t)) return true;
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`测试意图字段 ${field} 必须是非空字符串`);
  }
  return value.trim();
}

function assertOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`测试意图字段 ${field} 必须是字符串`);
  }
  return value.trim() === '' ? undefined : value.trim();
}

function assertStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`测试意图字段 ${field} 必须是非空字符串数组`);
  }
  return value.map((item) => (item as string).trim());
}

function validateAssertExpect(text: string, field: string): string {
  const v = assertString(text, field);
  if (isNarrativeAssertText(v)) {
    throw new Error(
      `${field} 不能是自然语言叙述（如「页面包含…」），请改用可见原文短文案，并设置 kind: text|visible|url|count`,
    );
  }
  return v;
}

function validateStep(raw: unknown, index: number): TestIntentStep {
  if (!isRecord(raw)) {
    throw new Error(`步骤 ${index + 1} 必须是对象`);
  }

  const action = assertString(raw.action, `steps[${index}].action`);
  if (!ACTION_TYPES.has(action)) {
    throw new Error(`步骤 ${index + 1} 包含未知动作类型: ${action}`);
  }

  const strategy = assertOptionalString(raw.strategy, `steps[${index}].strategy`);
  if (strategy && !STRATEGIES.has(strategy as ExecutionStrategy)) {
    throw new Error(`步骤 ${index + 1} 包含未知策略: ${strategy}`);
  }

  const retries = raw.retries;
  if (retries !== undefined && (typeof retries !== 'number' || !Number.isFinite(retries) || retries < 0)) {
    throw new Error(`步骤 ${index + 1}.retries 必须是非负数字`);
  }

  const timeoutMs = raw.timeoutMs;
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0)) {
    throw new Error(`步骤 ${index + 1}.timeoutMs 必须是非负数字`);
  }

  const evidence = raw.evidence;
  if (evidence !== undefined) {
    if (!Array.isArray(evidence) || evidence.some((item) => !EVIDENCE.has(item as EvidenceKind))) {
      throw new Error(`步骤 ${index + 1}.evidence 只能包含 screenshot/dom/console`);
    }
  }

  if (action === 'fill' || action === 'select') {
    assertString(raw.value, `steps[${index}].value`);
  }
  if (action === 'act') {
    assertString(raw.instruction, `steps[${index}].instruction`);
  }

  let kind: AssertKind | undefined;
  let expectValue: string | undefined;
  let target: string | undefined;
  let description = assertOptionalString(raw.description, `steps[${index}].description`);

  if (action === 'assert') {
    const kindRaw = assertOptionalString(raw.kind, `steps[${index}].kind`);
    if (kindRaw && !ASSERT_KINDS.has(kindRaw)) {
      throw new Error(`步骤 ${index + 1}.kind 必须是 text|visible|url|count`);
    }
    kind = (kindRaw as AssertKind | undefined) || 'text';
    const expectRaw =
      assertOptionalString(raw.expect, `steps[${index}].expect`) ||
      description;
    if (!expectRaw) {
      throw new Error(`步骤 ${index + 1} assert 需要 expect 或 description`);
    }
    expectValue = validateAssertExpect(expectRaw, `steps[${index}].expect`);
    description = expectValue;
    target = assertOptionalString(raw.target, `steps[${index}].target`);
    if (kind === 'count') {
      if (!/^\d+$/.test(expectValue)) {
        throw new Error(`步骤 ${index + 1} kind=count 时 expect 必须是非负整数`);
      }
    }
  } else if (action === 'click' || action === 'fill' || action === 'select') {
    assertString(raw.description, `steps[${index}].description`);
  }

  return {
    id: assertOptionalString(raw.id, `steps[${index}].id`),
    action,
    path: assertOptionalString(raw.path, `steps[${index}].path`),
    url: assertOptionalString(raw.url, `steps[${index}].url`),
    description,
    instruction: assertOptionalString(raw.instruction, `steps[${index}].instruction`),
    value: assertOptionalString(raw.value, `steps[${index}].value`),
    kind,
    expect: expectValue,
    target,
    scope: assertOptionalString(raw.scope, `steps[${index}].scope`) as SemanticScope | undefined,
    locatorHint: assertOptionalString(raw.locatorHint, `steps[${index}].locatorHint`),
    label: assertOptionalString(raw.label, `steps[${index}].label`),
    snapshotName: assertOptionalString(raw.snapshotName, `steps[${index}].snapshotName`),
    state: assertOptionalString(raw.state, `steps[${index}].state`),
    mode: assertOptionalString(raw.mode, `steps[${index}].mode`) as 'stable' | 'fast' | undefined,
    timeoutMs: timeoutMs as number | undefined,
    strategy: strategy as ExecutionStrategy | undefined,
    optional: raw.optional === true,
    retries: retries as number | undefined,
    evidence: evidence as EvidenceKind[] | undefined,
  };
}

export function validateTestIntent(value: unknown): TestIntent {
  if (!isRecord(value)) {
    throw new Error('测试意图必须是对象');
  }

  const name = assertString(value.name, 'name');
  const steps = value.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('测试意图 steps 必须是非空数组');
  }

  const goal = assertOptionalString(value.goal, 'goal');
  const description = assertOptionalString(value.description, 'description');
  const assertions = assertStringArray(value.assertions, 'assertions');
  if (assertions) {
    for (let i = 0; i < assertions.length; i++) {
      validateAssertExpect(assertions[i], `assertions[${i}]`);
    }
  }

  return {
    name,
    goal: goal || description,
    description,
    env: assertOptionalString(value.env, 'env'),
    profile: assertOptionalString(value.profile, 'profile'),
    entry: assertOptionalString(value.entry, 'entry'),
    scriptKey: assertOptionalString(value.scriptKey, 'scriptKey'),
    styleChecks: Array.isArray(value.styleChecks)
      ? (value.styleChecks as TestIntent['styleChecks'])
      : undefined,
    preconditions: assertStringArray(value.preconditions, 'preconditions'),
    constraints: assertStringArray(value.constraints, 'constraints'),
    assertions,
    steps: steps.map((step, index) => validateStep(step, index)),
  };
}
