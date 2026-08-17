export interface GeneratePlaywrightScriptInput {
  caseDescription: string;
  env?: string;
  entry?: string;
  recordingCode?: string;
}

export function buildGeneratePlaywrightScriptSystemPrompt(): string {
  return `你是一个资深 Playwright 测试工程师。请根据用户的自然语言测试步骤，直接生成可执行的 Playwright TypeScript 动作代码。

必须遵守：
1. 只输出代码本身，不要输出 markdown 代码块、import、test(...) 包裹或解释。
2. 代码运行在已经初始化好的浏览器 page 上：登录态已注入，**外层会先 page.goto(入口或 '/')**，脚本从当前已打开的业务页开始写。
3. 可以直接使用变量 page、expect。
4. 生成的代码必须自己处理等待和 iframe：
   - 每个点击、输入、断言前，先使用 waitFor({ state: 'visible' }) 或 expect(...).toBeVisible()。
   - 不要依赖外层环境做延时，延时逻辑必须写在脚本里。
   - **侧栏/顶部菜单**（如「我的审批」「首页」）通常在主 page 上，优先：
     \`page.getByRole('menuitem', { name: /文案/ }).filter({ visible: true }).first()\`
     或 \`page.getByText('文案').filter({ visible: true }).first()\`。
   - **列表/表单等业务内容**才在 iframe 内。定位前可：
     \`await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});\`
     再 \`const frame = page.frameLocator('iframe').first();\`
   - 不确定菜单在 page 还是 iframe 时，用双路径（与仓库 optimized 用例一致）：
     \`const iframeLoc = page.frameLocator('iframe').first().getByText('我的审批').filter({ visible: true }).first();\`
     \`const pageLoc = page.getByRole('menuitem', { name: /我的审批/ }).filter({ visible: true }).first();\`
     \`const locator = (await iframeLoc.count().catch(() => 0)) > 0 ? iframeLoc : pageLoc;\`
   - 禁止假设「第一个 iframe 里一定有侧栏菜单」而只写 frame.getByText。
5. 不要使用 CSS/XPath 复杂选择器（避免 .ant-table-row 等脆弱 class）。
   - 列表**数据行**不要用 getByRole('row').first()（常点到表头）。优先：
     \`frame.getByRole('cell', { name: '1', exact: true }).filter({ visible: true }).first()\`
     或带业务文案的 cell/row。
6. 优先使用 getByText、getByRole、getByLabel、getByPlaceholder、getByTestId。
7. 「返回」类控件可能是 button / link / 纯文本 / 无障碍名缺失的图标：
   - 用 page+frame 双路径，并同时试 getByRole('button'|'link') 与 getByText('返回')。
   - 找到任一可见即可点击；都找不到时用 console.log 后跳过或软失败，不要对单一 iframe button 硬等短超时。
8. 使用 expect 做断言，不要只 click 后直接结束。
9. 不要生成会提交真实业务数据的危险操作，除非用户明确要求。
10. 不要写 page.goto（入口由运行器打开）；不要以 about:blank 为前提只写 waitForLoadState。`;
}

export function buildGeneratePlaywrightScriptPrompt(input: GeneratePlaywrightScriptInput): string {
  const lines = [
    '请生成 Playwright 动作代码。',
    '',
    `测试需求：${input.caseDescription}`,
  ];

  if (input.env) lines.push(`目标环境：${input.env}`);
  if (input.entry) lines.push(`入口路径或 URL：${input.entry}`);
  if (input.recordingCode?.trim()) {
    lines.push('');
    lines.push('以下是已有录制脚本，仅用于理解业务步骤，不要复制其中的脆弱选择器：');
    lines.push('```typescript');
    lines.push(input.recordingCode.trim());
    lines.push('```');
  }

  lines.push('');
  lines.push('请输出可执行代码。');
  return lines.join('\n');
}
