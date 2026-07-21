#!/usr/bin/env tsx
/**
 * CLI AI 优化（与 Studio server.js 共用 prompt 逻辑）
 *
 * npm run optimize:ai -- tests/raw-recordings/.../x.spec.ts
 * npm run optimize:ai -- tests/raw-recordings/.../x.spec.ts --provider=claude --out=tests/optimized/...
 */
import fs from 'fs';
import path from 'path';
import {
  buildOptimizePrompt,
  resolveAiProvider,
  stripMarkdownCodeFence,
  type OptimizeAiOpts,
} from './optimize-ai-shared.js';

const DEEPSEEK_API_BASE = (process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/$/, '');
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

function printHelp(): void {
  console.log(`用法: tsx scripts/optimize/optimize-with-ai.ts <spec.ts> [选项]

选项:
  --provider=claude|deepseek   AI 提供商（默认自动）
  --out=<path>                 输出路径（默认 stdout）
  --no-selector --no-assert --no-wait  关闭对应优化项
  -h, --help
`);
}

async function callClaude(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const block = json.content?.find((b: { type: string; text?: string }) => b.type === 'text');
  return block?.text || '';
}

async function callDeepSeek(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch(`${DEEPSEEK_API_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`DeepSeek API ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content || '';
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  if (argv.includes('-h') || argv.includes('--help') || argv.length === 0) {
    printHelp();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  let inputPath = '';
  let outPath: string | undefined;
  let providerHint: string | undefined;
  const opts: OptimizeAiOpts = {
    selector: true,
    assert: true,
    wait: true,
  };

  for (const arg of argv) {
    if (arg.startsWith('--out=')) outPath = arg.slice('--out='.length).trim();
    else if (arg.startsWith('--provider=')) providerHint = arg.slice('--provider='.length).trim();
    else if (arg === '--no-selector') opts.selector = false;
    else if (arg === '--no-assert') opts.assert = false;
    else if (arg === '--no-wait') opts.wait = false;
    else if (!arg.startsWith('--')) inputPath = arg;
  }

  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error(`❌ 文件不存在: ${inputPath || '(未指定)'}`);
    process.exit(1);
  }

  const code = fs.readFileSync(inputPath, 'utf-8');
  const keys = {
    anthropic: process.env.ANTHROPIC_API_KEY || null,
    deepseek: process.env.DEEPSEEK_API_KEY || null,
  };
  const { provider, fallback } = resolveAiProvider(providerHint, keys);
  if (fallback) console.log(`ℹ️  请求 ${providerHint} 不可用，降级为 ${provider}`);

  const apiKey = provider === 'claude' ? keys.anthropic : keys.deepseek;
  if (!apiKey) {
    console.error(`❌ 未配置 ${provider === 'claude' ? 'ANTHROPIC_API_KEY' : 'DEEPSEEK_API_KEY'}`);
    process.exit(1);
  }

  const prompt = buildOptimizePrompt(code, opts);
  console.log(`🤖 AI 优化中 (${provider})…`);
  const raw = provider === 'claude' ? await callClaude(prompt, apiKey) : await callDeepSeek(prompt, apiKey);
  const optimized = stripMarkdownCodeFence(raw);

  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, optimized, 'utf-8');
    console.log(`✅ 已写入: ${outPath}`);
  } else {
    process.stdout.write(optimized);
  }
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
