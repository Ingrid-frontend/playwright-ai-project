import fs from 'fs';
import path from 'path';
import type { AiTestRunResult, AiTestStepResult } from './execute-ai-test.js';
import type { SemanticAction } from '../types/ai-test-plan.js';

export const FAILURE_BUNDLE_VERSION = 1 as const;

export type FailureBundleKind = 'intent' | 'nl-run' | 'playwright-script';

export interface HealLogEntry {
  stepId: string;
  attempt: number;
  engine: 'pw' | 'ego';
  at: string;
  error: string;
  output?: Record<string, unknown>;
  accepted?: boolean;
  execError?: string;
}

export interface FailureBundleStep {
  id: string;
  passed: boolean;
  skipped?: boolean;
  healed?: boolean;
  attempts?: number;
  error?: string;
  screenshotRel?: string;
  actionType?: string;
}

export interface FailureBundleArtifacts {
  resultJson: string;
  replayRel?: string;
  videoRel?: string;
  screenshotDir?: string;
  screenshots: string[];
  stdoutLog?: string;
  healDir?: string;
}

export interface FailureBundle {
  version: typeof FAILURE_BUNDLE_VERSION;
  generatedAt: string;
  kind: FailureBundleKind;
  passed: false;
  engine?: 'ego' | 'pw';
  env?: string;
  profile?: string;
  planName?: string;
  intentPath?: string;
  outputDir: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  failedStep?: { id: string; error?: string; actionType?: string };
  steps: FailureBundleStep[];
  healLogs: HealLogEntry[];
  artifacts: FailureBundleArtifacts;
}

export type FailureBundleWriteResult = {
  bundleRel: string;
  summaryRel: string;
  healDir?: string;
};

function toRepoRel(abs: string, cwd = process.cwd()): string | undefined {
  const rel = path.relative(cwd, abs).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return undefined;
  return rel;
}

function toArtifactPath(abs: string, cwd = process.cwd()): string {
  return toRepoRel(abs, cwd) || path.resolve(abs).replace(/\\/g, '/');
}

function actionTypeOf(action: SemanticAction | undefined): string | undefined {
  return action?.type;
}

function mapSteps(steps: AiTestStepResult[]): FailureBundleStep[] {
  return steps.map((step) => ({
    id: step.id,
    passed: step.passed,
    skipped: step.skipped,
    healed: step.healed,
    attempts: step.attempts,
    error: step.error,
    screenshotRel: step.screenshot ? toArtifactPath(path.resolve(step.screenshot)) : undefined,
    actionType: actionTypeOf(step.action),
  }));
}

function findFailedStep(steps: AiTestStepResult[]): FailureBundle['failedStep'] | undefined {
  const hit = [...steps].reverse().find((s) => !s.passed && !s.skipped);
  if (!hit) return undefined;
  return {
    id: hit.id,
    error: hit.error,
    actionType: actionTypeOf(hit.action),
  };
}

export function collectKeyScreenshots(steps: AiTestStepResult[]): string[] {
  const rels: string[] = [];
  const seen = new Set<string>();
  const add = (shot?: string) => {
    if (!shot) return;
    const rel = toArtifactPath(path.resolve(shot));
    if (seen.has(rel)) return;
    seen.add(rel);
    rels.push(rel);
  };

  const failedIdx = steps.findIndex((s) => !s.passed && !s.skipped);
  if (failedIdx >= 0) {
    for (let i = failedIdx; i >= 0; i -= 1) {
      if (steps[i].passed && steps[i].screenshot) {
        add(steps[i].screenshot);
        break;
      }
    }
    add(steps[failedIdx].screenshot);
  } else {
    const last = steps[steps.length - 1];
    add(last?.screenshot);
  }
  return rels;
}

function trimMessage(msg: string | undefined, maxLines = 12): string {
  if (!msg) return '';
  return msg
    .split('\n')
    .slice(0, maxLines)
    .join('\n')
    .trim();
}

export function formatFailureSummaryMarkdown(bundle: FailureBundle): string {
  const lines = [
    `## 执行失败排查包`,
    '',
    `- 时间: ${bundle.generatedAt}`,
    `- 类型: ${bundle.kind}`,
    `- 引擎: ${bundle.engine || '—'}`,
    `- 环境: ${bundle.env || '—'}`,
    `- 用例: ${bundle.planName || bundle.intentPath || '—'}`,
    `- 输出目录: \`${bundle.outputDir}\``,
  ];
  if (bundle.startedAt) lines.push(`- 开始: ${bundle.startedAt}`);
  if (bundle.finishedAt) lines.push(`- 结束: ${bundle.finishedAt}`);
  if (bundle.error) lines.push(`- 总错误: ${trimMessage(bundle.error, 4)}`);
  lines.push('');

  if (bundle.failedStep) {
    lines.push(
      `### 失败步骤: ${bundle.failedStep.id}`,
      `- 动作: ${bundle.failedStep.actionType || '—'}`,
      bundle.failedStep.error ? `- 错误:\n\`\`\`\n${trimMessage(bundle.failedStep.error, 10)}\n\`\`\`` : '',
      '',
    );
  }

  const failedSteps = bundle.steps.filter((s) => !s.passed && !s.skipped);
  if (failedSteps.length > 1) {
    lines.push('### 其他失败步骤');
    for (const step of failedSteps.slice(0, 8)) {
      lines.push(`- ${step.id}${step.error ? `: ${trimMessage(step.error, 2).replace(/\n/g, ' ')}` : ''}`);
    }
    lines.push('');
  }

  if (bundle.healLogs.length) {
    lines.push('### 自愈记录');
    for (const log of bundle.healLogs.slice(0, 6)) {
      const mark = log.accepted ? '已采纳' : log.execError ? '执行失败' : '未采纳';
      lines.push(`- ${log.stepId} · 第 ${log.attempt} 次 · ${mark}`);
    }
    lines.push('');
  }

  lines.push('### 产物');
  lines.push(`- result.json: \`${bundle.artifacts.resultJson}\``);
  if (bundle.artifacts.replayRel) lines.push(`- 流程回放: \`${bundle.artifacts.replayRel}\``);
  if (bundle.artifacts.videoRel) lines.push(`- 录像: \`${bundle.artifacts.videoRel}\``);
  if (bundle.artifacts.screenshotDir) lines.push(`- 截图目录: \`${bundle.artifacts.screenshotDir}\``);
  for (const shot of bundle.artifacts.screenshots) {
    lines.push(`- 关键截图: \`${shot}\``);
  }
  if (bundle.artifacts.stdoutLog) lines.push(`- 日志: \`${bundle.artifacts.stdoutLog}\``);
  if (bundle.artifacts.healDir) lines.push(`- 自愈日志: \`${bundle.artifacts.healDir}/\``);

  lines.push('', '### 建议下一步', '- 根据失败步骤与截图调整 Intent YAML 或选择器', '- 将本文粘贴给 AI 时附带 YAML 片段与 heal 日志');
  return lines.filter((line) => line !== undefined).join('\n');
}

export function buildFailureBundle(opts: {
  kind: FailureBundleKind;
  outputDir: string;
  result: AiTestRunResult & { engine?: 'ego' | 'pw'; intentPath?: string; env?: string; profile?: string; planName?: string };
  healLogs?: HealLogEntry[];
  stdoutLogRel?: string;
}): FailureBundle {
  const outputDir = path.resolve(opts.outputDir);
  const outRel = toRepoRel(outputDir) || outputDir.replace(/\\/g, '/');
  const steps = opts.result.steps || [];
  const screenshotDirRel = opts.result.screenshotDir
    ? toRepoRel(path.resolve(opts.result.screenshotDir))
    : undefined;

  return {
    version: FAILURE_BUNDLE_VERSION,
    generatedAt: new Date().toISOString(),
    kind: opts.kind,
    passed: false,
    engine: opts.result.engine,
    env: opts.env,
    profile: opts.profile,
    planName: opts.result.planName,
    intentPath: opts.result.intentPath,
    outputDir: outRel,
    startedAt: opts.result.startedAt,
    finishedAt: opts.result.finishedAt,
    error: opts.result.error,
    failedStep: findFailedStep(steps),
    steps: mapSteps(steps),
    healLogs: opts.healLogs || [],
    artifacts: {
      resultJson: `${outRel}/result.json`,
      replayRel: opts.result.replayRel,
      videoRel: opts.result.videoRel,
      screenshotDir: screenshotDirRel,
      screenshots: collectKeyScreenshots(steps),
      stdoutLog: opts.stdoutLogRel,
    },
  };
}

export function writeFailureBundle(opts: {
  kind: FailureBundleKind;
  outputDir: string;
  result: AiTestRunResult & { engine?: 'ego' | 'pw'; intentPath?: string; env?: string; profile?: string; planName?: string };
  healLogs?: HealLogEntry[];
  stdoutLogRel?: string;
}): FailureBundleWriteResult | undefined {
  if (opts.result.passed) return undefined;

  const outputDir = path.resolve(opts.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const healLogs = opts.healLogs || [];
  let healDirRel: string | undefined;
  if (healLogs.length > 0) {
    const healDir = path.join(outputDir, 'heal');
    fs.mkdirSync(healDir, { recursive: true });
    healDirRel = toRepoRel(healDir);
    for (let i = 0; i < healLogs.length; i += 1) {
      const entry = healLogs[i];
      const safeId = entry.stepId.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').slice(0, 40) || 'step';
      const file = path.join(healDir, `${String(i + 1).padStart(2, '0')}-${safeId}.json`);
      fs.writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`, 'utf-8');
    }
  }

  const bundle = buildFailureBundle({ ...opts, healLogs });
  if (healDirRel) bundle.artifacts.healDir = healDirRel;

  const bundleAbs = path.join(outputDir, 'failure-bundle.json');
  const summaryAbs = path.join(outputDir, 'failure-summary.md');
  fs.writeFileSync(bundleAbs, `${JSON.stringify(bundle, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(summaryAbs, `${formatFailureSummaryMarkdown(bundle)}\n`, 'utf-8');

  return {
    bundleRel: toRepoRel(bundleAbs) || 'failure-bundle.json',
    summaryRel: toRepoRel(summaryAbs) || 'failure-summary.md',
    healDir: healDirRel,
  };
}

export function readFailureBundle(outputDir: string): FailureBundle | null {
  const file = path.join(path.resolve(outputDir), 'failure-bundle.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as FailureBundle;
  } catch {
    return null;
  }
}
