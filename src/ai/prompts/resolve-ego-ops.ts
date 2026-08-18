import type { SemanticAction } from '../../types/ai-test-plan.js';
import type { SnapshotNode } from '../../runtime/ego-snapshot.js';

export type EgoResolvedOp =
  | { type: 'click'; ref: number; label?: string }
  | { type: 'fill'; ref: number; value: string; label?: string }
  | { type: 'select'; ref: number; value: string; label?: string }
  | { type: 'wait'; seconds: number };

export function buildResolveOpsSystemPrompt(): string {
  return `你是 UI 测试执行助手。根据当前页面 Snapshot 与步骤目标，选出要操作的 @N 引用。

必须只输出 JSON：
{
  "ops": [
    { "type": "click", "ref": 12, "label": "短描述" },
    { "type": "fill", "ref": 3, "value": "填写值", "label": "短描述" },
    { "type": "select", "ref": 5, "value": "选项", "label": "短描述" },
    { "type": "wait", "seconds": 1 }
  ],
  "reason": "一句话说明"
}

规则：
1. ref 必须来自给定 Snapshot 中存在的数字；禁止编造。
2. 只完成当前步骤目标，不要替用户做后续步骤。
3. 禁止改写断言期望；本提示不会用于 assert。
4. 不要输出 CSS/XPath；只用 ref。
5. 不要输出 JSON 以外的内容。
6. 若目标是查看/详情类列表操作，但 Snapshot 没有该原文，改点同类可见按钮（详情、审批、处理），禁止编造不存在的 ref。`;
}

export function buildResolveOpsPrompt(input: {
  action: SemanticAction;
  snapshotSummary: string;
  candidates?: SnapshotNode[];
  constraints?: string[];
}): string {
  const lines = [
    `步骤动作：${JSON.stringify(input.action)}`,
    '',
    '候选节点（若有）：',
    input.candidates?.length
      ? input.candidates.map((n) => `@${n.ref} [${n.role || '?'}] "${n.name}"`).join('\n')
      : '（无确定性候选）',
    '',
    '当前 Snapshot：',
    input.snapshotSummary,
  ];

  if (input.constraints?.length) {
    lines.push('', '约束：');
    for (const c of input.constraints) lines.push(`- ${c}`);
  }

  lines.push('', '请返回 ops JSON。');
  return lines.join('\n');
}

export function buildHealFromSnapshotSystemPrompt(): string {
  return `你是基于 Snapshot 的测试自愈助手。定位失败时，根据 Snapshot 修正「怎么做」，不要改「应该是什么」。

必须只输出 JSON：
{
  "shouldSkip": false,
  "reason": "简短原因",
  "correctedDescription": "更具体的语义描述",
  "correctedValue": "仅 fill/select 需要时可填"
}

规则：
1. 禁止改写 assert 期望。
2. 禁止建议 @N / CSS / nth()。
3. 非可选步骤禁止 shouldSkip=true。
4. 不要输出 JSON 以外的内容。`;
}

export function buildHealFromSnapshotPrompt(input: {
  stepId: string;
  action: SemanticAction;
  error: string;
  url: string;
  snapshotSummary: string;
  constraints?: string[];
}): string {
  const lines = [
    `步骤 id：${input.stepId}`,
    `动作：${JSON.stringify(input.action)}`,
    `错误：${input.error}`,
    `URL：${input.url}`,
    '',
    'Snapshot：',
    input.snapshotSummary,
  ];
  if (input.constraints?.length) {
    lines.push('', '约束：');
    for (const c of input.constraints) lines.push(`- ${c}`);
  }
  return lines.join('\n');
}
