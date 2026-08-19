import { buildExploreToIntentSystemPrompt } from './explore-to-intent.js';
import { buildIntentFewShotBlock } from './intent-few-shot.js';

export function buildNlToIntentSystemPrompt(): string {
  return `${buildExploreToIntentSystemPrompt()}

额外规则：
7. 输入是自然语言 + 可选 Playwright 脚本，输出语义 Intent 步骤，禁止保留 getByRole/CSS/XPath 等实现细节。
8. 若脚本已跑通，以实际执行路径为准，去掉未执行或失败分支。
9. 只输出一次 JSON，禁止重复粘贴。
10. 口语里的「点查看 / 点编辑」只生成 click，不要生成 assert expect=查看/编辑。没有看到页面时宁可少写 assert。
11. 若参考脚本用 pickVisible 尝试多个操作名并跳过不存在的：压缩成一条 click「列表可见的查看或详情操作」，不要展开成 7 条必过 click + assert。
12. 汇联易「我的审批」是工作台待办列表，不是系统管理里的「审批流」配置。口语含我的审批/待办/搜申请人时：entry 用 /main/home（禁止仅用 /）；默认 goto 后 click「顶栏工作台」再 click「工作台左侧导航我的审批」；禁止仅写「我的审批菜单」或孤立 click「我的审批」。
13. 口语含「菜单搜索」「左侧菜单搜索」时：fill「菜单搜索框」value=目标菜单名后，必须再 click「侧栏菜单项{菜单名}」进入列表（搜索只过滤侧栏，不会自动跳转）；禁止省略点击菜单项。
14. 进入我的审批列表后的 assert expect 用主内容区列表信号（审批、单据择一），禁止仅用侧栏菜单名「我的审批」或单字「待办」作 assert（e档案首页「待办事项」会误匹配）。
15. 搜索填值后：最后 assert expect 用实际搜索值（如张三），禁止用字段名（申请人、名称）作 expect。
16. 仅当口语明确配置/维护审批流程、审批流版本时，才生成系统管理→审批流路径；与「我的审批」「搜申请人」「处理待办」冲突时一律走工作台路径。

${buildIntentFewShotBlock()}`;
}

export function buildNlToIntentPrompt(input: {
  caseDescription: string;
  env?: string;
  entry?: string;
  scriptCode?: string;
  runPassed?: boolean;
  runStepSummary?: string;
}): string {
  const lines = [
    '请把以下口语试跑内容转为 Test Intent JSON。',
    '',
    `自然语言步骤：${input.caseDescription}`,
    `env: ${input.env || 'stage'}`,
    `entry: ${input.entry || ''}`,
    `脚本执行结果: ${input.runPassed ? '通过' : '未知或未通过'}`,
  ];
  if (input.runPassed && input.runStepSummary?.trim()) {
    lines.push('', '试跑实际执行步骤（以此为准，删除未执行或失败分支）：', input.runStepSummary.trim());
  }
  if (input.scriptCode?.trim()) {
    lines.push('', '参考 Playwright 脚本（只提炼语义，不要复制选择器）：', '```typescript', input.scriptCode.trim(), '```');
  }
  lines.push('', '请输出 Intent JSON。');
  return lines.join('\n');
}
