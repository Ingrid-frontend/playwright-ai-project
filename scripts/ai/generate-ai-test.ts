#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { completeJson } from '../../src/ai/llm-client.js';
import {
  buildGeneratePlanPrompt,
  buildGeneratePlanSystemPrompt,
} from '../../src/ai/prompts/generate-plan.js';
import { validateSemanticTestPlan } from '../../src/types/ai-test-plan.js';

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

function printHelp(): void {
  console.log(`用法: npx tsx scripts/ai/generate-ai-test.ts [选项]

选项:
  --case="打开我的审批，选择最新记录并断言状态"   自然语言用例
  --recording=<path>                           已有录制脚本，作为业务步骤参考
  --env=<env>                                  目标环境
  --entry=<path>                               入口路径
  --out=<path>                                 输出 JSON 路径
  --print                                     只输出 JSON，不落盘
  --provider=<anthropic|deepseek|openai>       AI 提供商
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

  const env = getArgValue('env') || process.env.PLAYWRIGHT_ENV;
  const entry = getArgValue('entry');
  const prompt = buildGeneratePlanPrompt({
    caseDescription: caseDescription || '根据录制脚本生成语义测试计划',
    env,
    entry,
    recordingCode,
  });

  process.env.AI_TEST_PROVIDER = getArgValue('provider') || process.env.AI_TEST_PROVIDER || '';

  console.log('🤖 正在生成语义测试计划...');
  const rawPlan = await completeJson<unknown>(prompt, {
    system: buildGeneratePlanSystemPrompt(),
    temperature: 0,
    maxTokens: 16000,
  });
  const plan = validateSemanticTestPlan(rawPlan);

  if (hasFlag('print')) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  const outDir = path.dirname(path.resolve(getArgValue('out') || 'tests/ai-native'));
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const outPath = getArgValue('out') || path.join(outDir, `${stamp}-${sanitizeName(plan.name)}.json`);
  fs.writeFileSync(path.resolve(outPath), `${JSON.stringify(plan, null, 2)}\n`, 'utf-8');
  console.log(`✅ 已生成语义计划: ${outPath}`);
  console.log(`   步骤数: ${plan.steps.length}`);
}

main().catch((error) => {
  console.error('❌', error instanceof Error ? error.message : error);
  process.exit(1);
});
