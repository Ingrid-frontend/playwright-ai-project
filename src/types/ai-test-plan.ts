export type ExecutionStrategy = 'deterministic' | 'hybrid' | 'visual';

export type SemanticScope = 'page' | 'iframe';

export type SemanticAction =
  | { type: 'goto'; path?: string; url?: string; description?: string }
  | { type: 'act'; instruction: string; scope?: SemanticScope }
  | {
      type: 'click';
      description: string;
      scope?: SemanticScope;
      locatorHint?: string;
    }
  | {
      type: 'fill';
      description: string;
      value: string;
      scope?: SemanticScope;
      locatorHint?: string;
    }
  | {
      type: 'select';
      description: string;
      value: string;
      scope?: SemanticScope;
      locatorHint?: string;
    }
  | { type: 'assert'; description: string; scope?: SemanticScope }
  | { type: 'wait'; description?: string; timeoutMs?: number }
  | { type: 'screenshot'; label?: string };

export type EvidenceKind = 'screenshot' | 'dom' | 'console';

export interface SemanticStep {
  id: string;
  action: SemanticAction;
  strategy?: ExecutionStrategy;
  optional?: boolean;
  retries?: number;
  evidence?: EvidenceKind[];
}

export interface SemanticTestPlan {
  name: string;
  description?: string;
  env?: string;
  profile?: string;
  entry?: string;
  steps: SemanticStep[];
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`语义计划字段 ${field} 必须是非空字符串`);
  }
  return value;
}

function assertOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`语义计划字段 ${field} 必须是非空字符串`);
  }
  return value.trim() === '' ? undefined : value;
}

function assertAction(value: unknown, stepId: string): SemanticAction {
  if (!isRecord(value)) {
    throw new Error(`步骤 ${stepId} 的 action 必须是对象`);
  }

  const type = assertString(value.type, `${stepId}.action.type`);
  if (!ACTION_TYPES.has(type)) {
    throw new Error(`步骤 ${stepId} 包含未知动作类型: ${type}`);
  }

  switch (type) {
    case 'goto':
      return {
        type: 'goto',
        path: assertOptionalString(value.path, `${stepId}.action.path`),
        url: assertOptionalString(value.url, `${stepId}.action.url`),
        description: assertOptionalString(value.description, `${stepId}.action.description`),
      };
    case 'act':
      return {
        type: 'act',
        instruction: assertString(value.instruction, `${stepId}.action.instruction`),
        scope: assertOptionalString(value.scope, `${stepId}.action.scope`) as SemanticScope | undefined,
      };
    case 'click':
    case 'fill':
    case 'select': {
      const description = assertString(value.description, `${stepId}.action.description`);
      const base = {
        description,
        scope: assertOptionalString(value.scope, `${stepId}.action.scope`) as SemanticScope | undefined,
        locatorHint: assertOptionalString(value.locatorHint, `${stepId}.action.locatorHint`),
      };
      if (type === 'click') return { type: 'click', ...base };
      const actionValue = assertString(value.value, `${stepId}.action.value`);
      return type === 'fill'
        ? { type: 'fill', ...base, value: actionValue }
        : { type: 'select', ...base, value: actionValue };
    }
    case 'assert':
      return {
        type: 'assert',
        description: assertString(value.description, `${stepId}.action.description`),
        scope: assertOptionalString(value.scope, `${stepId}.action.scope`) as SemanticScope | undefined,
      };
    case 'wait': {
      const timeoutMs = value.timeoutMs;
      if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0)) {
        throw new Error(`步骤 ${stepId}.action.timeoutMs 必须是非负数字`);
      }
      return {
        type: 'wait',
        description: assertOptionalString(value.description, `${stepId}.action.description`),
        timeoutMs: timeoutMs as number | undefined,
      };
    }
    case 'screenshot':
      return {
        type: 'screenshot',
        label: assertOptionalString(value.label, `${stepId}.action.label`),
      };
    default:
      throw new Error(`步骤 ${stepId} 包含未知动作类型: ${type}`);
  }
}

export function validateSemanticTestPlan(value: unknown): SemanticTestPlan {
  if (!isRecord(value)) {
    throw new Error('语义计划必须是 JSON 对象');
  }

  const name = assertString(value.name, 'name');
  const steps = value.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('语义计划 steps 必须是非空数组');
  }

  const normalizedSteps = steps.map((step, index) => {
    if (!isRecord(step)) {
      throw new Error(`步骤 ${index + 1} 必须是对象`);
    }

    const id = assertString(step.id ?? String(index + 1), `steps[${index}].id`);
    const action = assertAction(step.action, id);
    const strategy = assertOptionalString(step.strategy, `steps[${index}].strategy`);
    if (strategy && !STRATEGIES.has(strategy as ExecutionStrategy)) {
      throw new Error(`步骤 ${id} 包含未知策略: ${strategy}`);
    }

    const retries = step.retries;
    if (retries !== undefined && (typeof retries !== 'number' || !Number.isFinite(retries) || retries < 0)) {
      throw new Error(`步骤 ${id}.retries 必须是非负数字`);
    }

    const evidence = step.evidence;
    if (
      evidence !== undefined &&
      (!Array.isArray(evidence) || evidence.some((item) => !['screenshot', 'dom', 'console'].includes(item as string)))
    ) {
      throw new Error(`步骤 ${id}.evidence 只能包含 screenshot/dom/console`);
    }

    return {
      id,
      action,
      strategy: (strategy as ExecutionStrategy | undefined) ?? 'hybrid',
      optional: step.optional === true,
      retries: (retries as number | undefined) ?? 0,
      evidence: (evidence as EvidenceKind[] | undefined) ?? ['screenshot'],
    } satisfies SemanticStep;
  });

  return {
    name,
    description: assertOptionalString(value.description, 'description'),
    env: assertOptionalString(value.env, 'env'),
    profile: assertOptionalString(value.profile, 'profile'),
    entry: assertOptionalString(value.entry, 'entry'),
    steps: normalizedSteps,
  };
}
