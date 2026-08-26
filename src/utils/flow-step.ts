import path from 'path';
import type { Page } from '@playwright/test';
import { takeStepScreenshot, visualTest } from './screenshot.js';
import { flowScreenshotEnabled } from './flow-run-report.js';

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

export async function flowStep(name: string, fn: () => Promise<void>, opts?: FlowStepOpts): Promise<void> {
  console.log(`\n👉 ${name}`);
  const ctx = captureCtx;
  const capture = opts?.capture !== false && flowScreenshotEnabled() && Boolean(ctx?.runDir);
  const snap = opts?.snapshot || cleanLabel(name);
  const state = opts?.state || 'normal';
  const stepNum = opts?.step ?? (ctx ? ++ctx.stepCounter.n : 0);

  if (capture && ctx && state === 'before') {
    await shoot(ctx.page, ctx.runDir, stepNum, snap, 'before');
  }

  await fn();

  if (capture && ctx) {
    await shoot(ctx.page, ctx.runDir, stepNum, snap, state === 'before' ? 'after' : state);
  }
}
