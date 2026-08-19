/** NL→Intent few-shot：稳定结构参考，勿复制业务 env */
export const INTENT_FEW_SHOT_APPROVAL_LIST = `
name: 审批列表意图样例
goal: 从审批入口进入列表页
env: stage
entry: /main/approve
constraints:
  - 禁止 nth()
  - 禁止把 @N 写入定义
steps:
  - id: step-1
    action: goto
    path: /main/approve
  - id: step-2
    action: assert
    kind: text
    expect: 审批
    evidence: [screenshot]
assertions:
  - 审批
`.trim();

export const INTENT_FEW_SHOT_WORKBENCH_MY_APPROVAL = `
name: 我的审批搜索申请人
goal: 进入工作台我的审批待办列表并按申请人搜索
env: dev
entry: /main/home
constraints:
  - 禁止 nth()
  - 禁止把 @N 写入定义
steps:
  - id: step-1
    action: goto
    path: /main/home
  - id: step-2
    action: click
    description: 顶栏工作台
  - id: step-3
    action: click
    description: 工作台左侧导航我的审批
  - id: step-4
    action: assert
    kind: text
    expect: 审批
    evidence: [screenshot]
  - id: step-5
    action: fill
    description: 申请人搜索输入框
    value: 张三
  - id: step-6
    action: click
    description: 搜索
  - id: step-7
    action: assert
    kind: text
    expect: 张三
    evidence: [screenshot]
assertions:
  - 审批
  - 张三
`.trim();

export const INTENT_FEW_SHOT_MENU_SEARCH_MY_APPROVAL = `
name: 菜单搜索进入我的审批
goal: 侧栏菜单搜索我的审批并进入列表
env: dev
entry: /main/home
constraints:
  - 禁止 nth()
  - 禁止把 @N 写入定义
steps:
  - id: step-1
    action: goto
    path: /main/home
  - id: step-2
    action: click
    description: 左侧菜单搜索框
  - id: step-3
    action: fill
    description: 菜单搜索框
    value: 我的审批
  - id: step-4
    action: click
    description: 侧栏菜单项我的审批
  - id: step-5
    action: assert
    kind: text
    expect: 审批
    evidence: [screenshot]
  - id: step-6
    action: fill
    description: 申请人搜索输入框
    value: 张三
  - id: step-7
    action: click
    description: 搜索
  - id: step-8
    action: assert
    kind: text
    expect: 张三
    evidence: [screenshot]
assertions:
  - 审批
  - 张三
`.trim();

export function buildIntentFewShotBlock(): string {
  return [
    '参考样例（只学结构与语义粒度，env/文案按用户输入调整）：',
    '',
    '样例 A — 直达审批列表：',
    '```yaml',
    INTENT_FEW_SHOT_APPROVAL_LIST,
    '```',
    '',
    '样例 B — 工作台我的审批搜索（禁止走系统管理审批流）：',
    '```yaml',
    INTENT_FEW_SHOT_WORKBENCH_MY_APPROVAL,
    '```',
    '',
    '样例 C — 侧栏菜单搜索后点菜单项进入（搜索不会自动跳转）：',
    '```yaml',
    INTENT_FEW_SHOT_MENU_SEARCH_MY_APPROVAL,
    '```',
  ].join('\n');
}
