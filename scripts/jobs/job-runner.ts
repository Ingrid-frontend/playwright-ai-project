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
import { sendJobFeishuNotification, buildJobFailReasons } from './job-notify.js';
import { getAnalyzeErrorsSummary, runAnalyzeErrorsOnFailure } from '../flow/flow-shared.js';
import { writeBitableIfAuto } from '../feishu/bitable-auto.js';
import { readIssuesReport } from '../report/issues-source.js';
import { writeQualityDashboard } from '../report/generate-quality-dashboard.js';
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
import { runFlowJob } from './job-runner-flow.js';
import { runCatalogDriftJob } from './job-runner-catalog.js';
import { runSmokePatrolJob } from './job-runner-smoke.js';
import { runIntentBatchJob } from './job-runner-intent-batch.js';
import { FLOW_RUNNER_SCRIPTS } from './flow-runner-registry.js';
import type { JobRunnerCtx } from './job-runner-kit.js';
import { listReportEnvs } from '../feishu/deliver-ready.js';

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

/**
 * Job runner 分发表：runner 名 → handler。
 * 新增 job 类型 = 新 handler 文件 + registerJobRunner 一行 + test-jobs.json 一条，分发处零改动。
 * flow runner（<flowId>-golden / <flowId>-write）由 flow-registry 派生批量注册，
 * config/flows.json 新流程自动进入本表。
 */
export type JobRunnerHandler = (job: ResolvedTestJob, ctx: JobRunnerCtx) => Promise<JobRunResult>;

const JOB_RUNNER_HANDLERS: Record<string, JobRunnerHandler> = {};

export function registerJobRunner(runner: string, handler: JobRunnerHandler): void {
  JOB_RUNNER_HANDLERS[runner] = handler;
}

registerJobRunner('catalog-drift-check', runCatalogDriftJob);
registerJobRunner('ai-smoke-patrol', runSmokePatrolJob);
registerJobRunner('intent-batch', runIntentBatchJob);
for (const flowRunnerKey of Object.keys(FLOW_RUNNER_SCRIPTS)) {
  registerJobRunner(flowRunnerKey, (job, ctx) => runFlowJob(job, ctx));
}

export function listJobRunnerKeys(): string[] {
  return Object.keys(JOB_RUNNER_HANDLERS).sort();
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

  // 显式分发表：catalog/smoke/intent-batch 与全部 flow runner；未注册 runner 走 runDirect（optimized 用例直接执行）
  const handler = JOB_RUNNER_HANDLERS[job.runner || ''] ?? JOB_RUNNER_HANDLERS[job.id || ''];
  if (handler) {
    return handler(job, {
      ...ctxPartial,
      playwrightEnv: effectiveEnv,
      accountProfile: effectiveProfile,
    });
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
    if (opts.steps.writeFeishuBitable) {
      console.log('跳过飞书多维表同步：未匹配到可执行用例，本轮无比较产物');
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
  let feishuDocPassed = true;
  let feishuDocAttempted = false;

  const skipCompare = aborted && !opts.runCompareAfterAbort;
  const compareSkipped = !opts.steps.compare || skipCompare;
  const issuesSource = path.resolve(process.cwd(), process.env.UI_ISSUES_OUT || 'results/ui-issues.json');
  let currentIssues: ReturnType<typeof readIssuesReport> = null;
  if (!compareSkipped) {
    const previousGeneratedAt = readIssuesReport(issuesSource)?.generatedAt;
    const compareStartedAt = Date.now();
    const compareCmd = opts.steps.compareGate
      ? 'npm run compare-screenshots -- --gate'
      : 'npm run compare-screenshots';
    comparePassed = runCommandBool(compareCmd, '生成截图对比报告', {
      ...process.env,
      PLAYWRIGHT_ENV: runtimeEnv,
    });
    const report = readIssuesReport(issuesSource);
    // gate 失败仍可能有本轮产物；成功退出也可能因无截图而未产出，不能只看退出码。
    if (report?.summary && Array.isArray(report.issues)
      && report.generatedAt !== previousGeneratedAt
      && Date.parse(report.generatedAt) >= compareStartedAt
      && Date.parse(report.generatedAt) <= Date.now()) {
      currentIssues = report;
    } else {
      comparePassed = false;
      console.log('本轮截图对比未生成有效 issues，比较标记为失败（不复用历史报告）');
    }
  } else if (skipCompare) {
    console.log('\n⏭️  执行已中断且 runCompareAfterAbort=false，跳过截图对比');
  }

  if (opts.steps.compare && !skipCompare) {
    if (opts.steps.deliveryPreview && runtimeEnv && runtimeEnv !== 'all') {
      runCommandBool(`npm run deliver:ready -- --env=${runtimeEnv}`, '生成交付预览包');
    } else if (opts.steps.deliveryPreview && runtimeEnv === 'all') {
      for (const envId of listReportEnvs()) {
        runCommandBool(`npm run deliver:ready -- --env=${envId}`, `交付预览 (${envId})`);
      }
    } else {
      runCommandBool('npm run report:customer -- --reuse-compare', '生成客户版验收报告');
      if (opts.steps.feishuNotify) {
        runCommandBool('npm run feishu:customer-notify', '客户版飞书通知（周报/提醒）');
      }
    }
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

  const issueSummary = currentIssues?.summary;
  const uiIssues = issueSummary ? {
    blocker: issueSummary.comparisonBlocker ?? issueSummary.blocker ?? 0,
    warning: issueSummary.comparisonWarning ?? issueSummary.warning ?? 0,
    total: issueSummary.comparisonTotal ?? issueSummary.total ?? 0,
    review: issueSummary.review,
  } : undefined;
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
    if (!currentIssues) {
      console.log(`跳过飞书多维表同步：${compareSkipped ? '本轮未执行截图对比' : '本轮对比未生成有效新产物'}，不使用历史 issues`);
    } else {
      try {
        const finalStatus: JobRunStatus = aborted ? 'aborted' : flowAllOk ? 'success' : 'failed';
        await writeBitableIfAuto({ summary, env: runtimeEnv, status: finalStatus, issuesSource });
      } catch (error) {
        console.log('飞书多维表写入失败（不影响任务流程）:', error instanceof Error ? error.message : String(error));
      }
    }
  }

  if (opts.steps.compare && !compareSkipped) {
    try {
      const dash = writeQualityDashboard();
      console.log(`📈 质量看板: ${dash}`);
    } catch (error) {
      console.log('⚠️  质量看板生成失败（不影响任务流程）:', error instanceof Error ? error.message : String(error));
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
      uiIssuesSummary: uiIssues
        ? `**界面差异**：严重 ${uiIssues.blocker} 项 · 轻微 ${uiIssues.warning} 项 · 共 ${uiIssues.total} 项`
          + (uiIssues.review && uiIssues.review.reviewed > 0
            ? `\n**UI 判定**：疑似问题 ${uiIssues.review.uiBug} · 需人工 ${uiIssues.review.needsHuman} · 不稳定 ${uiIssues.review.unstable} · 噪声 ${uiIssues.review.likelyNoise}`
            : '')
        : undefined,
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
