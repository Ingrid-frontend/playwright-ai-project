import path from 'path';
import type { Page } from '@playwright/test';
import { takeStepScreenshot, visualTest } from '../../src/utils/screenshot';

export type StepCaptureCtx = {
  page: Page;
  runDir: string;
  stepCounter: { n: number };
};

export type StepState = 'normal' | 'after' | 'before' | 'skipped';

export type StepOpts = {
  snapshot?: string;
  state?: StepState;
  capture?: boolean;
  step?: number;
};

let captureCtx: StepCaptureCtx | null = null;

export function bindStepCapture(
  ctx: { page: Page; runDir: string; stepCounter?: { n: number } },
): void {
  captureCtx = {
    page: ctx.page,
    runDir: ctx.runDir,
    stepCounter: ctx.stepCounter ?? { n: 0 },
  };
}

export function unbindStepCapture(): void {
  captureCtx = null;
}

export function regressionScreenshotEnabled(): boolean {
  const mode = (process.env.RUN_MODE || process.env.PLAYWRIGHT_RUN_MODE || 'regression').toLowerCase();
  if (mode === 'smoke') return false;
  const capture = (process.env.SCREENSHOT_CAPTURE || '1').toLowerCase();
  return capture !== '0' && capture !== 'false' && capture !== 'no';
}

function screenshotTiming(): 'both' | 'after-only' {
  const v = (process.env.OPTIMIZE_SCREENSHOT || process.env.SCREENSHOT_TIMING || 'both').toLowerCase();
  return v === 'after-only' ? 'after-only' : 'both';
}

function cleanLabel(label: string): string {
  return label.replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 80) || 'step';
}

async function shoot(
  page: Page,
  runDir: string,
  stepNum: number,
  label: string,
  snapshot: string,
  state: StepState,
): Promise<void> {
  if (state === 'before') {
    const filePath = path.join(runDir, `step-${stepNum}-${snapshot}-before.png`);
    await takeStepScreenshot(page, filePath, {
      mode: 'fast',
      snapshotName: snapshot,
      state,
    });
    return;
  }
  if (state === 'skipped') {
    const filePath = path.join(runDir, `step-${stepNum}-${snapshot}-skipped.png`);
    await takeStepScreenshot(page, filePath, {
      mode: 'stable',
      snapshotName: snapshot,
      state,
    });
    return;
  }
  await visualTest(page, {
    dir: runDir,
    name: snapshot,
    state,
    step: stepNum,
  });
}

export async function captureStepState(
  state: 'skipped',
  label?: string,
  snapshot?: string,
): Promise<void> {
  const ctx = captureCtx;
  if (!ctx || !regressionScreenshotEnabled()) return;
  const stepNum = ctx.stepCounter.n;
  const snap = snapshot || cleanLabel(label || 'step');
  await shoot(ctx.page, ctx.runDir, stepNum, label || snap, snap, state);
}

export async function step(name: string, fn: () => Promise<void>, opts?: StepOpts): Promise<void> {
  console.log(`\n👉 ${name}`);
  const ctx = captureCtx;
  const shouldCapture = opts?.capture ?? regressionScreenshotEnabled();
  const state = opts?.state ?? 'after';
  const snapshot = opts?.snapshot || cleanLabel(name);
  const stepNum = opts?.step ?? (ctx ? ++ctx.stepCounter.n : 0);

  if (shouldCapture && ctx && state !== 'normal' && screenshotTiming() === 'both') {
    await shoot(ctx.page, ctx.runDir, stepNum, name, snapshot, 'before');
  }

  try {
    await fn();
    console.log(`✅ ${name} 完成`);
    if (shouldCapture && ctx) {
      await shoot(ctx.page, ctx.runDir, stepNum, name, snapshot, state);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`❌ ${name} 失败: ${msg}`);
    throw error;
  }
}
