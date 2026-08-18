import {
  validateSemanticTestPlan,
  type SemanticAction,
  type SemanticStep,
  type SemanticTestPlan,
} from '../types/ai-test-plan.js';
import { validateTestIntent, type TestIntent, type TestIntentStep } from '../types/test-intent.js';

function toSemanticAction(step: TestIntentStep): SemanticAction {
  switch (step.action) {
    case 'goto':
      return {
        type: 'goto',
        path: step.path,
        url: step.url,
        description: step.description,
      };
    case 'act':
      return {
        type: 'act',
        instruction: step.instruction!,
        scope: step.scope,
      };
    case 'click':
      return {
        type: 'click',
        description: step.description!,
        scope: step.scope,
        locatorHint: step.locatorHint,
      };
    case 'fill':
      return {
        type: 'fill',
        description: step.description!,
        value: step.value!,
        scope: step.scope,
        locatorHint: step.locatorHint,
      };
    case 'select':
      return {
        type: 'select',
        description: step.description!,
        value: step.value!,
        scope: step.scope,
        locatorHint: step.locatorHint,
      };
    case 'assert':
      return {
        type: 'assert',
        description: step.expect || step.description!,
        kind: step.kind || 'text',
        expect: step.expect || step.description!,
        target: step.target,
        scope: step.scope,
      };
    case 'wait':
      return {
        type: 'wait',
        description: step.description,
        timeoutMs: step.timeoutMs,
      };
    case 'screenshot':
      return {
        type: 'screenshot',
        label: step.label,
        snapshotName: step.snapshotName,
        state: step.state,
        mode: step.mode,
      };
    default:
      throw new Error(`未知动作类型: ${step.action}`);
  }
}

function toSemanticStep(step: TestIntentStep, index: number): SemanticStep {
  return {
    id: step.id || `step-${index + 1}`,
    action: toSemanticAction(step),
    strategy: step.strategy ?? 'hybrid',
    optional: step.optional === true,
    retries: step.retries ?? 0,
    evidence: step.evidence ?? ['screenshot'],
  };
}

export function compileIntentToPlan(input: unknown): {
  intent: TestIntent;
  plan: SemanticTestPlan;
} {
  const intent = validateTestIntent(input);
  const steps: SemanticStep[] = intent.steps.map((step, index) => toSemanticStep(step, index));

  const firstIsGoto = steps[0]?.action.type === 'goto';
  if (intent.entry) {
    const isUrl = /^https?:\/\//i.test(intent.entry) || intent.entry.startsWith('data:');
    if (!firstIsGoto) {
      steps.unshift({
        id: 'entry-goto',
        action: isUrl ? { type: 'goto', url: intent.entry } : { type: 'goto', path: intent.entry },
        strategy: 'hybrid',
        optional: false,
        retries: 0,
        evidence: ['screenshot'],
      });
    } else {
      const first = steps[0];
      steps[0] = {
        ...first,
        action: isUrl
          ? { type: 'goto', url: intent.entry, description: first.action.type === 'goto' ? first.action.description : undefined }
          : { type: 'goto', path: intent.entry, description: first.action.type === 'goto' ? first.action.description : undefined },
      };
    }
  }

  if (intent.assertions?.length) {
    const existingExpects = new Set(
      steps
        .filter((s) => s.action.type === 'assert')
        .map((s) => (s.action.type === 'assert' ? (s.action.expect || '').trim() : ''))
        .filter(Boolean),
    );
    const actionDescs = steps
      .filter((s) => s.action.type === 'click' || s.action.type === 'fill' || s.action.type === 'select')
      .map((s) =>
        s.action.type === 'click' || s.action.type === 'fill' || s.action.type === 'select'
          ? s.action.description || ''
          : '',
      );

    for (let i = 0; i < intent.assertions.length; i++) {
      const expectText = intent.assertions[i].trim();
      if (!expectText || existingExpects.has(expectText)) continue;
      if (actionDescs.some((desc) => desc.includes(expectText))) continue;
      existingExpects.add(expectText);
      steps.push({
        id: `assert-${i + 1}`,
        action: {
          type: 'assert',
          description: expectText,
          kind: 'text',
          expect: expectText,
        },
        strategy: 'hybrid',
        optional: false,
        retries: 0,
        evidence: ['screenshot'],
      });
    }
  }

  const plan = validateSemanticTestPlan({
    name: intent.name,
    description: intent.goal || intent.description,
    env: intent.env,
    profile: intent.profile,
    entry: intent.entry,
    scriptKey: intent.scriptKey,
    styleChecks: intent.styleChecks,
    steps,
  });

  return { intent, plan };
}
