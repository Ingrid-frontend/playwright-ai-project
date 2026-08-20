import fs from 'fs';
import path from 'path';
import type { UiIssuesReport } from '../report/ui-issues-index.js';
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
import { sendFeishuNotification, type FeishuMode } from './auto-test-notify.js';

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
};

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
  };
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
