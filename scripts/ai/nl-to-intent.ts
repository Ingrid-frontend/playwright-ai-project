#!/usr/bin/env tsx
/**
 * 口语试跑 → Intent YAML 预览
 *
 *   npx tsx scripts/ai/nl-to-intent.ts --case="..." --entry=/main/approve --env=stage
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { stringify as stringifyYaml } from 'yaml';
import { completeJson } from '../../src/ai/llm-client.js';
import { buildNlToIntentPrompt, buildNlToIntentSystemPrompt } from '../../src/ai/prompts/nl-to-intent.js';
import { validateTestIntent } from '../../src/types/test-intent.js';
import { normalizeTestIntent, summarizeRunSteps } from '../../src/utils/intent-normalize.js';

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

function printHelp(): void {
  console.log(`用法: npx tsx scripts/ai/nl-to-intent.ts --case=<自然语言> [选项]

选项:
  --case=<text>       自然语言测试步骤（必需）
  --entry=<path>      入口路径
  --env=<env>         环境，默认 stage
  --script=<path>     参考 Playwright 脚本
  --run-dir=<dir>     读取 run/result.json 判断是否跑通
  --out=<dir>         输出目录（写入 intent.preview.yaml）
  --print             只打印 YAML
  -h, --help
`);
}

function readRunContext(runDir: string): { passed: boolean; stepSummary?: string } {
  const resultPath = path.join(runDir, 'result.json');
  if (!fs.existsSync(resultPath)) return { passed: false };
  try {
    const report = JSON.parse(fs.readFileSync(resultPath, 'utf-8')) as {
      passed?: boolean;
      steps?: Array<{
        id?: string;
        passed?: boolean;
        action?: { type?: string; description?: string; path?: string; expect?: string };
      }>;
    };
    const steps = Array.isArray(report.steps) ? report.steps : [];
    return {
      passed: report.passed === true,
      stepSummary: steps.length ? summarizeRunSteps(steps) : undefined,
    };
  } catch {
    return { passed: false };
  }
}

async function main(): Promise<void> {
  if (hasFlag('help') || hasFlag('h')) {
    printHelp();
    return;
  }

  const caseDescription = getArgValue('case');
  if (!caseDescription?.trim()) {
    console.error('❌ 需要 --case=');
    printHelp();
    process.exit(1);
  }

  const env = getArgValue('env') || process.env.PLAYWRIGHT_ENV || 'stage';
  const entry = getArgValue('entry') || '';
  const scriptPath = getArgValue('script');
  const runDir = getArgValue('run-dir');
  let scriptCode = '';
  if (scriptPath && fs.existsSync(scriptPath)) {
    scriptCode = fs.readFileSync(scriptPath, 'utf-8');
  }

  let runPassed = false;
  let runStepSummary: string | undefined;
  if (runDir) {
    const ctx = readRunContext(runDir);
    runPassed = ctx.passed;
    runStepSummary = ctx.stepSummary;
  }

  const draft = await completeJson<Record<string, unknown>>(
    buildNlToIntentPrompt({
      caseDescription,
      env,
      entry,
      scriptCode,
      runPassed,
      runStepSummary,
    }),
    { system: buildNlToIntentSystemPrompt(), temperature: 0.1, maxTokens: 4000 },
  );

  if (!draft.env) draft.env = env;
  if (!draft.entry && entry) draft.entry = entry;
  if (!draft.goal) draft.goal = caseDescription.slice(0, 120);

  let intent;
  try {
    intent = validateTestIntent(draft);
    intent = validateTestIntent(normalizeTestIntent(intent, { caseDescription }));
  } catch (err) {
    console.error(`❌ Intent 校验失败: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const yamlText = stringifyYaml(intent);
  const normalized = yamlText.endsWith('\n') ? yamlText : `${yamlText}\n`;

  if (hasFlag('print')) {
    process.stdout.write(normalized);
    return;
  }

  const outDir = getArgValue('out');
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'intent.preview.yaml'), normalized);
    fs.writeFileSync(path.join(outDir, 'intent.json'), `${JSON.stringify(intent, null, 2)}\n`);
    console.log(`📁 产出: ${outDir}`);
  } else {
    process.stdout.write(normalized);
  }
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
