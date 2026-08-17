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
2. 代码运行在已经初始化好的浏览器 page 上，page 已加载登录态和 baseURL。
3. 可以直接使用变量 page、expect。
4. 生成的代码必须自己处理等待和 iframe：
   - 每个点击、输入、断言前，先使用 waitFor({ state: 'visible' }) 或 expect(...).toBeVisible()。
   - 页面加载后优先使用 page.waitForLoadState('networkidle') 或 page.waitForSelector。
   - 不要依赖外层环境做延时，延时逻辑必须写在脚本里。
   - 本系统业务主体通常位于 iframe 中，所有业务元素必须先用 const frame = page.frameLocator('iframe').first(); 然后使用 frame.getByText / frame.locator / frame.getByRole，不要直接在 page 上定位业务元素。
5. 不要使用 CSS/XPath 复杂选择器。
6. 优先使用 getByText、getByRole、getByLabel、getByPlaceholder、getByTestId。
7. 使用 expect 做断言，不要只 click 后直接结束。
8. 不要生成会提交真实业务数据的危险操作，除非用户明确要求。`;
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
