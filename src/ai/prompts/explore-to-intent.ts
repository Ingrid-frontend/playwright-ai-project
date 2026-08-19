import type { TestIntent } from '../../types/test-intent.js';

export type ExploreTraceStep = {
  index: number;
  beforeSummary: string;
  afterSummary?: string;
  url?: string;
  semantic: {
    action: string;
    description?: string;
    value?: string;
    path?: string;
    url?: string;
  };
  note?: string;
};

export type ExploreTrace = {
  goal: string;
  env: string;
  entry?: string;
  spaceName: string;
  startedAt: string;
  finishedAt?: string;
  steps: ExploreTraceStep[];
};

export type ExploreDecision =
  | { done: true; reason: string }
  | {
      done: false;
      action: 'click' | 'fill' | 'select' | 'wait' | 'goto';
      description?: string;
      value?: string;
      path?: string;
      url?: string;
      timeoutMs?: number;
      reason: string;
    };

export function buildExploreDecideSystemPrompt(): string {
  return `你是探索式 UI 测试 Agent。根据目标与当前 Snapshot，决定下一步语义操作。

必须只输出 JSON，两种形态之一：
{"done":true,"reason":"已达成目标的原因"}
或
{"done":false,"action":"click|fill|select|wait|goto","description":"语义文案","value":"填/选值","path":"/path","url":"https://...","timeoutMs":500,"reason":"为什么这一步"}

规则：
1. description 用用户可见文案，禁止 @N、CSS、nth()。
2. 一次只推进一步，优先最短路径达成 goal。
3. 遇到验证码/登录墙：done=true 并说明需人工。
4. 不要输出 JSON 以外内容。
5. 只输出一次，禁止重复粘贴同一 JSON。`;
}

export function buildExploreDecidePrompt(input: {
  goal: string;
  entry?: string;
  snapshot: string;
  url: string;
  history: string[];
  constraints?: string[];
}): string {
  const lines = [
    `目标：${input.goal}`,
    `入口：${input.entry || '(无)'}`,
    `当前 URL：${input.url}`,
    '',
    '已执行语义步骤：',
    input.history.length ? input.history.map((h, i) => `${i + 1}. ${h}`).join('\n') : '（无）',
    '',
    '当前 Snapshot：',
    input.snapshot,
  ];
  if (input.constraints?.length) {
    lines.push('', '约束：');
    for (const c of input.constraints) lines.push(`- ${c}`);
  }
  return lines.join('\n');
}

export function buildExploreToIntentSystemPrompt(): string {
  return `你把探索轨迹压缩为 Test Intent YAML 对应的 JSON（不要输出 YAML 文本）。

必须只输出 JSON：
{
  "name": "短名称",
  "goal": "验收目标",
  "description": "可选说明",
  "env": "stage",
  "entry": "/path",
  "preconditions": ["..."],
  "constraints": ["禁止 nth()", "禁止把 @N 写入定义"],
  "assertions": ["审批"],
  "steps": [
    { "id": "step-1", "action": "goto", "path": "/x" },
    { "id": "step-2", "action": "click", "description": "审批" },
    { "id": "step-3", "action": "fill", "description": "意见", "value": "同意" },
    { "id": "step-4", "action": "assert", "kind": "text", "expect": "审批", "evidence": ["screenshot"] }
  ]
}

规则：
1. 步骤只用语义描述，禁止 @N / CSS / nth()。
2. action 限于 goto/click/fill/select/assert/wait/screenshot。
3. assert 必须用 kind+expect：kind 为 text|visible|url|count；expect 必须是页面可见短文案（如 Ready、审批），禁止「页面包含/应该/相关内容」等叙述句。
4. 顶层 assertions 数组同样只能是短文案。
5. 合并重复无效步骤，保留达成 goal 的最短路径。
6. 不要输出 JSON 以外内容。
7. 禁止把用户口述的操作名（查看、编辑、删除、通过、提交、取消、关闭）写成 assert expect。这些只用于 click/fill description。
8. 没有 Snapshot 时不要臆造列表按钮/操作列文案。assert 只写进入页面后主内容区几乎一定出现的短文案（如待办、审批、单据），不要用侧栏菜单名代替列表页证据。
9. 禁止在 click 前对同一按钮文案做 assert；先 click，再 assert 点击后新出现的文案。
10. 列表「查看/详情/审批」等：只生成一条 click，description 用「列表可见的查看或详情操作」。不要为每个臆造按钮名生成 assert；执行期按 Snapshot 点真实可见的那个。`;
}

export function buildExploreToIntentPrompt(trace: ExploreTrace): string {
  return [
    `goal: ${trace.goal}`,
    `env: ${trace.env}`,
    `entry: ${trace.entry || ''}`,
    '',
    '轨迹步骤：',
    JSON.stringify(trace.steps, null, 2),
    '',
    '请输出 Intent JSON。',
  ].join('\n');
}

export type IntentDraft = TestIntent;
