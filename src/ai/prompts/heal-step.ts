import type { SemanticStep, SemanticTestPlan } from '../../types/ai-test-plan.js';

export interface HealStepInput {
  plan: SemanticTestPlan;
  stepIndex: number;
  error: string;
  currentUrl: string;
  dom: string;
}

export function buildHealStepSystemPrompt(): string {
  return `你是一个 Playwright + Midscene 测试自愈专家。当前某个语义步骤执行失败，请根据页面上下文返回修复建议。

必须只输出 JSON：
{
  "shouldSkip": false,
  "reason": "简短原因",
  "correctedStep": {
    "id": "原步骤 id",
    "strategy": "hybrid",
    "retries": 0,
    "optional": false,
    "evidence": ["screenshot"],
    "action": {}
  }
}

规则：
1. 如果当前失败是可选步骤，可以设置 shouldSkip=true。
2. correctedStep.action 必须是合法语义动作，优先用更具体、更细的描述。
3. 不要生成 CSS/XPath 作为主定位方式。
4. 不要输出 JSON 以外的内容。`;
}

export function buildHealStepPrompt(input: HealStepInput): string {
  const failedStep: SemanticStep | undefined = input.plan.steps[input.stepIndex];
  const lines = [
    `原测试计划：${input.plan.name}`,
    `失败步骤：${failedStep?.id ?? input.stepIndex + 1}`,
    `失败动作：${JSON.stringify(failedStep?.action ?? {}, null, 2)}`,
    `错误信息：${input.error}`,
    `当前 URL：${input.currentUrl}`,
  ];

  if (input.dom) {
    lines.push('');
    lines.push('当前页面 DOM 摘要：');
    lines.push(input.dom);
  }

  lines.push('');
  lines.push('请返回修复后的单步语义动作 JSON。');
  return lines.join('\n');
}
