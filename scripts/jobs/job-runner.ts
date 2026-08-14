import fs from 'fs';
import path from 'path';
import type { NotifyOn, ResolvedTestJob } from './test-jobs-config.js';
import { resolveJob, resolveJobRunEnv } from './test-jobs-config.js';
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
import { readUiIssuesSummaryLine, sendJobFeishuNotification, readUiIssuesSummaryCounts, buildJobFailReasons } from './job-notify.js';
import { getAnalyzeErrorsSummary, runAnalyzeErrorsOnFailure } from '../flow/flow-shared.js';
import { writeBitableReport } from '../feishu/write-bitable-report.js';
import {
  formatRunId,
  isProcessAlive,
  projectToBrowser,
  recordLastGreenForScript,
  resolveSpecEntries,
  resolveSpecEntriesFromRelatives,
  groupSpecEntriesByProfile,
  summarizeSpecProfileCounts,
  scriptKeyFromOptimizedPath,
  countResolvedSpecs,
  type AccountProfileFilter,
} from './job-utils.js';
import { assertSpecEnvMatch, listKnownEnvs } from '../../src/utils/test-env-path.js';
import { executeTests, runCommandBool, type DirectRunOptions } from './job-runner-execute.js';

export type { DirectRunOptions } from './job-runner-execute.js';

export type JobRunContext = {
  jobId?: string;
  job?: ResolvedTestJob;
  trigger: 'manual' | 'schedule' | 'cli' | 'run-optimized-tests';
  runId: string;
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

export async function runJobById(
  jobId: string,
  ctxPartial: Omit<JobRunContext, 'jobId' | 'job' | 'runId'> & {
    runId?: string;
    /** 覆盖 config 中的 playwrightEnv，仅执行该环境下的用例 */
    playwrightEnv?: string;
    /** 覆盖 config 中的 accountProfile，仅执行该档案的用例 */
    accountProfile?: AccountProfileFilter;
    /** 覆盖 config 中的 specs glob，仅执行指定相对路径用例 */
    specOverrides?: string[];
  },
): Promise<JobRunResult> {
  const job = resolveJob(jobId);
  if (!job.enabled && !ctxPartial.force) {
    throw new Error(`Job「${jobId}」已禁用（enabled: false）`);
  }

  const effectiveEnv = resolveJobRunEnv(job, ctxPartial.playwrightEnv);
  const effectiveProfile = ctxPartial.accountProfile ?? job.accountProfile ?? null;

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
      playwrightEnv: effectiveEnv,
      accountProfile: effectiveProfile,
      steps: job.steps,
      feishuMode: job.feishuMode,
      notifyOn: job.notifyOn,
      alwaysCreateFeishuDoc: job.steps.createFeishuDoc,
      specOverrides: ctxPartial.specOverrides,
      retryOnFail: Number(process.env.RETRY_ON_FAIL || '0') || 0,
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

  const runtimeEnv = opts.playwrightEnv || process.env.PLAYWRIGHT_ENV || 'stage';
  if (ctx.jobId && ctx.job && opts.playwrightEnv && opts.playwrightEnv !== ctx.job.playwrightEnv) {
    console.log(`ℹ️  运行环境 ${runtimeEnv}（Job 配置默认: ${ctx.job.playwrightEnv}）\n`);
  }

  const absOptimizedDir = path.resolve(process.cwd(), opts.optimizedDir);
  if (!fs.existsSync(absOptimizedDir) || !fs.statSync(absOptimizedDir).isDirectory()) {
    throw new Error(`优化测试目录不存在或不是目录: ${absOptimizedDir}`);
  }

  const specEntries = opts.specOverrides?.length
    ? resolveSpecEntriesFromRelatives(
        opts.specOverrides,
        opts.optimizedDir,
        opts.playwrightEnv,
        opts.accountProfile,
      )
    : resolveSpecEntries(opts.specs, opts.optimizedDir, opts.playwrightEnv, opts.accountProfile);
  if (specEntries.length === 0) {
    const envLabel = opts.playwrightEnv || process.env.PLAYWRIGHT_ENV || 'stage';
    const profileLabel =
      opts.accountProfile && opts.accountProfile !== 'all'
        ? ` accountProfile=${JSON.stringify(opts.accountProfile)}`
        : '';
    const specHint = opts.specOverrides?.length
      ? `指定用例无效或不存在: ${JSON.stringify(opts.specOverrides)}（环境 ${envLabel}${profileLabel}）`
      : opts.specs === 'all'
        ? `tests/optimized/${envLabel}/ 下无正式用例（已排除 studio-auto）${profileLabel}`
        : `未匹配 specs: ${JSON.stringify(opts.specs)}（环境 ${envLabel}${profileLabel}）`;
    console.error(`❌ ${specHint}`);
    if (opts.specs !== 'all' && !opts.specOverrides?.length) {
      console.error(
        `💡 可在 Studio 定时任务中勾选「选用例」，或 CLI 加 --spec=tests/optimized/${envLabel}/.../*.optimized.spec.ts`,
      );
    }
    if (opts.specs !== 'all') {
      const others = listKnownEnvs()
        .filter((e: string) => e !== envLabel)
        .map((e: string) => ({ env: e, count: countResolvedSpecs(opts.specs, opts.optimizedDir, e) }))
        .filter((x: { env: string; count: number }) => x.count > 0);
      if (others.length) {
        console.error(
          `💡 其它环境有匹配: ${others.map((o: { env: string; count: number }) => `${o.env}(${o.count})`).join(', ')}，可执行 npm run test-job -- run --id=${jobId} --env=<env>`,
        );
      }
    }
    const emptySummary: JobSummaryFile = {
      jobId,
      runId,
      trigger: ctx.trigger,
      testPassed: false,
      comparePassed: false,
      compareSkipped: true,
      aborted: false,
      totalSpecs: 0,
      executedCount: 0,
      successCount: 0,
      failCount: 0,
      projects: opts.projects,
      specPaths: [],
      failReasons: ['未匹配到可执行用例'],
    };
    if (persist && ctx.jobId) {
      writeSummary(ctx.jobId, runId, emptySummary);
      updateStatus(ctx, { status: 'failed', finishedAt: new Date().toISOString() });
      clearLock(ctx.jobId);
    }
    return {
      exitCode: 1,
      testPassed: false,
      comparePassed: false,
      compareSkipped: true,
      aborted: false,
      feishuDocPassed: false,
      summary: emptySummary,
    };
  }

  const profileCounts = summarizeSpecProfileCounts(specEntries);
  const groupCount = groupSpecEntriesByProfile(specEntries).length;
  console.log(
    `📋 找到 ${specEntries.length} 个测试文件（PLAYWRIGHT_ENV=${runtimeEnv}${opts.accountProfile ? `, accountProfile=${JSON.stringify(opts.accountProfile)}` : ''}）`,
  );
  if (groupCount > 1) {
    console.log(
      `👥 将按 ${groupCount} 个账号档案分组执行: ${Object.entries(profileCounts)
        .map(([p, n]) => `${p}(${n})`)
        .join(', ')}\n`,
    );
  } else {
    console.log('');
  }
  for (const entry of specEntries) {
    assertSpecEnvMatch(entry.relPath, runtimeEnv);
  }

  const { totalSuccessCount, totalFailCount, aborted, executedSpecPaths } = await executeTests(
    opts,
    specEntries,
  );

  const testPassed = totalFailCount === 0 && !aborted;
  if (!testPassed) {
    runAnalyzeErrorsOnFailure();
  }
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

  const uiIssues = readUiIssuesSummaryCounts();
  const failReasons = buildJobFailReasons({
    testPassed,
    comparePassed,
    compareSkipped,
    aborted,
    failCount: totalFailCount,
    executedCount: totalSuccessCount + totalFailCount,
    compareGate: opts.steps.compareGate,
    feishuDocPassed,
    feishuDocAttempted,
    uiIssuesBlocker: uiIssues?.blocker,
  });

  const summary: JobSummaryFile = {
    jobId,
    runId,
    trigger: ctx.trigger,
    testPassed,
    comparePassed,
    compareSkipped,
    aborted,
    totalSpecs: specEntries.length,
    executedCount: totalSuccessCount + totalFailCount,
    successCount: totalSuccessCount,
    failCount: totalFailCount,
    projects: opts.projects,
    specPaths: specEntries.map(e => e.relPath),
    compareGate: opts.steps.compareGate,
    feishuDocAttempted,
    feishuDocPassed,
    uiIssuesBlocker: uiIssues?.blocker,
    uiIssuesWarning: uiIssues?.warning,
    failReasons,
  };

  if (opts.steps.writeFeishuBitable) {
    try {
      const finalStatus: JobRunStatus = aborted ? 'aborted' : flowAllOk ? 'success' : 'failed';
      await writeBitableReport({ summary, env: runtimeEnv, status: finalStatus });
    } catch (error) {
      console.log('⚠️  飞书多维表写入失败（不影响任务流程）:', error instanceof Error ? error.message : String(error));
    }
  }

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
      errorSummary: testPassed ? undefined : getAnalyzeErrorsSummary(),
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
