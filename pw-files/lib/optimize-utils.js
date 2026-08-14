const { logLine } = require('./ws-safe');

function getOptimizeApiKeys(session, msg, envKeys) {
  if (msg.anthropicApiKey !== undefined) {
    const t = String(msg.anthropicApiKey ?? '').trim();
    if (t) session.apiKeys.anthropic = t;
  }
  if (msg.deepseekApiKey !== undefined) {
    const t = String(msg.deepseekApiKey ?? '').trim();
    if (t) session.apiKeys.deepseek = t;
  }
  return {
    anthropic: session.apiKeys.anthropic || envKeys.anthropic || null,
    deepseek: session.apiKeys.deepseek || envKeys.deepseek || null,
  };
}

function resolveOptimizeProvider(explicit, keys) {
  const hasAnthropic = Boolean(keys.anthropic);
  const hasDeepseek = Boolean(keys.deepseek);

  if (explicit === 'claude' || explicit === 'deepseek') {
    const selected = explicit;
    const hasSelected = selected === 'claude' ? hasAnthropic : hasDeepseek;
    if (hasSelected) return { provider: selected, fallback: false };
    const alt = selected === 'claude' ? 'deepseek' : 'claude';
    const hasAlt = alt === 'deepseek' ? hasDeepseek : hasAnthropic;
    if (hasAlt) return { provider: alt, fallback: true };
    return { provider: selected, fallback: false };
  }

  if (hasAnthropic) return { provider: 'claude', fallback: false };
  if (hasDeepseek) return { provider: 'deepseek', fallback: false };
  return { provider: 'claude', fallback: false };
}

function logOptimizeProviderChoice(ws, requested, resolved, keys, fallback, envKeys) {
  const keyHint = (p) => {
    if (p === 'claude') {
      return keys.anthropic
        ? (keys.anthropic === envKeys.anthropic ? '环境变量 ANTHROPIC_API_KEY' : '界面 Anthropic 密钥')
        : '无';
    }
    return keys.deepseek
      ? (keys.deepseek === envKeys.deepseek ? '环境变量 DEEPSEEK_API_KEY' : '界面 DeepSeek 密钥')
      : '无';
  };
  const name = resolved === 'claude' ? 'Claude (Anthropic)' : 'DeepSeek';
  if (fallback) {
    const reqName = requested === 'claude' ? 'Claude' : 'DeepSeek';
    logLine(ws, `侧栏已选 ${reqName}，但未配置对应密钥，已改用 ${name}（${keyHint(resolved)}）`, 'warn');
  } else {
    logLine(ws, `使用 ${name} 优化，密钥来源：${keyHint(resolved)}`, 'info');
  }
}

module.exports = {
  getOptimizeApiKeys,
  resolveOptimizeProvider,
  logOptimizeProviderChoice,
};
