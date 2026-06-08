import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { NotifyOn, ResolvedTestJob } from './test-jobs-config.js';
import { resolveJob } from './test-jobs-config.js';
import {
  clearLock,
  readLock,
  runDir,
  writeLock,
  writeStatus,
  writeSummary,
  type JobRunStatus,
  type JobSummaryFile,
} from './job-lock.js';
import { readUiIssuesSummaryLine, sendJobFeishuNotification } from './job-notify.js';
import {
  formatRunId,
  isProcessAlive,
  projectToBrowser,
  recordLastGreenForScript,
  resolveSpecPaths,
  scriptKeyFromOptimizedPath,
} from './job-utils.js';

export type DirectRunOptions = {
  /** 非 Job 模式：直接传入执行参数（run-optimized-tests 使用） */
  projects: string[];
  optimizedDir: string;
  specs: 'all' | string[];
  stopOnTestFailure: boolean;
  stopOnCompareGate: boolean;
  runCompareAfterAbort: boolean;
  verbose: boolean;
  playwrightEnv?: string;
  steps: ResolvedTestJob['steps'];
  feishuMode: ResolvedTestJob['feishuMode'];
  notifyOn: NotifyOn[];
  /** 始终创建飞书文档（run-optimized-tests 兼容） */
  alwaysCreateFeishuDoc?: boolean;
};

export type JobRunContext = {
  jobId?: string;
  job?: ResolvedTestJob;
  trigger: 'manual' | 'schedule' | 'cli' | 'run-optimized-tests';
  runId: string;
  /** 写入状态文件；run-optimized-tests 传 false */
  persistState?: boolean;
  force?: boolean;
};

export type JobRunResult = {
  exitCode: number;
  testPassed: boolean;
  comparePassed: boolean;
  compareSkipped: boolean;
  aborted: boolean;
  feishuDocPassed: boolean;
  summary: JobSummaryFile;
};

function runCommandBool(command: string, description: string): boolean {
  console.log(`\n📋 ${description}`);
  console.log(`🔧 执行命令: ${command}`);
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`✅ ${description} 完成`);
    return true;
  } catch {
    console.error(`❌ ${description} 失败`);
    return false;
  }
}

function shouldNotify(notifyOn: NotifyOn[], success: boolean): boolean {
  if (success && notifyOn.includes('success')) return true;
  if (!success && notifyOn.includes('failure')) return true;
  return false;
}

function updateStatus(
  ctx: JobRunContext,
  patch: Partial<{ status: JobRunStatus; finishedAt: string }>,
): void {
  if (!ctx.persistState || !ctx.jobId) return;
  const statusPath = path.join(runDir(ctx.jobId, ctx.runId), 'status.json');
  let current = {
    jobId: ctx.jobId,
    runId: ctx.runId,
    status: 'running' as JobRunStatus,
    trigger: ctx.trigger,
    startedAt: new Date().toISOString(),
    pid: process.pid,
  };
  if (fs.existsSync(statusPath)) {
    try {
      current = { ...current, ...JSON.parse(fs.readFileSync(statusPath, 'utf-8')) };
    } catch {
      /* ignore */
    }
  }
  writeStatus(ctx.jobId, ctx.runId, { ...current, ...patch });
}

async function executeTests(
  opts: DirectRunOptions,
  specAbsPaths: string[],
): Promise<{
  totalSuccessCount: number;
  totalFailCount: number;
  aborted: boolean;
  executedSpecPaths: string[];
}> {
  let totalSuccessCount = 0;
  let totalFailCount = 0;
  let aborted = false;
  const executedSpecPaths: string[] = [];

  for (const project of opts.projects) {
    console.log(`\n🌐 开始执行 project「${project}」...\n`);

    for (const absPath of specAbsPaths) {
      const relPath = path.relative(process.cwd(), absPath);
      console.log(`\n🧪 执行测试: ${relPath} (${project})`);
      executedSpecPaths.push(absPath);

      const reporter = opts.verbose ? '--reporter=list' : '';
      const env = opts.playwrightEnv ? { ...process.env, PLAYWRIGHT_ENV: opts.playwrightEnv } : process.env;
      try {
        execSync(`npx playwright test "${relPath}" --project=${project} --workers=1 ${reporter}`.trim(), {
          stdio: 'inherit',
          env,
        });
        console.log(`✅ ${relPath} 测试通过 (${project})`);
        totalSuccessCount++;
      } catch {
        console.error(`❌ ${relPath} 测试失败 (${project})`);
        totalFailCount++;
        if (opts.stopOnTestFailure) {
          aborted = true;
          break;
        }
      }
    }

    if (aborted) {
      console.log('\n⏹️  已启用失败即停，后续 project / 用例不再执行。');
      break;
    }
  }

  return { totalSuccessCount, totalFailCount, aborted, executedSpecPaths };
}

export async function runJobById(
  jobId: string,
  ctxPartial: Omit<JobRunContext, 'jobId' | 'job' | 'runId'> & { runId?: string },
): Promise<JobRunResult> {
  const job = resolveJob(jobId);
  if (!job.enabled && !ctxPartial.force) {
    throw new Error(`Job「${jobId}」已禁用（enabled: false）`);
  }

  const runId = ctxPartial.runId ?? formatRunId();
  const ctx: JobRunContext = {
    jobId,
    job,
    runId,
    trigger: ctxPartial.trigger,
    persistState: ctxPartial.persistState !== false,
    force: ctxPartial.force,
  };

  return runDirect(
    {
      projects: job.projects,
      optimizedDir: job.optimizedDir,
      specs: job.specs,
      stopOnTestFailure: job.stopOnTestFailure,
      stopOnCompareGate: job.stopOnCompareGate,
      runCompareAfterAbort: job.runCompareAfterAbort,
      verbose: false,
      playwrightEnv: job.playwrightEnv,
      steps: job.steps,
      feishuMode: job.feishuMode,
      notifyOn: job.notifyOn,
      alwaysCreateFeishuDoc: job.steps.createFeishuDoc,
    },
    ctx,
  );
}

export async function runDirect(opts: DirectRunOptions, ctx: JobRunContext): Promise<JobRunResult> {
  const runId = ctx.runId;
  const jobId = ctx.jobId ?? 'direct';
  const persist = ctx.persistState !== false && Boolean(ctx.jobId);

  if (persist && ctx.jobId) {
    writeLock(ctx.jobId, {
      pid: process.pid,
      runId,
      startedAt: new Date().toISOString(),
      trigger: ctx.trigger,
    });
    writeStatus(ctx.jobId, runId, {
      jobId: ctx.jobId,
      runId,
      status: 'running',
      trigger: ctx.trigger,
      startedAt: new Date().toISOString(),
      pid: process.pid,
    });
  }

  if (opts.playwrightEnv) {
    process.env.PLAYWRIGHT_ENV = opts.playwrightEnv;
  }

  console.log(`\n🎬 开始执行任务${ctx.jobId ? `「${ctx.jobId}」` : ''} (runId=${runId}, trigger=${ctx.trigger})\n`);

  const absOptimizedDir = path.resolve(process.cwd(), opts.optimizedDir);
  if (!fs.existsSync(absOptimizedDir) || !fs.statSync(absOptimizedDir).isDirectory()) {
    throw new Error(`优化测试目录不存在或不是目录: ${absOptimizedDir}`);
  }

  const specAbsPaths = resolveSpecPaths(opts.specs, opts.optimizedDir);
  if (specAbsPaths.length === 0) {
    console.log('⚠️  未找到匹配的优化测试文件');
    const emptySummary: JobSummaryFile = {
      jobId,
      runId,
      trigger: ctx.trigger,
      testPassed: true,
      comparePassed: true,
      compareSkipped: true,
      aborted: false,
      totalSpecs: 0,
      executedCount: 0,
      successCount: 0,
      failCount: 0,
      projects: opts.projects,
      specPaths: [],
    };
    if (persist && ctx.jobId) {
      writeSummary(ctx.jobId, runId, emptySummary);
      updateStatus(ctx, { status: 'success', finishedAt: new Date().toISOString() });
      clearLock(ctx.jobId);
    }
    return {
      exitCode: 0,
      testPassed: true,
      comparePassed: true,
      compareSkipped: true,
      aborted: false,
      feishuDocPassed: true,
      summary: emptySummary,
    };
  }

  console.log(`📋 找到 ${specAbsPaths.length} 个测试文件\n`);

  if (opts.steps.login) {
    const loginCmd = opts.steps.refreshLogin ? 'npm run login:force' : 'npm run login';
    const loginOk = runCommandBool(loginCmd, '登录（storage state）');
    if (!loginOk) {
      const failSummary: JobSummaryFile = {
        jobId,
        runId,
        trigger: ctx.trigger,
        testPassed: false,
        comparePassed: false,
        compareSkipped: true,
        aborted: true,
        totalSpecs: specAbsPaths.length,
        executedCount: 0,
        successCount: 0,
        failCount: 0,
        projects: opts.projects,
        specPaths: specAbsPaths.map((p) => path.relative(process.cwd(), p)),
      };
      if (persist && ctx.jobId) {
        writeSummary(ctx.jobId, runId, failSummary);
        updateStatus(ctx, { status: 'failed', finishedAt: new Date().toISOString() });
        clearLock(ctx.jobId);
      }
      return {
        exitCode: 1,
        testPassed: false,
        comparePassed: false,
        compareSkipped: true,
        aborted: true,
        feishuDocPassed: false,
        summary: failSummary,
      };
    }
  }

  const { totalSuccessCount, totalFailCount, aborted, executedSpecPaths } = await executeTests(
    opts,
    specAbsPaths,
  );

  const testPassed = totalFailCount === 0 && !aborted;
  let comparePassed = true;
  let compareSkipped = false;
  let feishuDocPassed = true;
  let feishuDocAttempted = false;

  const skipCompare = aborted && !opts.runCompareAfterAbort;
  if (opts.steps.compare && !skipCompare) {
    const compareCmd = opts.steps.compareGate
      ? 'npm run compare-screenshots -- --gate'
      : 'npm run compare-screenshots';
    comparePassed = runCommandBool(compareCmd, '生成截图对比报告');
    if (!comparePassed && opts.stopOnCompareGate) {
      /* gate 失败已在 comparePassed 体现 */
    }
  } else if (skipCompare) {
    compareSkipped = true;
    console.log('\n⏭️  执行已中断且 runCompareAfterAbort=false，跳过截图对比');
  }

  const createDoc = opts.alwaysCreateFeishuDoc || opts.steps.createFeishuDoc;
  if (createDoc && !skipCompare) {
    feishuDocAttempted = true;
    feishuDocPassed = runCommandBool('npm run create-feishu-doc', '创建飞书文档');
  }

  if (testPassed && opts.steps.recordLastGreen) {
    const uniqueSpecs = [...new Set(executedSpecPaths)];
    const browsers = [...new Set(opts.projects.map(projectToBrowser))];
    for (const spec of uniqueSpecs) {
      const scriptKey = scriptKeyFromOptimizedPath(spec, opts.optimizedDir);
      recordLastGreenForScript(scriptKey, browsers);
      console.log(`📝 已更新 last-green: ${scriptKey}`);
    }
  }

  const flowAllOk = testPassed && (compareSkipped || comparePassed) && (!feishuDocAttempted || feishuDocPassed);

  const summary: JobSummaryFile = {
    jobId,
    runId,
    trigger: ctx.trigger,
    testPassed,
    comparePassed,
    compareSkipped,
    aborted,
    totalSpecs: specAbsPaths.length,
    executedCount: totalSuccessCount + totalFailCount,
    successCount: totalSuccessCount,
    failCount: totalFailCount,
    projects: opts.projects,
    specPaths: specAbsPaths.map((p) => path.relative(process.cwd(), p)),
  };

  if (opts.steps.feishuNotify && shouldNotify(opts.notifyOn, flowAllOk)) {
    await sendJobFeishuNotification(opts.feishuMode, {
      jobId: ctx.jobId,
      jobDescription: ctx.job?.description,
      trigger: ctx.trigger,
      testPassed,
      comparePassed,
      compareSkipped,
      feishuDocAttempted,
      feishuDocPassed,
      aborted,
      uiIssuesSummary: readUiIssuesSummaryLine(),
    });
  }

  const finalStatus: JobRunStatus = aborted ? 'aborted' : flowAllOk ? 'success' : 'failed';

  if (persist && ctx.jobId) {
    writeSummary(ctx.jobId, runId, summary);
    updateStatus(ctx, { status: finalStatus, finishedAt: new Date().toISOString() });
    clearLock(ctx.jobId);
  }

  console.log(`\n📊 任务结束：${finalStatus}`);

  return {
    exitCode: flowAllOk ? 0 : 1,
    testPassed,
    comparePassed,
    compareSkipped,
    aborted,
    feishuDocPassed,
    summary,
  };
}

export function stopJob(jobId: string): boolean {
  const lock = readLock(jobId);
  if (!lock) {
    console.log(`ℹ️  Job「${jobId}」无运行中进程`);
    return false;
  }
  if (!isProcessAlive(lock.pid)) {
    clearLock(jobId);
    console.log(`ℹ️  Job「${jobId}」锁存在但进程已退出，已清理锁`);
    return false;
  }
  try {
    process.kill(lock.pid, 'SIGTERM');
    console.log(`⏹️  已向 Job「${jobId}」发送 SIGTERM (pid=${lock.pid})`);
    return true;
  } catch (e) {
    console.error(`❌ 无法停止 Job「${jobId}」:`, e);
    return false;
  }
}
