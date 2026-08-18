function pickEnv(env, ...keys) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return '';
}

function isVolcanoBaseUrl(baseUrl) {
  return /volces\.com|volcengine/i.test(baseUrl);
}

function isVolcanoApiKey(apiKey) {
  return /^ark-/i.test(apiKey);
}

function getAiTestProvider(env = process.env) {
  return pickEnv(env, 'AI_TEST_PROVIDER') || 'deepseek';
}

function getVolcanoArkStatus(env = process.env) {
  const provider = getAiTestProvider(env).toLowerCase();
  const apiKey = pickEnv(env, 'AI_TEST_OPENAI_API_KEY', 'OPENAI_API_KEY');
  const baseUrl = pickEnv(env, 'AI_TEST_OPENAI_BASE_URL', 'OPENAI_API_BASE');
  const model = pickEnv(env, 'AI_TEST_MODEL', 'OPENAI_MODEL');
  const looksLikeArk = isVolcanoBaseUrl(baseUrl) || isVolcanoApiKey(apiKey);

  if (provider !== 'openai') {
    if (looksLikeArk) {
      return {
        ok: false,
        configured: false,
        message: '✗ 未完成 · 已填方舟 Key/Base URL，但 AI_TEST_PROVIDER 需设为 openai',
      };
    }
    return {
      ok: false,
      configured: false,
      skipped: true,
      message: `— 未启用（当前 AI_TEST_PROVIDER=${provider}）`,
    };
  }

  if (!looksLikeArk && !apiKey) {
    return {
      ok: false,
      configured: false,
      skipped: true,
      message: '— 未启用（provider=openai 但未配置方舟 Base URL / Key）',
    };
  }

  const missing = [];
  if (!apiKey) missing.push('AI_TEST_OPENAI_API_KEY');
  if (!baseUrl) missing.push('AI_TEST_OPENAI_BASE_URL');
  if (!model) missing.push('AI_TEST_MODEL');

  if (missing.length) {
    return {
      ok: false,
      configured: true,
      message: `✗ 未完成 · 缺少 ${missing.join('、')}`,
    };
  }

  return {
    ok: true,
    configured: true,
    provider,
    model,
    baseUrl,
    message: `✓ 已配置 · model=${model} · base=${baseUrl}`,
  };
}

function getLlmStartupLines(env = process.env) {
  const provider = getAiTestProvider(env);
  const anthropic = pickEnv(env, 'AI_TEST_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY');
  const deepseek = pickEnv(env, 'AI_TEST_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY');
  const volcano = getVolcanoArkStatus(env);

  const lines = [
    `   AI_TEST_PROVIDER: ${provider}`,
    `   火山方舟（Explore / NL / Intent）: ${volcano.message}`,
    `   ANTHROPIC_API_KEY: ${anthropic ? '✓ 已配置' : '✗ 未配置'}`,
    `   DEEPSEEK_API_KEY: ${deepseek ? '✓ 已配置' : '✗ 未配置'}`,
  ];

  if (!volcano.ok && !volcano.skipped && provider === 'openai') {
    lines.push('   （Explore / NL 验证 / Intent 自愈将使用 AI_TEST_PROVIDER=openai 的配置）');
  } else if (provider === 'deepseek' && !deepseek && !anthropic && volcano.skipped) {
    lines.push('   （Studio「AI 优化脚本」可用侧栏密钥；Explore 等需在 .env 配置 LLM）');
  }

  return lines;
}

module.exports = {
  getVolcanoArkStatus,
  getLlmStartupLines,
};
