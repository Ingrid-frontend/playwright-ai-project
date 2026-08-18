import type { SemanticStep, SemanticTestPlan } from '../../types/ai-test-plan.js';

export interface HealStepInput {
  plan: SemanticTestPlan;
  stepIndex: number;
  error: string;
  currentUrl: string;
  dom: string;
  constraints?: string[];
}

export function buildHealStepSystemPrompt(): string {
  return `你是一个 Playwright 测试自愈专家。当前某个语义步骤执行失败，请根据页面上下文返回修复建议。

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
1. 只修正「怎么做」（定位描述、操作描述、locatorHint），不要改「结果应该是什么」。
2. 如果当前失败是可选步骤，可以设置 shouldSkip=true；非可选步骤禁止 shouldSkip。
3. 禁止弱化、删除或改写 assert 的预期描述；禁止把 assert 改成其它动作。
4. 禁止为了让测试通过而更换业务目标、跳过关键步骤或降低断言强度。
5. correctedStep.action 必须是合法语义动作，优先用更具体、更细的 description。
6. locatorHint 若填写，必须是字符串形式的 Playwright/CSS 选择器；禁止 JSON 对象或 role/name 结构。
7. 不要生成 CSS/XPath 作为主定位方式；不要使用 nth()；不要建议固定 sleep。
8. 不要输出 JSON 以外的内容。`;
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

  if (input.constraints?.length) {
    lines.push('');
    lines.push('项目约束：');
    for (const item of input.constraints) {
      lines.push(`- ${item}`);
    }
  }

  if (input.dom) {
    lines.push('');
    lines.push('当前页面 DOM 摘要：');
    lines.push(input.dom);
  }

  lines.push('');
  lines.push('请返回修复后的单步语义动作 JSON。');
  return lines.join('\n');
}
