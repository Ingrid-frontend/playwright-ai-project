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

export interface TestIntentStep {
  id?: string;
  action: string;
  path?: string;
  url?: string;
  description?: string;
  instruction?: string;
  value?: string;
  scope?: SemanticScope;
  locatorHint?: string;
  label?: string;
  timeoutMs?: number;
  strategy?: ExecutionStrategy;
  optional?: boolean;
  retries?: number;
  evidence?: EvidenceKind[];
}

export interface TestIntent {
  name: string;
  description?: string;
  env?: string;
  profile?: string;
  entry?: string;
  preconditions?: string[];
  constraints?: string[];
  assertions?: string[];
  steps: TestIntentStep[];
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
  if (action === 'click' || action === 'fill' || action === 'select' || action === 'assert') {
    assertString(raw.description, `steps[${index}].description`);
  }

  return {
    id: assertOptionalString(raw.id, `steps[${index}].id`),
    action,
    path: assertOptionalString(raw.path, `steps[${index}].path`),
    url: assertOptionalString(raw.url, `steps[${index}].url`),
    description: assertOptionalString(raw.description, `steps[${index}].description`),
    instruction: assertOptionalString(raw.instruction, `steps[${index}].instruction`),
    value: assertOptionalString(raw.value, `steps[${index}].value`),
    scope: assertOptionalString(raw.scope, `steps[${index}].scope`) as SemanticScope | undefined,
    locatorHint: assertOptionalString(raw.locatorHint, `steps[${index}].locatorHint`),
    label: assertOptionalString(raw.label, `steps[${index}].label`),
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

  return {
    name,
    description: assertOptionalString(value.description, 'description'),
    env: assertOptionalString(value.env, 'env'),
    profile: assertOptionalString(value.profile, 'profile'),
    entry: assertOptionalString(value.entry, 'entry'),
    preconditions: assertStringArray(value.preconditions, 'preconditions'),
    constraints: assertStringArray(value.constraints, 'constraints'),
    assertions: assertStringArray(value.assertions, 'assertions'),
    steps: steps.map((step, index) => validateStep(step, index)),
  };
}
