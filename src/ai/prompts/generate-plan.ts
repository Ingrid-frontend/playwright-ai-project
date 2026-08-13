export interface GeneratePlanInput {
  caseDescription: string;
  env?: string;
  entry?: string;
  recordingCode?: string;
}

export function buildGeneratePlanSystemPrompt(): string {
  return `你是一个资深自动化测试架构师。请把用户的自然语言测试需求转换成可执行的语义测试计划 JSON。

必须遵守：
1. 只输出一个合法 JSON 对象，不要输出 markdown 代码块、注释或解释。
2. 不要生成 CSS/XPath 选择器作为主要执行方式；优先使用自然语言描述，让执行器通过语义定位或视觉模型定位。
3. 只有在用户明确给出稳定 locator 时，才填写 locatorHint。
4. 每个步骤都要有稳定、唯一的 id，例如 step-1、step-2。
5. 复杂步骤要拆成小块，不要在同一个 act 里塞入多个动作。
6. 关键页面状态必须拆成 assert 步骤。

返回结构：
{
  "name": "用例名称",
  "description": "用例描述",
  "env": "环境，可空",
  "entry": "入口路径，可空",
  "steps": [
    {
      "id": "step-1",
      "strategy": "hybrid",
      "optional": false,
      "retries": 1,
      "evidence": ["screenshot"],
      "action": {
        "type": "goto|act|click|fill|select|assert|wait|screenshot",
        "description": "动作的自然语言描述",
        "value": "fill/select 的值",
        "instruction": "act 的完整指令",
        "path": "goto 的相对路径",
        "url": "goto 的绝对 URL",
        "scope": "page 或 iframe",
        "locatorHint": "可选稳定 locator",
        "timeoutMs": 3000
      }
    }
  ]
}`;
}

export function buildGeneratePlanPrompt(input: GeneratePlanInput): string {
  const lines = [
    '请生成语义测试计划。',
    '',
    `测试需求：${input.caseDescription}`,
  ];

  if (input.env) lines.push(`目标环境：${input.env}`);
  if (input.entry) lines.push(`入口路径：${input.entry}`);
  if (input.recordingCode?.trim()) {
    lines.push('');
    lines.push('下面是已有的 Playwright 录制脚本，仅作为理解业务步骤的参考。请把它转换为语义计划，不要保留脆弱选择器：');
    lines.push('```typescript');
    lines.push(input.recordingCode.trim());
    lines.push('```');
  }

  lines.push('');
  lines.push('请输出语义测试计划 JSON。');
  return lines.join('\n');
}
