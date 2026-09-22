const { send } = require('./ws-safe');

const DEFAULT_OPTIMIZE_TIMEOUT_MS = 120000;

function sendOptimizeCancelled(ws, signal) {
  send(ws, 'optimize:cancelled', { reason: signal?.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled' });
}

async function optimizeCode(ws, session, code, opts, providerHint, msgKeys, deps) {
  const {
    getOptimizeApiKeys,
    resolveOptimizeProvider,
    logOptimizeProviderChoice,
    streamDeepSeekChat,
    simulateOptimize,
    Anthropic,
    envKeys,
    logLine,
  } = deps;

  if (session.cancelled || session.optimizeRunning) return;
  const keys = getOptimizeApiKeys(session, msgKeys || {}, envKeys);
  const { provider, fallback } = resolveOptimizeProvider(providerHint, keys);

  const checks = [
    opts.selector && '- 将脆弱的 CSS/XPath 选择器替换为 getByRole、getByLabel、getByTestId 等语义化选择器',
    opts.assert   && '- 在关键操作后插入 expect 断言，验证 URL、元素可见性、文本内容等',
    opts.wait     && '- 移除所有 waitForTimeout 硬等待，改用 Playwright 内置的 auto-waiting 或 waitForSelector',
    opts.env      && '- 将 URL、账号密码等硬编码常量抽取为 process.env 环境变量',
    opts.pom      && '- 将页面交互逻辑封装为 Page Object 类',
    opts.comment  && '- 为每个关键步骤添加中文注释',
  ].filter(Boolean).join('\n');

  const prompt = `你是一个资深 Playwright 测试工程师。请优化以下录制的 Playwright 测试脚本。

优化要求：
${checks}

其他要求：
- 保持测试逻辑和用例结构不变
- 输出完整可运行的 TypeScript 代码
- 只输出代码本身，不要 markdown 代码块标记（不要 \`\`\`typescript 等）
- 代码要符合 Playwright 最佳实践

待优化的原始脚本：
${code}`;

  const controller = new AbortController();
  const { signal } = controller;
  const timeoutMs = Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0
    ? Math.min(deps.timeoutMs, DEFAULT_OPTIMIZE_TIMEOUT_MS) : DEFAULT_OPTIMIZE_TIMEOUT_MS;
  session.optimizeRunning = true;
  session.optimizeCancelled = false;
  session.optimizeController = controller;
  const timer = setTimeout(() => {
    controller.abort(Object.assign(new Error('优化请求超时'), { name: 'TimeoutError' }));
  }, timeoutMs);
  let anthropicStream;
  const abortAnthropic = () => anthropicStream?.abort();

  try {
    send(ws, 'optimize:start', { provider, requested: providerHint || null, fallback });
    logOptimizeProviderChoice(ws, providerHint, provider, keys, fallback, envKeys);
    let fullCode = '';

    if (provider === 'claude') {
      if (!keys.anthropic) throw new Error('ANTHROPIC_API_KEY 未配置（请填写 Anthropic 密钥或配置环境变量）');

      const client = new Anthropic({ apiKey: keys.anthropic });
      anthropicStream = client.messages.stream({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }, { signal });
      signal.addEventListener('abort', abortAnthropic, { once: true });
      if (signal.aborted) abortAnthropic();

      for await (const chunk of anthropicStream) {
        signal.throwIfAborted();
        if (session.optimizeCancelled) break;
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          const text = chunk.delta.text;
          fullCode += text;
          send(ws, 'optimize:stream', { chunk: text });
        }
      }
    } else {
      if (!keys.deepseek) throw new Error('DEEPSEEK_API_KEY 未配置（请填写 DeepSeek 密钥或配置环境变量）');
      await streamDeepSeekChat(
        prompt,
        (text) => {
          if (session.optimizeCancelled || signal.aborted) return;
          fullCode += text;
          send(ws, 'optimize:stream', { chunk: text });
        },
        keys.deepseek,
        { signal },
      );
    }

    signal.throwIfAborted();
    if (session.optimizeCancelled) {
      sendOptimizeCancelled(ws, signal);
      return;
    }

    fullCode = fullCode.replace(/```typescript\n?|```ts\n?|```\n?/g, '').trim();
    session.optCode = fullCode;

    const rawLines = code.split('\n').length;
    const optLines = fullCode.split('\n').length;

    send(ws, 'optimize:done', {
      code: fullCode,
      lines: optLines,
      removed: Math.max(0, rawLines - optLines),
      demo: false,
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.constructor?.name === 'APIConnectionTimeoutError' ||
      err?.code === 'ETIMEDOUT';
    if (session.optimizeCancelled || signal.aborted || timedOut || err?.code === 'ABORT_ERR' ||
        ['AbortError', 'APIUserAbortError'].includes(err?.name) || err?.constructor?.name === 'APIUserAbortError') {
      if (!signal.aborted) controller.abort(timedOut
        ? Object.assign(new Error('优化请求超时'), { name: 'TimeoutError' }) : err);
      if (signal.reason?.name === 'TimeoutError') logLine(ws, '优化请求超时，未保存优化结果', 'warn');
      sendOptimizeCancelled(ws, signal);
      return;
    }
    logLine(ws, `[演示模式] ${err.message}，使用示例优化结果`, 'warn');
    await simulateOptimize(ws, session, code, opts, err.message, signal);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abortAnthropic);
    if (session.optimizeController === controller) session.optimizeController = null;
    session.optimizeRunning = false;
  }
}

async function simulateOptimize(ws, session, code, opts, demoReason = 'API 不可用', signal = session.optimizeController?.signal) {
  let result = code;

  if (opts.wait) {
    result = result.replace(/await page\.waitForTimeout\(\d+\);?\n?/g, '');
  }
  if (opts.selector) {
    result = result.replace(/await page\.click\('a\[href="\/docs"\]'\)/g,
      "await page.getByRole('link', { name: 'Docs' }).click()");
    result = result.replace(/await page\.click\('input\[type="search"\]'\)/g,
      "await page.getByRole('searchbox').click()");
    result = result.replace(/await page\.fill\('input\[type="search"\],/g,
      "await page.getByRole('searchbox').fill(");
    result = result.replace(/await page\.click\('\.search-result:first-child a'\)/g,
      "await page.getByRole('link').first().click()");
  }
  if (opts.assert) {
    result = result.replace(
      "const title = await page.title();\n  console.log('Page title:', title);",
      "await expect(page).toHaveTitle(/Playwright/);\n  await expect(page.getByRole('main')).toBeVisible();",
    );
  }
  if (opts.env) {
    result = result.replace(/('https?:\/\/[^'"]+')/, 'process.env.BASE_URL || $1');
  }
  if (opts.comment) {
    result = result.replace(
      'await page.goto(',
      '// 导航到目标页面\n  await page.goto(',
    );
  }

  const chars = result.split('');
  let buf = '';
  for (let i = 0; i < chars.length; i++) {
    if (session.optimizeCancelled || signal?.aborted) {
      sendOptimizeCancelled(ws, signal);
      return;
    }
    buf += chars[i];
    if (i % 8 === 0) {
      send(ws, 'optimize:stream', { chunk: buf });
      buf = '';
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  if (session.optimizeCancelled || signal?.aborted) {
    sendOptimizeCancelled(ws, signal);
    return;
  }
  if (buf) send(ws, 'optimize:stream', { chunk: buf });

  session.optCode = result;
  send(ws, 'optimize:done', {
    code: result,
    lines: result.split('\n').length,
    removed: code.split('\n').length - result.split('\n').length,
    demo: true,
    demoReason,
  });
}

module.exports = { optimizeCode, simulateOptimize };
