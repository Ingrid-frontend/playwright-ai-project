import { buildExploreToIntentSystemPrompt } from './explore-to-intent.js';

export function buildNlToIntentSystemPrompt(): string {
  return `${buildExploreToIntentSystemPrompt()}

额外规则：
7. 输入是自然语言 + 可选 Playwright 脚本，输出语义 Intent 步骤，禁止保留 getByRole/CSS/XPath 等实现细节。
8. 若脚本已跑通，以实际执行路径为准，去掉未执行或失败分支。
9. 只输出一次 JSON，禁止重复粘贴。`;
}

export function buildNlToIntentPrompt(input: {
  caseDescription: string;
  env?: string;
  entry?: string;
  scriptCode?: string;
  runPassed?: boolean;
}): string {
  const lines = [
    '请把以下口语试跑内容转为 Test Intent JSON。',
    '',
    `自然语言步骤：${input.caseDescription}`,
    `env: ${input.env || 'stage'}`,
    `entry: ${input.entry || ''}`,
    `脚本执行结果: ${input.runPassed ? '通过' : '未知或未通过'}`,
  ];
  if (input.scriptCode?.trim()) {
    lines.push('', '参考 Playwright 脚本（只提炼语义，不要复制选择器）：', '```typescript', input.scriptCode.trim(), '```');
  }
  lines.push('', '请输出 Intent JSON。');
  return lines.join('\n');
}
