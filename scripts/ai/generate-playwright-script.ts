#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { completeText } from '../../src/ai/llm-client.js';
import {
  buildGeneratePlaywrightScriptPrompt,
  buildGeneratePlaywrightScriptSystemPrompt,
} from '../../src/ai/prompts/generate-playwright-script.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

function getArgValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const prefix = `--${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === `--${name}` && i + 1 < args.length) return args[i + 1];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).some((arg) => arg === `--${name}`);
}

function sanitizeName(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'ai-test'
  );
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:typescript|ts)?\s*([\s\S]*?)```/i);
  return (fence?.[1] || trimmed).trim();
}

function sanitizeGeneratedCode(code: string): string {
  return code
    .split('\n')
    .filter((line) => !/^\s*import\s/.test(line) && !/^\s*export\s/.test(line))
    .join('\n')
    .trim();
}

function printHelp(): void {
  console.log(`用法: npx tsx scripts/ai/generate-playwright-script.ts [选项]

选项:
  --case="打开我的审批，点击最新记录并断言详情可见"   自然语言用例
  --recording=<path>                               已有录制脚本，仅作业务步骤参考
  --env=<env>                                      目标环境
  --entry=<path>                                   入口路径
  --out=<path>                                     输出 TypeScript 脚本路径
  --print                                         只输出代码，不落盘
  --provider=<anthropic|deepseek|openai>           AI 提供商
  -h, --help
`);
}

async function main(): Promise<void> {
  if (hasFlag('help') || hasFlag('h')) {
    printHelp();
    return;
  }

  const caseDescription = getArgValue('case');
  const recordingPath = getArgValue('recording');
  if (!caseDescription && !recordingPath) {
    console.error('❌ 需要 --case 或 --recording');
    printHelp();
    process.exit(1);
  }

  let recordingCode: string | undefined;
  if (recordingPath) {
    if (!fs.existsSync(recordingPath)) {
      console.error(`❌ 录制脚本不存在: ${recordingPath}`);
      process.exit(1);
    }
    recordingCode = fs.readFileSync(recordingPath, 'utf-8');
  }

  process.env.AI_TEST_PROVIDER = getArgValue('provider') || process.env.AI_TEST_PROVIDER || '';

  console.log('🤖 正在生成 Playwright 脚本...');
  const code = sanitizeGeneratedCode(
    stripCodeFence(
      await completeText(
        buildGeneratePlaywrightScriptPrompt({
          caseDescription: caseDescription || '根据录制脚本生成可执行 Playwright 脚本',
          env: getArgValue('env') || process.env.PLAYWRIGHT_ENV,
          entry: getArgValue('entry'),
          recordingCode,
        }),
        {
          system: buildGeneratePlaywrightScriptSystemPrompt(),
          temperature: 0,
          maxTokens: 12000,
        },
      ),
    ),
  );

  const usesPlaywrightApi = /page\s*\./.test(code) || /expect\s*\(/.test(code);
  if (!usesPlaywrightApi) {
    throw new Error(`模型返回内容不是有效 Playwright 代码:\n${code.slice(0, 500)}`);
  }

  if (hasFlag('print')) {
    process.stdout.write(`${code}\n`);
    return;
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const defaultPath = path.join('tests/ai-generated', `${stamp}-${sanitizeName(caseDescription || recordingPath || 'case')}.generated.ts`);
  const outPath = path.resolve(getArgValue('out') || defaultPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${code}\n`, 'utf-8');
  console.log(`✅ 已生成 Playwright 脚本: ${outPath}`);
  console.log(`   代码行数: ${code.split('\n').length}`);
}

main().catch((error) => {
  console.error('❌', error instanceof Error ? error.message : error);
  process.exit(1);
});
