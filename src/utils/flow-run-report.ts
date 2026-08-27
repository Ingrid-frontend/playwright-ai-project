import fs from 'fs';
import path from 'path';
import { flowRolePathSegment } from './account-slug.js';

export type FlowId = 'request-flow' | 'approval-flow';

export type FlowRunManifest = {
  runId: string;
  flowId: FlowId;
  flowLabel: string;
  startedAt: string;
  finishedAt?: string;
  env: string;
  spec: string;
  grep?: string;
  mode: string;
  ok?: boolean;
  exitCode?: number;
  passed?: number;
  failed?: number;
  total?: number;
  durationSec?: number;
  screenshotDir?: string;
  compareReportRel?: string;
  customerReportRel?: string;
  summaryReportRel?: string;
  apiFailureLogRel?: string;
  playwrightReportRel?: string;
  replayReportRel?: string;
  traceMode?: string;
  failures?: Array<{ title?: string; message?: string }>;
};

export type ApiFailureLogEntry = {
  at: string;
  testTitle: string;
  failures: Array<{
    kind: string;
    url: string;
    method: string;
    status?: number;
    bodySummary?: string;
    errorText?: string;
  }>;
};

const FLOW_LABELS: Record<FlowId, string> = {
  'request-flow': '申请单流程',
  'approval-flow': '审批流程',
};

const RUN_SEGMENT = 'run-chromium-flow';

export function flowLabel(flowId: FlowId): string {
  return FLOW_LABELS[flowId] || flowId;
}

export function flowScreenshotEnabled(): boolean {
  const v = (process.env.SCREENSHOT_CAPTURE || '1').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

export function screenshotRunSegment(): string {
  return process.env.PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT?.trim() || RUN_SEGMENT;
}

export function specSlug(spec: string): string {
  const base = path.basename(spec, path.extname(spec)).replace(/\.spec$/, '');
  return base.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-').slice(0, 60) || 'flow';
}

export function flowScreenshotRoot(flowId: FlowId, env: string, spec: string, roleSlug?: string): string {
  const envId = (env || 'dev').trim() || 'dev';
  const base = path.join('screenshots', 'flows', flowId, envId, specSlug(spec));
  const segment = flowRolePathSegment(roleSlug);
  if (segment) return path.join(base, segment);
  return base;
}

export function flowScreenshotScriptKey(flowId: FlowId, env: string, spec: string, roleSlug?: string): string {
  const envId = (env || 'dev').trim() || 'dev';
  const base = `flows/${flowId}/${envId}/${specSlug(spec)}`;
  const segment = flowRolePathSegment(roleSlug);
  if (segment) return `${base}/${segment}`;
  return base;
}

export function newRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function flowRunsDir(flowId: FlowId): string {
  return path.join('results', 'flow-runs', flowId);
}

export function manifestPath(flowId: FlowId, runId: string): string {
  return path.join(flowRunsDir(flowId), runId, 'manifest.json');
}

export function lastRunPath(flowId: FlowId): string {
  return path.join(flowRunsDir(flowId), 'last-run.json');
}

export function apiFailureLogPath(flowId: FlowId, runId: string): string {
  return path.join(flowRunsDir(flowId), runId, 'api-failures.json');
}

export function initWorkerRun(opts: {
  flowId: FlowId;
  env: string;
  spec: string;
}): { runId: string; startedAt: string; screenshotDir: string; runDir: string } {
  const runId = process.env.FLOW_RUN_ID?.trim() || newRunId();
  const startedAt = process.env.FLOW_RUN_STARTED_AT?.trim() || new Date().toISOString();
  const roleSlug = process.env.FLOW_ACCOUNT_SLUG?.trim() || '';
  const root = flowScreenshotRoot(opts.flowId, opts.env, opts.spec, roleSlug);
  const runDir = path.join(root, screenshotRunSegment(), runId);

  if (flowScreenshotEnabled()) {
    fs.mkdirSync(runDir, { recursive: true });
  }

  process.env.FLOW_RUN_ID = runId;
  process.env.FLOW_RUN_STARTED_AT = startedAt;
  process.env.PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT = RUN_SEGMENT;

  return { runId, startedAt, screenshotDir: root, runDir };
}

export function writeManifest(manifest: FlowRunManifest): void {
  const dir = path.dirname(manifestPath(manifest.flowId, manifest.runId));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(manifestPath(manifest.flowId, manifest.runId), JSON.stringify(manifest, null, 2), 'utf-8');
  fs.writeFileSync(lastRunPath(manifest.flowId), JSON.stringify(manifest, null, 2), 'utf-8');
  appendHistory(manifest);
}

export function readLastRun(flowId: FlowId): FlowRunManifest | null {
  const p = lastRunPath(flowId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as FlowRunManifest;
  } catch {
    return null;
  }
}

function historyPath(flowId: FlowId): string {
  const d = new Date().toISOString().slice(0, 10);
  return path.join(flowRunsDir(flowId), 'history', `${d}.json`);
}

function appendHistory(manifest: FlowRunManifest): void {
  const p = historyPath(manifest.flowId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let rows: FlowRunManifest[] = [];
  if (fs.existsSync(p)) {
    try {
      rows = JSON.parse(fs.readFileSync(p, 'utf-8')) as FlowRunManifest[];
    } catch {
      rows = [];
    }
  }
  rows.push(manifest);
  fs.writeFileSync(p, JSON.stringify(rows, null, 2), 'utf-8');
}

export function appendApiFailures(
  flowId: FlowId,
  runId: string,
  testTitle: string,
  failures: ApiFailureLogEntry['failures'],
): void {
  if (!failures.length) return;
  const p = apiFailureLogPath(flowId, runId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let log: ApiFailureLogEntry[] = [];
  if (fs.existsSync(p)) {
    try {
      log = JSON.parse(fs.readFileSync(p, 'utf-8')) as ApiFailureLogEntry[];
    } catch {
      log = [];
    }
  }
  log.push({ at: new Date().toISOString(), testTitle, failures });
  fs.writeFileSync(p, JSON.stringify(log, null, 2), 'utf-8');
}

export function readApiFailures(flowId: FlowId, runId: string): ApiFailureLogEntry[] {
  const p = apiFailureLogPath(flowId, runId);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ApiFailureLogEntry[];
  } catch {
    return [];
  }
}
