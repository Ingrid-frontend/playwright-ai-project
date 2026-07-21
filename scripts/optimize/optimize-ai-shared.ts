/**
 * AI 优化共享逻辑（Studio server.js 与 CLI optimize:ai 共用）
 */
export type OptimizeAiOpts = {
  selector?: boolean;
  assert?: boolean;
  wait?: boolean;
  env?: boolean;
  pom?: boolean;
  comment?: boolean;
};

export type AiProvider = 'claude' | 'deepseek';

export function buildOptimizePrompt(code: string, opts: OptimizeAiOpts = {}): string {
  const o: Required<OptimizeAiOpts> = {
    selector: opts.selector !== false,
    assert: opts.assert !== false,
    wait: opts.wait !== false,
    env: opts.env === true,
    pom: opts.pom === true,
    comment: opts.comment === true,
  };
  const checks = [
    o.selector && '- 将脆弱的 CSS/XPath 选择器替换为 getByRole、getByLabel、getByTestId 等语义化选择器',
    o.assert && '- 在关键操作后插入 expect 断言，验证 URL、元素可见性、文本内容等',
    o.wait && '- 移除所有 waitForTimeout 硬等待，改用 Playwright 内置的 auto-waiting 或 waitForSelector',
    o.env && '- 将 URL、账号密码等硬编码常量抽取为 process.env 环境变量',
    o.pom && '- 将页面交互逻辑封装为 Page Object 类',
    o.comment && '- 为每个关键步骤添加中文注释',
  ]
    .filter(Boolean)
    .join('\n');

  return `你是一个资深 Playwright 测试工程师。请优化以下录制的 Playwright 测试脚本。

优化要求：
${checks}

其他要求：
- 保持测试逻辑和用例结构不变
- 输出完整可运行的 TypeScript 代码
- 只输出代码本身，不要 markdown 代码块标记（不要 \`\`\`typescript 等）
- 代码要符合 Playwright 最佳实践

待优化的原始脚本：
${code}`;
}

export function stripMarkdownCodeFence(text: string): string {
  return text.replace(/```typescript\n?|```ts\n?|```\n?/g, '').trim();
}

export function resolveAiProvider(
  explicit?: string,
  keys?: { anthropic?: string | null; deepseek?: string | null },
): { provider: AiProvider; fallback: boolean } {
  const hasAnthropic = Boolean(keys?.anthropic);
  const hasDeepseek = Boolean(keys?.deepseek);
  if (explicit === 'claude' || explicit === 'deepseek') {
    const selected = explicit;
    if (selected === 'claude' && hasAnthropic) return { provider: 'claude', fallback: false };
    if (selected === 'deepseek' && hasDeepseek) return { provider: 'deepseek', fallback: false };
    const alt = selected === 'claude' ? 'deepseek' : 'claude';
    const hasAlt = alt === 'deepseek' ? hasDeepseek : hasAnthropic;
    if (hasAlt) return { provider: alt, fallback: true };
    return { provider: selected, fallback: false };
  }
  if (hasDeepseek) return { provider: 'deepseek', fallback: false };
  if (hasAnthropic) return { provider: 'claude', fallback: false };
  return { provider: 'deepseek', fallback: false };
}
