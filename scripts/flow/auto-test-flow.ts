import crypto from 'crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { UiIssuesReport } from '../report/ui-issues.js';
import {
  assertSpecEnvMatch,
  getLegacyEnvDefault,
} from '../../src/utils/test-env-path.js';
import { resolveAccountProfile } from '../../src/utils/env-config.js';
import {
  groupSpecEntriesByProfile,
  resolveSpecEntriesFromRelatives,
  type SpecRunEntry,
} from '../jobs/job-utils.js';
import {
  findFiles,
  findOptimizedSpecForRawRecording,
  getAnalyzeErrorsSummary,
  isRawRecordingSpecPath,
  isUnderOriginal,
  recordLastGreenForScript,
  runAnalyzeErrorsOnFailure,
  runAnalyzeTest,
  runCommand,
  scriptKeyFromOptimizedPath,
  specPathInOriginal,
  tryAutoPromoteBaseline,
} from './flow-shared.js';

type FeishuMode = 'interactive' | 'text' | 'links' | 'none';

type CliOptions = {
  feishuMode: FeishuMode;
  createFeishuDoc: boolean;
  playwrightProjects: string[];
  rawRecordingsDir?: string;
  specPath?: string;
  batch: boolean;
  compareGate: boolean;
  fromOriginal: boolean;
  analyzeGate: boolean;
  retryOnFail: number;
  workers: number;
  heal: boolean;
};

type AutoTestNotifySummary = {
  recordSkipped: boolean;
  testPassed: boolean;
  comparePassed: boolean;
  feishuDocAttempted: boolean;
  feishuDocPassed: boolean;
  uiIssues?: UiIssuesReport['summary'];
  errorSummary?: string;
};

function buildNotifyResultMarkdown(s: AutoTestNotifySummary): string {
  const lines = [
    '**测试结果**：',
    s.recordSkipped ? '⏭️ 录制：跳过（CI）' : '✅ 录制：成功',
    '✅ 优化：成功（pipeline-raw-to-optimized）',
    `${s.testPassed ? '✅' : '❌'} 执行：${s.testPassed ? '成功' : '失败'}`,
    `${s.comparePassed ? '✅' : '❌'} 对比：${s.comparePassed ? '成功' : '失败'}`,
  ];
  if (s.feishuDocAttempted) {
    lines.push(`${s.feishuDocPassed ? '✅' : '❌'} 飞书文档：${s.feishuDocPassed ? '成功' : '失败'}`);
  }
  if (s.uiIssues) {
    lines.push(
      `**UI 问题**：blocker ${s.uiIssues.blocker} · warning ${s.uiIssues.warning} · 共 ${s.uiIssues.total} 项`,
    );
    lines.push(`报告：results/screenshot-comparison.html · results/ui-issues.json`);
  }
  if (s.errorSummary) lines.push(s.errorSummary);
  return lines.join('\n');
}

function notifyCardHeader(s: AutoTestNotifySummary): { title: string; template: string } {
  const allOk =
    s.testPassed && s.comparePassed && (!s.feishuDocAttempted || s.feishuDocPassed);
  if (allOk) {
    return { title: '🎉 Playwright AI 测试完成', template: 'green' };
  }
  return { title: '⚠️ Playwright AI 测试未完成', template: 'red' };
}

function printHelp(): void {
  console.log(`用法: tsx scripts/flow/auto-test-flow.ts [选项]

录制 → pipeline（预处理+优化）→ 执行 → 截图对比 →（可选）飞书

选项:
  --feishu-mode=<interactive|text|links|none>
  --create-feishu-doc
  --playwright-project=<a>[,<b>...]
  --raw-recordings-dir=<path>
  --spec=<path>                 raw .spec.ts（含 original/ 路径）
  --from-original               扫描时包含 tests/raw-recordings/original/
  --batch                       批量处理全部 raw
  --gate                        compare-screenshots --gate
  --analyze-gate                analyze-test 有 error 时失败
  --retry-on-fail=<N>           flake 类失败重跑次数（默认 0）
  --workers=<N>                 批量执行 workers（默认 2）
  --heal                        失败后尝试 heal-spec（POC）
  -h, --help
`);
}

function parseCli(argv: string[]): CliOptions {
  const envMode = process.env.FEISHU_MODE?.toLowerCase();
  let feishuMode: FeishuMode = 'interactive';
  if (
    envMode &&
    (envMode === 'interactive' || envMode === 'text' || envMode === 'links' || envMode === 'none')
  ) {
    feishuMode = envMode;
  }

  let createFeishuDoc = false;
  let playwrightProjects: string[] = ['optimized', 'optimized-webkit'];
  let rawRecordingsDir: string | undefined;
  let specPath: string | undefined;
  let batch = false;
  let compareGate = false;
  let fromOriginal = false;
  let analyzeGate = false;
  let retryOnFail = Number(process.env.AUTO_TEST_RETRY_ON_FAIL || '0') || 0;
  let workers = Number(process.env.AUTO_TEST_WORKERS || '2') || 2;
  let heal = false;

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--create-feishu-doc') {
      createFeishuDoc = true;
      continue;
    }
    if (arg.startsWith('--feishu-mode=')) {
      const v = arg.slice('--feishu-mode='.length).toLowerCase();
      if (v !== 'interactive' && v !== 'text' && v !== 'links' && v !== 'none') {
        console.error(`❌ 无效的 --feishu-mode: ${v}`);
        process.exit(1);
      }
      feishuMode = v;
      continue;
    }
    if (arg.startsWith('--playwright-project=')) {
      const raw = arg.slice('--playwright-project='.length).trim();
      const list = raw
        ? raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      playwrightProjects = list.length > 0 ? list : ['optimized', 'optimized-webkit'];
      continue;
    }
    if (arg.startsWith('--raw-recordings-dir=')) {
      rawRecordingsDir = arg.slice('--raw-recordings-dir='.length).trim();
      if (!rawRecordingsDir) {
        console.error('❌ --raw-recordings-dir 不能为空');
        process.exit(1);
      }
      continue;
    }
    if (arg.startsWith('--spec=')) {
      specPath = arg.slice('--spec='.length).trim();
      continue;
    }
    if (arg === '--batch') {
      batch = true;
      continue;
    }
    if (arg === '--gate') {
      compareGate = true;
      continue;
    }
    if (arg === '--from-original') {
      fromOriginal = true;
      continue;
    }
    if (arg === '--analyze-gate') {
      analyzeGate = true;
      continue;
    }
    if (arg.startsWith('--retry-on-fail=')) {
      retryOnFail = Math.max(0, Number(arg.slice('--retry-on-fail='.length)) || 0);
      continue;
    }
    if (arg.startsWith('--workers=')) {
      workers = Math.max(1, Number(arg.slice('--workers='.length)) || 2);
      continue;
    }
    if (arg === '--heal') {
      heal = true;
      continue;
    }
  }

  return {
    feishuMode,
    createFeishuDoc,
    playwrightProjects,
    rawRecordingsDir,
    specPath,
    batch,
    compareGate,
    fromOriginal,
    analyzeGate,
    retryOnFail,
    workers,
    heal,
  };
}

async function sendFeishuNotification(mode: FeishuMode, summary: AutoTestNotifySummary): Promise<void> {
  if (mode === 'none') {
    console.log('ℹ️  feishu-mode=none，跳过飞书通知');
    return;
  }

  let effectiveMode = mode;
  const githubEnabled = process.env.ENABLE_GITHUB === '1';
  if (mode === 'links' && !githubEnabled) {
    console.log('ℹ️  未启用 GitHub 链接（ENABLE_GITHUB!=1），降级为 interactive');
    effectiveMode = 'interactive';
  }

  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  const webhookSecret = process.env.FEISHU_WEBHOOK_SECRET;
  if (!webhookUrl) {
    console.log('⚠️  未配置飞书 Webhook URL，跳过通知');
    return;
  }

  const resultMd = buildNotifyResultMarkdown(summary);
  const { title: cardTitle, template: cardTemplate } = notifyCardHeader(summary);

  const body =
    effectiveMode === 'text'
      ? {
          msg_type: 'text',
          content: { text: `${cardTitle}\n\n${resultMd}` },
        }
      : {
          msg_type: 'interactive',
          card: {
            header: {
              title: { tag: 'plain_text', content: cardTitle },
              template: cardTemplate,
            },
            elements: [{ tag: 'div', text: { tag: 'lark_md', content: resultMd } }],
          },
        };

  const timestamp = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (webhookSecret) {
    const bodyString = JSON.stringify(body);
    const sign = crypto.createHmac('sha256', webhookSecret).update(`${timestamp}\n${bodyString}`).digest('base64');
    headers['X-Lark-Request-Timestamp'] = String(timestamp);
    headers['X-Lark-Signature'] = sign;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    console.log(response.ok ? '✅ 飞书通知发送成功' : `❌ 飞书通知失败: ${await response.text()}`);
  } catch (error) {
    console.log('❌ 飞书通知发送异常:', error);
  }
}

function resolveRawRecordingsRoot(cliDir: string | undefined, fromOriginal: boolean): string {
  const explicit = cliDir?.trim() || process.env.RAW_RECORDINGS_DIR?.trim();
  const includeOriginal = fromOriginal;

  if (explicit) {
    const abs = path.resolve(process.cwd(), explicit);
    if (!fs.existsSync(abs)) throw new Error(`录制目录不存在: ${abs}`);
    const specs = findFiles(abs, /\.spec\.ts$/).filter((p) =>
      isRawRecordingSpecPath(p, abs, { includeOriginal }),
    );
    if (specs.length === 0) {
      throw new Error(`录制目录中未找到可用 .spec.ts: ${abs}`);
    }
    return abs;
  }

  const defaultRawRoot = 'tests/raw-recordings';
  const abs = path.resolve(process.cwd(), defaultRawRoot);
  if (fs.existsSync(abs)) {
    const specs = findFiles(abs, /\.spec\.ts$/).filter((p) =>
      isRawRecordingSpecPath(p, abs, { includeOriginal }),
    );
    if (specs.length > 0) return abs;
    if (fromOriginal) {
      const orig = path.join(abs, 'original');
      if (fs.existsSync(orig)) {
        const origSpecs = findFiles(orig, /\.spec\.ts$/);
        if (origSpecs.length > 0) return abs;
      }
    }
  }

  throw new Error(
    `未找到可用录制文件。请使用 --spec、--from-original 或设置 RAW_RECORDINGS_DIR。`,
  );
}

function resolveRawSpecs(opts: CliOptions, rawRecordingsDir: string): string[] {
  const includeOriginal = opts.fromOriginal || Boolean(opts.specPath && specPathInOriginal(opts.specPath));

  if (opts.specPath) {
    const abs = path.resolve(process.cwd(), opts.specPath);
    if (!fs.existsSync(abs)) throw new Error(`--spec 路径不存在: ${abs}`);
    if (abs.includes('.optimized.')) {
      throw new Error('--spec 请指向 raw 录制 .spec.ts');
    }
    return [abs];
  }

  const all = findFiles(rawRecordingsDir, /\.spec\.ts$/)
    .filter((p) => isRawRecordingSpecPath(p, rawRecordingsDir, { includeOriginal }))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (opts.batch) return all;
  if (all.length === 0) throw new Error('录制文件不存在');
  return [all[0]!];
}

function pipelineInputForRaw(rawPath: string): string {
  if (isUnderOriginal(rawPath, path.resolve(process.cwd(), 'tests/raw-recordings'))) {
    return rawPath;
  }
  return rawPath;
}

function optimizeOneRaw(rawRecordingPath: string, optimizedDir: string, opts: CliOptions): string {
  console.log(`\n📁 处理录制: ${rawRecordingPath}`);
  const pipelineInput = pipelineInputForRaw(rawRecordingPath);
  runCommand(
    `npm run pipeline-raw-to-optimized -- "${pipelineInput}"`,
    '预处理 + 优化（pipeline-raw-to-optimized）',
  );

  const optimizedTestPath = findOptimizedSpecForRawRecording(rawRecordingPath, optimizedDir);
  if (!optimizedTestPath) {
    throw new Error(`未找到优化产物: ${rawRecordingPath}`);
  }
  console.log(`📁 优化文件: ${optimizedTestPath}`);

  const optimizedRel = path.relative(process.cwd(), optimizedTestPath).replace(/\\/g, '/');
  const runtimeEnv = process.env.PLAYWRIGHT_ENV?.trim() || getLegacyEnvDefault();
  assertSpecEnvMatch(optimizedRel, runtimeEnv);

  runAnalyzeTest(optimizedTestPath, opts.analyzeGate);
  return optimizedTestPath;
}

function runLoginForProfile(playwrightEnv: string, profile: string): boolean {
  const resolved = resolveAccountProfile(playwrightEnv, profile);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PLAYWRIGHT_ENV: playwrightEnv,
    PLAYWRIGHT_ACCOUNT: resolved,
  };
  return runCommand('npm run login', `登录 ${playwrightEnv} / ${resolved}`, true);
}

function runPlaywrightSpecs(
  relPaths: string[],
  project: string,
  workers: number,
  retryOnFail: number,
): boolean {
  if (relPaths.length === 0) return true;
  const quoted = relPaths.map((p) => `"${p}"`).join(' ');
  const cmd = `npx playwright test ${quoted} --project=${project} --workers=${workers}`;
  let attempt = 0;
  while (attempt <= retryOnFail) {
    if (attempt > 0) console.log(`\n🔁 重试 ${attempt}/${retryOnFail}…`);
    const ok = runCommand(cmd, `执行测试 (${project}, ${relPaths.length} 个用例)`, true);
    if (ok) return true;
    attempt++;
  }
  return false;
}

function executeOptimizedBatch(
  optimizedPaths: string[],
  opts: CliOptions,
): { testPassed: boolean; executedKeys: string[] } {
  const optimizedDir = 'tests/optimized';
  const runtimeEnv = process.env.PLAYWRIGHT_ENV?.trim() || getLegacyEnvDefault();
  const relPaths = optimizedPaths.map((p) => path.relative(process.cwd(), p).replace(/\\/g, '/'));
  const entries = resolveSpecEntriesFromRelatives(relPaths, optimizedDir, runtimeEnv);
  const groups = groupSpecEntriesByProfile(entries);

  let testPassed = true;
  const executedKeys: string[] = [];

  for (const [profile, groupEntries] of groups) {
    const loginProfile = profile === 'unknown' ? 'default' : profile;
    runLoginForProfile(runtimeEnv, loginProfile);

    const groupRels = groupEntries.map((e: SpecRunEntry) => e.relPath);
    for (const project of opts.playwrightProjects) {
      const ok = runPlaywrightSpecs(groupRels, project, opts.workers, opts.retryOnFail);
      testPassed = testPassed && ok;
    }

    for (const entry of groupEntries) {
      executedKeys.push(scriptKeyFromOptimizedPath(entry.absPath));
    }
  }

  return { testPassed, executedKeys };
}

function readUiIssuesSummary(): UiIssuesReport['summary'] | undefined {
  return readUiIssuesReport()?.summary;
}

function readUiIssuesReport(): UiIssuesReport | undefined {
  const p = path.join(process.cwd(), 'results/ui-issues.json');
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as UiIssuesReport;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  const optimizedDir = 'tests/optimized';

  console.log('🎬 开始自动化测试流程...\n');

  const isCI =
    process.env.CI === 'true' ||
    process.env.CI === '1' ||
    process.env.GITHUB_ACTIONS === 'true' ||
    process.env.GITHUB_ACTIONS === '1';

  try {
    if (isCI) {
      console.log('🤖 CI 环境，跳过录制');
    } else {
      runCommand('npm run record', '1. 录制测试脚本');
    }

    const rawRecordingsDir = resolveRawRecordingsRoot(opts.rawRecordingsDir, opts.fromOriginal);
    const rawSpecs = resolveRawSpecs(opts, rawRecordingsDir);
    if (rawSpecs.length === 0) throw new Error('录制文件不存在');

    const optimizedPaths: string[] = [];
    for (let i = 0; i < rawSpecs.length; i++) {
      if (opts.batch && rawSpecs.length > 1) {
        console.log(`\n━━━ 批量优化 [${i + 1}/${rawSpecs.length}] ━━━`);
      }
      optimizedPaths.push(optimizeOneRaw(rawSpecs[i]!, optimizedDir, opts));
    }

    let testPassed: boolean;
    const lastRaw = rawSpecs[rawSpecs.length - 1]!;
    const lastOptimized = optimizedPaths[optimizedPaths.length - 1]!;

    if (rawSpecs.length > 1 || opts.batch) {
      const batchResult = executeOptimizedBatch(optimizedPaths, opts);
      testPassed = batchResult.testPassed;
      if (testPassed) {
        for (const key of [...new Set(batchResult.executedKeys)]) {
          recordLastGreenForScript(key, ['chrome', 'webkit']);
        }
      }
    } else {
      const singleRel = path.relative(process.cwd(), optimizedPaths[0]!).replace(/\\/g, '/');
      testPassed = true;
      for (const project of opts.playwrightProjects) {
        const ok = runPlaywrightSpecs([singleRel], project, 1, opts.retryOnFail);
        testPassed = testPassed && ok;
      }
      if (testPassed) {
        recordLastGreenForScript(scriptKeyFromOptimizedPath(optimizedPaths[0]!), ['chrome', 'webkit']);
      }
    }

    if (!testPassed) {
      runAnalyzeErrorsOnFailure();
      if (opts.heal && lastOptimized) {
        runCommand(`npx tsx scripts/flow/heal-spec.ts "${lastOptimized}"`, 'Healer POC', true);
      }
    }

    const gateFlag = opts.compareGate ? ' -- --gate' : '';
    const comparePassed = runCommand(
      `npm run compare-screenshots${gateFlag}`,
      '4. 生成截图对比报告',
      !opts.compareGate,
    );

    const uiReport = readUiIssuesReport();
    const uiIssues = uiReport?.summary;
    if (testPassed && comparePassed && uiIssues) {
      tryAutoPromoteBaseline(
        scriptKeyFromOptimizedPath(lastOptimized),
        uiIssues.blocker || 0,
        uiReport?.issues,
      );
    }

    let feishuDocPassed = true;
    if (opts.createFeishuDoc) {
      feishuDocPassed = runCommand('npm run create-feishu-doc', '5. 创建飞书文档', true);
    }

    const errorSummary = testPassed ? undefined : getAnalyzeErrorsSummary();

    await sendFeishuNotification(opts.feishuMode, {
      recordSkipped: isCI,
      testPassed,
      comparePassed,
      feishuDocAttempted: opts.createFeishuDoc,
      feishuDocPassed,
      uiIssues,
      errorSummary,
    });

    const flowAllOk = testPassed && comparePassed && (!opts.createFeishuDoc || feishuDocPassed);

    console.log(`\n📁 生成的文件:`);
    console.log(`  - 录制: ${lastRaw}`);
    console.log(`  - 优化: ${lastOptimized}`);
    console.log(`  - 对比报告: results/screenshot-comparison.html`);

    if (flowAllOk) {
      console.log('\n🎉 所有步骤执行成功！');
    } else {
      process.exit(1);
    }
  } catch (e) {
    console.error('\n❌ 流程执行失败');
    if (e instanceof Error && e.message) console.error(e.message);
    process.exit(1);
  }
}

main();
