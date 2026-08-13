export type AiProvider = 'anthropic' | 'deepseek' | 'openai';

export interface LlmConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface CompleteTextOptions {
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

function envValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function resolveLlmConfig(providerHint?: string): LlmConfig {
  const provider = (providerHint || envValue('AI_TEST_PROVIDER') || 'deepseek') as AiProvider;

  if (provider === 'anthropic') {
    const apiKey = envValue('AI_TEST_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY');
    const model = envValue('AI_TEST_MODEL', 'ANTHROPIC_MODEL') || 'claude-sonnet-4-20250514';
    if (!apiKey) throw new Error('未配置 Anthropic API Key，请设置 ANTHROPIC_API_KEY');
    return { provider, apiKey, model, baseUrl: envValue('ANTHROPIC_API_BASE') };
  }

  if (provider === 'openai') {
    const apiKey = envValue('AI_TEST_OPENAI_API_KEY', 'OPENAI_API_KEY');
    const model = envValue('AI_TEST_MODEL', 'OPENAI_MODEL') || 'gpt-4.1';
    if (!apiKey) throw new Error('未配置 OpenAI API Key，请设置 OPENAI_API_KEY');
    return { provider, apiKey, model, baseUrl: envValue('OPENAI_API_BASE') };
  }

  const apiKey = envValue('AI_TEST_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY');
  const model = envValue('AI_TEST_MODEL', 'DEEPSEEK_MODEL') || 'deepseek-chat';
  if (!apiKey) throw new Error('未配置 DeepSeek API Key，请设置 DEEPSEEK_API_KEY');
  return { provider, apiKey, model, baseUrl: envValue('AI_TEST_DEEPSEEK_BASE_URL', 'DEEPSEEK_API_BASE') };
}

export async function completeText(prompt: string, options: CompleteTextOptions = {}): Promise<string> {
  const config = resolveLlmConfig();
  const system = options.system?.trim();
  const temperature = options.temperature ?? 0.1;
  const maxTokens = options.maxTokens ?? 8000;

  if (config.provider === 'anthropic') {
    const base = (config.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    return json.content?.find((block) => block.type === 'text')?.text || '';
  }

  const defaultBase =
    config.provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com';
  const base = (config.baseUrl || defaultBase).replace(/\/$/, '');
  const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: prompt },
  ];

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`${config.provider} API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content || '';
}

export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();

  const firstObject = trimmed.indexOf('{');
  const lastObject = trimmed.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    return trimmed.slice(firstObject, lastObject + 1);
  }

  return trimmed;
}

export async function completeJson<T>(
  prompt: string,
  options: CompleteTextOptions = {},
): Promise<T> {
  const raw = await completeText(prompt, options);
  const jsonText = stripJsonFence(raw);
  try {
    return JSON.parse(jsonText) as T;
  } catch (error) {
    throw new Error(`模型返回的不是合法 JSON: ${error instanceof Error ? error.message : String(error)}\n${raw.slice(0, 800)}`);
  }
}
