import { createRequire } from 'module';
import { runDirect } from '../jobs/job-runner.js';

const requireCjs = createRequire(import.meta.url);
const { cleanSpecScreenshots } = requireCjs('../../src/utils/clean-spec-screenshots.cjs') as {
  cleanSpecScreenshots: (
    repoRoot: string,
    specRel: string,
    opts?: { mode?: 'all' | 'latest'; cleanDiffs?: boolean },
  ) => { removed: string[]; message?: string };
};

function cleanFailedSpecs(specRels: string[]): void {
  const repoRoot = process.cwd();
  for (const rel of specRels) {
    const r = cleanSpecScreenshots(repoRoot, rel, { mode: 'latest', cleanDiffs: true });
    if (r.removed.length) {
      console.log(`🧹 已清理 ${rel}: ${r.removed.join(', ')}`);
    } else if (r.message) {
      console.log(`ℹ️  ${rel}: ${r.message}`);
    }
  }
}

function printHelp(): void {
  console.log(`用法: tsx scripts/flow/run-optimized-tests.ts [选项]

递归执行目录下所有 *.optimized.spec.ts，可按多个 Playwright project 各跑一遍。

选项:
  --projects=<a,b>          逗号分隔的 project 名（默认 optimized，与 playwright.config 一致）
  --optimized-dir=<path>    扫描根目录（默认 tests/optimized；可用环境变量 OPTIMIZED_TESTS_DIR）
  --stop, -s                某一用例失败后不再执行后续用例（仍会继续对比/飞书步骤）
  --verbose, -v             playwright 附加 --reporter=list
  --clean                   失败用例清理最新 run 截图与 diffs
  -h, --help                显示帮助
`);
}

function parseCli(argv: string[]): {
  verbose: boolean;
  stopOnError: boolean;
  clean: boolean;
  projects: string[];
  optimizedDir: string;
} {
  let verbose = false;
  let stopOnError = false;
  let clean = false;
  let projects: string[] = [];
  const envDir = process.env.OPTIMIZED_TESTS_DIR?.trim();
  let optimizedDir = envDir && envDir.length > 0 ? envDir : 'tests/optimized';

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
      continue;
    }
    if (arg === '--stop' || arg === '-s') {
      stopOnError = true;
      continue;
    }
    if (arg === '--clean') {
      clean = true;
      continue;
    }
    if (arg.startsWith('--projects=')) {
      projects = arg
        .slice('--projects='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    if (arg.startsWith('--optimized-dir=')) {
      const v = arg.slice('--optimized-dir='.length).trim();
      if (v) optimizedDir = v;
      continue;
    }
  }

  if (projects.length === 0) {
    projects = ['optimized'];
  }

  return { verbose, stopOnError, clean, projects, optimizedDir };
}

async function main(): Promise<void> {
  const { verbose, stopOnError, clean, projects, optimizedDir } = parseCli(process.argv.slice(2));

  if (clean) {
    console.log('ℹ️  --clean 将在失败时清理最新 run 截图\n');
  }

  console.log(
    `⚙️  projects=${projects.join(',')}, dir=${optimizedDir}, stop=${stopOnError}, verbose=${verbose}\n`,
  );

  const result = await runDirect(
    {
      projects,
      optimizedDir,
      specs: 'all',
      stopOnTestFailure: stopOnError,
      stopOnCompareGate: false,
      runCompareAfterAbort: true,
      verbose,
      playwrightEnv: process.env.PLAYWRIGHT_ENV?.trim() || 'stage',
      retryOnFail: Number(process.env.RETRY_ON_FAIL || '0') || 0,
      steps: {
        login: false,
        compare: true,
        compareGate: false,
        recordLastGreen: false,
        feishuNotify: true,
        createFeishuDoc: false,
        refreshLogin: false,
      },
      feishuMode: 'interactive',
      notifyOn: ['failure', 'success'],
      alwaysCreateFeishuDoc: true,
    },
    {
      trigger: 'run-optimized-tests',
      runId: `cli-${Date.now()}`,
      persistState: false,
    },
  );

  if (clean && !result.testPassed && result.summary.specPaths?.length) {
    console.log('\n🧹 --clean：清理失败用例最新 run 截图…');
    cleanFailedSpecs(result.summary.specPaths);
  }

  if (result.exitCode === 0) {
    console.log('\n🎉 所有步骤执行成功！');
  } else {
    console.error('\n⚠️ 流程已结束，但存在失败步骤（见上方日志与飞书摘要）');
  }

  process.exit(result.exitCode);
}

main();
