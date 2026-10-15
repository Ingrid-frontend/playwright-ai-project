import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import { canSendFeishuNotify, sendFeishuNotify } from '../feishu/index.js';
import { writeBitableReport } from '../feishu/write-bitable-report.js';
import { beginJobRun, finalizeJobRun, type JobRunnerCtx } from './job-runner-kit.js';
import { runDir, type JobSummaryFile } from './job-lock.js';
import type { ResolvedTestJob } from './test-jobs-config.js';
import type { JobRunResult } from './job-runner.js';

const require = createRequire(import.meta.url);
const { readGoldenBatch, summarizeGoldenBatch } = require('../../pw-files/lib/golden-batch.js') as {
  readGoldenBatch: (repoRoot: string, flowId: string) => { finishedAt?: string } | null;
  summarizeGoldenBatch: (batch: unknown) => { headline?: string };
};

const FLOW_SCRIPTS: Record<string, string> = {
  'request-flow': 'request-flow:golden',
  'approval-flow': 'approval-flow:golden',
  'expense-flow': 'expense-flow:golden',
  'ap-request-flow': 'ap-request-flow:golden',
};

const ISSUES_REL = 'results/flow-ui-issues.json';

type FlowRow = {
  env: string;
  flow: string;
  exitCode: number;
  headline: string;
};

type EnvNote = {
  env: string;
  deliverExitCode: number | null;
  bitable: 'written' | 'skipped' | 'failed';
  bitableReason?: string;
};

function npmBin(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function issuesGeneratedAt(repoRoot: string): string {
  const file = path.join(repoRoot, ISSUES_REL);
  if (!fs.existsSync(file)) return '';
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as { generatedAt?: string };
    return String(data.generatedAt || '');
  } catch {
    return '';
  }
}

function batchHeadline(repoRoot: string, flowId: string, startedAt: number): string {
  const batch = readGoldenBatch(repoRoot, flowId);
  const finished = Date.parse(batch?.finishedAt || '');
  if (!batch || !Number.isFinite(finished) || finished < startedAt - 2000) return '未生成批次结果';
  return summarizeGoldenBatch(batch).headline || '未生成批次结果';
}

function runNpm(
  script: string,
  extra: string[],
  env: NodeJS.ProcessEnv,
  getChild: () => ChildProcess | null,
  setChild: (child: ChildProcess | null) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(npmBin(), ['run', script, '--', ...extra], {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });
    setChild(child);
    child.on('error', () => {
      setChild(null);
      resolve(1);
    });
    child.on('close', (code) => {
      if (getChild() === child) setChild(null);
      resolve(typeof code === 'number' ? code : 1);
    });
  });
}

function goldenEnv(envId: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, FLOW_PROMOTE_IF_CLEAN: '0', PLAYWRIGHT_ENV: envId };
  delete env.FLOW_UI_AUDIT_AFTER_GOLDEN;
  delete env.FLOW_UI_AUDIT_LIMIT;
  return env;
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function buildSummary(
  job: ResolvedTestJob,
  runId: string,
  trigger: string,
  rows: FlowRow[],
  notes: EnvNote[],
  aborted: boolean,
): JobSummaryFile & { rows: FlowRow[]; notes: EnvNote[] } {
  const hard = rows.filter((row) => row.exitCode === 1);
  const previewFailed = notes.filter((note) => note.deliverExitCode !== null && note.deliverExitCode !== 0);
  const passed = !aborted && hard.length === 0 && previewFailed.length === 0;
  const failReasons = [
    ...rows.filter((row) => row.exitCode !== 0).map((row) => `${row.env}/${row.flow}: ${row.headline}`),
    ...previewFailed.map((note) => `${note.env}: deliver:ready 退出码 ${note.deliverExitCode}`),
    ...notes
      .filter((note) => note.bitable === 'failed')
      .map((note) => `${note.env}: 多维表写入失败${note.bitableReason ? ` ${note.bitableReason}` : ''}`),
  ];
  return {
    jobId: job.id,
    runId,
    trigger,
    testPassed: passed,
    comparePassed: true,
    compareSkipped: true,
    aborted,
    totalSpecs: rows.length,
    executedCount: rows.length,
    successCount: rows.filter((row) => row.exitCode === 0).length,
    failCount: hard.length + previewFailed.length,
    projects: job.projects,
    specPaths: job.flows,
    failReasons,
    rows,
    notes,
  };
}

async function sendDigest(lines: string[]): Promise<void> {
  if (!lines.length) return;
  if (!canSendFeishuNotify()) {
    console.log('[golden-all-flows] 无飞书 chat id，跳过汇总通知');
    return;
  }
  try {
    const sent = await sendFeishuNotify({
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: '检测全部 有失败' },
          template: 'red',
        },
        elements: [
          {
            tag: 'div',
            text: { tag: 'lark_md', content: lines.join('\n') },
          },
        ],
      },
    });
    console.log(sent ? '[golden-all-flows] 汇总通知已发送' : '[golden-all-flows] 汇总通知发送失败');
  } catch (error) {
    console.log(
      '[golden-all-flows] 汇总通知发送失败',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function runGoldenAllFlows(
  job: ResolvedTestJob,
  ctx: JobRunnerCtx,
): Promise<JobRunResult> {
  dotenv.config();
  const repoRoot = process.cwd();
  const run = beginJobRun(job, ctx);
  const rows: FlowRow[] = [];
  const notes: EnvNote[] = [];
  let aborted = false;
  let child: ChildProcess | null = null;

  const onStop = () => {
    aborted = true;
    if (child?.pid) {
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch {
        /* 子进程已退出 */
      }
    }
  };
  process.on('SIGINT', onStop);
  process.on('SIGTERM', onStop);

  const flush = () => {
    const summary = buildSummary(job, run.runId, run.trigger, rows, notes, aborted);
    writeJson(path.join(runDir(job.id, run.runId), 'summary.json'), summary);
    return summary;
  };

  try {
    for (const envId of job.envs) {
      if (aborted) break;
      const beforeIssues = issuesGeneratedAt(repoRoot);
      console.log(`\n[golden-all-flows] 环境 ${envId}`);
      for (const flowId of job.flows) {
        if (aborted) break;
        const script = FLOW_SCRIPTS[flowId];
        const startedAt = Date.now();
        console.log(`[golden-all-flows] ${envId} · ${flowId}`);
        const exitCode = script
          ? await runNpm(script, [`--env=${envId}`], goldenEnv(envId), () => child, (next) => {
              child = next;
            })
          : 1;
        if (aborted) break;
        const headline = script ? batchHeadline(repoRoot, flowId, startedAt) : '未知流程';
        rows.push({
          env: envId,
          flow: flowId,
          exitCode,
          headline,
        });
        flush();
        if (/503/.test(headline)) {
          console.log(`[golden-all-flows] ${envId} 返回 503，跳过该环境剩余流程`);
          break;
        }
      }
      if (aborted) break;

      const envRows = rows.filter((row) => row.env === envId);
      let deliverExitCode: number | null = null;
      if (envRows.some((row) => row.exitCode === 0)) {
        console.log(`[golden-all-flows] deliver:ready --env=${envId}`);
        deliverExitCode = await runNpm('deliver:ready', [`--env=${envId}`], { ...process.env }, () => child, (next) => {
          child = next;
        });
      }
      if (aborted) {
        notes.push({ env: envId, deliverExitCode, bitable: 'skipped', bitableReason: '已中断' });
        flush();
        break;
      }

      let bitable: EnvNote['bitable'] = 'skipped';
      let bitableReason = '';
      const afterIssues = issuesGeneratedAt(repoRoot);
      if (!afterIssues || afterIssues === beforeIssues) {
        bitableReason = '本次没有新的对比报告';
      } else {
        const summaryFile = path.join(runDir(job.id, run.runId), `${envId}-summary.json`);
        const hard = envRows.some((row) => row.exitCode === 1) || (deliverExitCode !== null && deliverExitCode !== 0);
        const envSummary: JobSummaryFile = {
          jobId: job.id,
          runId: run.runId,
          trigger: run.trigger,
          testPassed: !hard && envRows.some((row) => row.exitCode === 0),
          comparePassed: true,
          compareSkipped: false,
          aborted: false,
          totalSpecs: envRows.length,
          executedCount: envRows.length,
          successCount: envRows.filter((row) => row.exitCode === 0).length,
          failCount: envRows.filter((row) => row.exitCode === 1).length,
          projects: job.projects,
          specPaths: envRows.map((row) => row.flow),
          failReasons: envRows.filter((row) => row.exitCode !== 0).map((row) => `${row.flow}: ${row.headline}`),
        };
        writeJson(summaryFile, envSummary);
        try {
          const result = await writeBitableReport({
            summary: envSummary,
            env: envId,
            status: envSummary.testPassed ? 'success' : 'failed',
            issuesSource: path.join(repoRoot, ISSUES_REL),
          });
          if (result.skipped) {
            bitableReason = result.reason || '已跳过';
          } else {
            bitable = 'written';
          }
        } catch (error) {
          bitable = 'failed';
          bitableReason = error instanceof Error ? error.message : String(error);
        }
      }
      notes.push({ env: envId, deliverExitCode, bitable, bitableReason: bitableReason || undefined });
      flush();
    }
  } finally {
    process.off('SIGINT', onStop);
    process.off('SIGTERM', onStop);
  }

  const summary = flush();
  const previewFailed = notes.some((note) => note.deliverExitCode !== null && note.deliverExitCode !== 0);
  const hard = rows.some((row) => row.exitCode === 1) || previewFailed;
  const exitCode = aborted || hard ? 1 : 0;
  if (hard) {
    const lines = [
      ...rows
        .filter((row) => row.exitCode === 1)
        .map((row) => `失败 ${row.env} / ${row.flow}：${row.headline}`),
      ...rows
        .filter((row) => row.exitCode === 2)
        .map((row) => `跳过 ${row.env} / ${row.flow}：${row.headline}`),
      ...notes
        .filter((note) => note.deliverExitCode !== null && note.deliverExitCode !== 0)
        .map((note) => `预览失败 ${note.env}：deliver:ready 退出码 ${note.deliverExitCode}`),
    ];
    await sendDigest(lines);
  }

  finalizeJobRun(job, run, summary, aborted ? 'aborted' : exitCode === 0 ? 'success' : 'failed');
  writeJson(path.join(runDir(job.id, run.runId), 'summary.json'), summary);

  return {
    exitCode,
    testPassed: exitCode === 0,
    comparePassed: true,
    compareSkipped: true,
    aborted,
    feishuDocPassed: true,
    summary,
  };
}
