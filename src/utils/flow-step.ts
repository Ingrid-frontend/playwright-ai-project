import path from 'path';
import type { Page } from '@playwright/test';
import { takeStepScreenshot, visualTest } from './screenshot.js';
import { flowScreenshotEnabled, readFlowRunProgress, writeFlowRunProgress, type FlowId } from './flow-run-report.js';

export type FlowStepCtx = {
  page: Page;
  runDir: string;
  stepCounter: { n: number };
};

export type FlowStepState = 'normal' | 'after' | 'before' | 'skipped';

export type FlowStepOpts = {
  snapshot?: string;
  state?: FlowStepState;
  capture?: boolean;
  step?: number;
};

let captureCtx: FlowStepCtx | null = null;

export function bindFlowStepCapture(ctx: { page: Page; runDir: string; stepCounter?: { n: number } }): void {
  captureCtx = {
    page: ctx.page,
    runDir: ctx.runDir,
    stepCounter: ctx.stepCounter ?? { n: 0 },
  };
}

export function unbindFlowStepCapture(): void {
  captureCtx = null;
}

function cleanLabel(label: string): string {
  return label.replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 80) || 'step';
}

async function shoot(
  page: Page,
  runDir: string,
  stepNum: number,
  snapshot: string,
  state: FlowStepState,
): Promise<void> {
  if (state === 'before') {
    const filePath = path.join(runDir, `step-${stepNum}-${snapshot}-before.png`);
    await takeStepScreenshot(page, filePath, { mode: 'fast', snapshotName: snapshot, state });
    return;
  }
  if (state === 'skipped') {
    const filePath = path.join(runDir, `step-${stepNum}-${snapshot}-skipped.png`);
    await takeStepScreenshot(page, filePath, { mode: 'stable', snapshotName: snapshot, state });
    return;
  }
  await visualTest(page, { dir: runDir, name: snapshot, state, step: stepNum });
}

function resolveFlowId(): FlowId | undefined {
  const raw = process.env.FLOW_ID?.trim();
  return raw === 'request-flow' || raw === 'approval-flow' ? raw : undefined;
}

function markStepStart(ctx: FlowStepCtx, stepNum: number, name: string, snap: string, page: Page): void {
  const runId = process.env.FLOW_RUN_ID?.trim();
  if (!runId) return;
  const prev = readFlowRunProgress(ctx.runDir, resolveFlowId(), runId);
  writeFlowRunProgress(ctx.runDir, {
    runId,
    flowId: resolveFlowId(),
    status: 'running',
    currentStep: { num: stepNum, name, snapshot: snap, startedAt: new Date().toISOString() },
    completedSteps: prev?.completedSteps || [],
    pageUrl: page.url(),
    error: undefined,
    updatedAt: new Date().toISOString(),
  });
}

function markStepDone(ctx: FlowStepCtx, stepNum: number, name: string, snap: string): void {
  const runId = process.env.FLOW_RUN_ID?.trim();
  if (!runId) return;
  const finishedAt = new Date().toISOString();
  const prev = readFlowRunProgress(ctx.runDir, resolveFlowId(), runId);
  const done = { num: stepNum, name, snapshot: snap, startedAt: finishedAt, finishedAt };
  writeFlowRunProgress(ctx.runDir, {
    runId,
    flowId: resolveFlowId(),
    status: 'running',
    currentStep: undefined,
    completedSteps: [...(prev?.completedSteps || []), done],
    updatedAt: finishedAt,
  });
}

function markStepFailed(
  ctx: FlowStepCtx,
  stepNum: number,
  name: string,
  snap: string,
  page: Page,
  err: unknown,
): void {
  const runId = process.env.FLOW_RUN_ID?.trim();
  if (!runId) return;
  const msg = err instanceof Error ? err.message : String(err);
  writeFlowRunProgress(ctx.runDir, {
    runId,
    flowId: resolveFlowId(),
    status: 'failed',
    currentStep: { num: stepNum, name, snapshot: snap, startedAt: new Date().toISOString() },
    completedSteps: readFlowRunProgress(ctx.runDir, resolveFlowId(), runId)?.completedSteps || [],
    pageUrl: page.url(),
    error: msg,
    updatedAt: new Date().toISOString(),
  });
}

export async function flowStep(name: string, fn: () => Promise<void>, opts?: FlowStepOpts): Promise<void> {
  console.log(`\n👉 ${name}`);
  const ctx = captureCtx;
  const capture = opts?.capture !== false && flowScreenshotEnabled() && Boolean(ctx?.runDir);
  const snap = opts?.snapshot || cleanLabel(name);
  const state = opts?.state || 'normal';
  const stepNum = opts?.step ?? (ctx ? ++ctx.stepCounter.n : 0);

  if (ctx?.runDir) {
    markStepStart(ctx, stepNum, name, snap, ctx.page);
  }

  if (capture && ctx && state === 'before') {
    await shoot(ctx.page, ctx.runDir, stepNum, snap, 'before');
  }

  try {
    await fn();
  } catch (err) {
    if (ctx?.runDir) {
      markStepFailed(ctx, stepNum, name, snap, ctx.page, err);
      if (capture) {
        const stuckPath = path.join(ctx.runDir, `step-${stepNum}-${snap}-stuck.png`);
        await takeStepScreenshot(ctx.page, stuckPath, {
          mode: 'fast',
          snapshotName: snap,
          state: 'normal',
        }).catch(() => undefined);
      }
    }
    throw err;
  }

  if (ctx?.runDir) {
    markStepDone(ctx, stepNum, name, snap);
  }

  if (capture && ctx) {
    await shoot(ctx.page, ctx.runDir, stepNum, snap, state === 'before' ? 'after' : state);
  }
}
