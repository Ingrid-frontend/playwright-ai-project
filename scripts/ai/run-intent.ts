#!/usr/bin/env tsx
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import { parse as parseYaml } from 'yaml';
import { compileIntentToPlan } from '../../src/runtime/compile-intent.js';
import { executeAiTest } from '../../src/runtime/execute-ai-test.js';
import { executeIntentEgo } from '../../src/runtime/execute-intent-ego.js';
import { recordIntentTrustRun, resolveIntentKey } from '../../src/runtime/intent-trust.js';

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

function ensureBrowsersPath(): void {
  const current = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const macPath = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const valid = (value: string): boolean => {
    if (!value || !fs.existsSync(value)) return false;
    try {
      return fs.readdirSync(value).some((name) => name.startsWith('chromium'));
    } catch {
      return false;
    }
  };

  if (!valid(current || '') && valid(macPath)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = macPath;
  } else if (current?.includes('cursor-sandbox-cache') && !valid(current)) {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
}

function sanitizeName(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'intent'
  );
}

function printHelp(): void {
  console.log(`用法: npm run intent:run -- --intent=<path> [选项]

选项:
  --intent=<path>     Test Intent YAML
  --engine=ego|pw     执行引擎（默认 ego）
  --env=<env>         覆盖意图中的环境
  --profile=<id>      覆盖账号 profile（仅 pw 引擎）
  --out=<dir>         输出目录
  --headed            有头浏览器（仅 pw）
  --compare           跑完后执行 compare-screenshots
  --gate              与 --compare 联用，启用 gate
  --keep-tab          ego 跑完保留 Space
  --heal              强制开启自愈（默认开启；assert 永不自愈）
  --no-heal           关闭自愈
  -h, --help

边界: docs/ai-test-boundaries.md
自愈建议: npm run heal:suggest -- --run=<out>
可信度: npm run trust:report
`);
}

function expandRepoRootInYaml(text: string): string {
  const repoRoot = process.cwd();
  return text.replace(/\{repoRoot\}/g, repoRoot);
}

async function main(): Promise<void> {
  if (hasFlag('help') || hasFlag('h')) {
    printHelp();
    return;
  }

  const intentPath = getArgValue('intent');
  if (!intentPath || !fs.existsSync(intentPath)) {
    console.error(`❌ 测试意图文件不存在: ${intentPath || '(未指定)'}`);
    printHelp();
    process.exit(1);
  }

  const engineRaw = (getArgValue('engine') || 'ego').toLowerCase();
  const engine = engineRaw === 'ego' ? 'ego' : 'pw';

  if (engine === 'pw') ensureBrowsersPath();

  const rawYaml = expandRepoRootInYaml(fs.readFileSync(intentPath, 'utf-8'));
  const raw = parseYaml(rawYaml);
  const { intent, plan } = compileIntentToPlan(raw);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const defaultOut = path.join('results', 'intent-runs', `${stamp}-${sanitizeName(intent.name)}`);
  const outputDir = path.resolve(getArgValue('out') || defaultOut);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'intent.json'), `${JSON.stringify(intent, null, 2)}\n`, 'utf-8');
  // 供 Studio「查看脚本」直接打开；与 ego-studio 的 intent.preview.yaml 对齐
  fs.writeFileSync(
    path.join(outputDir, 'intent.yaml'),
    rawYaml.endsWith('\n') ? rawYaml : `${rawYaml}\n`,
    'utf-8',
  );

  const heal = hasFlag('no-heal') ? false : true;
  const env = getArgValue('env') || intent.env;
  const profile = getArgValue('profile') || intent.profile;
  const intentAbs = path.resolve(intentPath);

  if (intent.reviewRequired) {
    console.log('⚠️  reviewRequired=true：试跑/通过后仍须人审再合并');
  }

  console.log(`🛠  engine=${engine} · heal=${heal ? 'on' : 'off'}`);

  const result =
    engine === 'ego'
      ? await executeIntentEgo(plan, {
          env,
          profile,
          outputDir,
          heal,
          constraints: intent.constraints,
          keepTab: hasFlag('keep-tab'),
          intentPath: intentAbs,
        })
      : await executeAiTest(plan, {
          env,
          profile,
          headed: hasFlag('headed'),
          outputDir,
          heal,
          constraints: intent.constraints,
          intentPath: intentAbs,
        });

  const healed = result.steps.some((s) => s.healed);
  const trust = recordIntentTrustRun({
    intentKey: resolveIntentKey({
      scriptKey: intent.scriptKey,
      intentPath: intentAbs,
      name: intent.name,
    }),
    intentPath: path.relative(process.cwd(), intentAbs).replace(/\\/g, '/'),
    name: intent.name,
    reviewRequired: intent.reviewRequired,
    trustLevel: intent.trustLevel,
    passed: result.passed,
    healed,
  });

  console.log('');
  console.log(result.passed ? '✅ Intent 测试通过' : '❌ Intent 测试失败');
  console.log(`📁 输出目录: ${result.outputDir}`);
  if (result.replayRel) console.log(`🎬 流程回放: ${result.replayRel}`);
  console.log(
    `🏷  trust: 人设=${trust.trustLevel || '—'} · 建议=${trust.suggestedTrustLevel} · 连续通过=${trust.consecutivePass}`,
  );
  if (trust.alerts.length) {
    for (const a of trust.alerts) console.log(`⚠️  ${a}`);
  }
  for (const step of result.steps) {
    const status = step.passed ? '✅' : step.skipped ? '⏭️' : '❌';
    const healMark = step.healed ? ' [已自愈]' : '';
    console.log(`  ${status} ${step.id}${healMark}${step.error ? `: ${step.error}` : ''}`);
  }
  if (result.error) {
    console.log(`❌ ${result.error}`);
  }
  if (!result.passed && result.failureSummaryRel) {
    console.log(`📋 失败排查包: ${result.failureSummaryRel}`);
  }
  if (healed) {
    console.log(`🩹 自愈建议: ${path.join(result.outputDir, 'heal-suggest.md')}`);
  }

  if (hasFlag('compare') && result.passed) {
    const compareArgs = ['tsx', 'scripts/report/compare-screenshots.ts'];
    if (hasFlag('gate')) compareArgs.push('--gate');
    const cmp = spawnSync('npx', compareArgs, { cwd: process.cwd(), stdio: 'inherit', shell: false });
    process.exit(cmp.status ?? 1);
  }

  process.exit(result.passed ? 0 : 1);
}

main().catch((error) => {
  console.error('❌', error instanceof Error ? error.message : error);
  process.exit(1);
});
