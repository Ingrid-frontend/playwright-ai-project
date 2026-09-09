import fs from 'fs';
import path from 'path';
import { sanitizeRunId } from './ui-audit-history.js';

export type ReportBatchRun = {
  flowId: string;
  env: string;
  profileId?: string;
  roleSlug?: string;
  scriptKey: string;
  runId: string;
  ok: boolean;
  skipped?: boolean;
  required?: boolean;
  passed?: number;
  failed?: number;
  total?: number;
};

export type ReportBatchManifest = {
  batchId: string;
  flowId?: string;
  env?: string;
  createdAt: string;
  updatedAt?: string;
  expectedRunCount: number;
  runs: ReportBatchRun[];
};

export type ReportBatchAudit = {
  runCount: number;
  total: number;
  pass: number;
  review: number;
  fail: number;
  skipped: number;
  issueTotal: number;
  observationTotal: number;
  degradedSteps: number;
};

export function normalizeReportBatchId(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

export function reportBatchDir(batchId: string): string {
  return path.join('results', 'flow-report-batches', normalizeReportBatchId(batchId));
}

export function readReportBatch(batchId: string): ReportBatchManifest {
  const abs = path.resolve(reportBatchDir(batchId), 'manifest.json');
  if (!fs.existsSync(abs)) throw new Error(`交付批次不存在: ${batchId}`);
  const batch = JSON.parse(fs.readFileSync(abs, 'utf8')) as ReportBatchManifest;
  if (!Array.isArray(batch.runs) || !batch.batchId) {
    throw new Error(`交付批次格式无效: ${batchId}`);
  }
  return batch;
}

export function writeReportBatch(batch: ReportBatchManifest): ReportBatchManifest {
  const batchId = normalizeReportBatchId(batch.batchId);
  if (!batchId) throw new Error('交付批次 ID 不能为空');
  const dir = path.resolve(reportBatchDir(batchId));
  const abs = path.join(dir, 'manifest.json');
  const next = {
    ...batch,
    batchId,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${abs}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, abs);
  return next;
}

export function readReportBatchAudit(batch: ReportBatchManifest): ReportBatchAudit {
  const summary: ReportBatchAudit = {
    runCount: 0,
    total: 0,
    pass: 0,
    review: 0,
    fail: 0,
    skipped: 0,
    issueTotal: 0,
    observationTotal: 0,
    degradedSteps: 0,
  };
  const latestAbs = path.resolve('results', 'ui-audit', 'summary.json');
  for (const run of batch.runs) {
    if (!run.scriptKey || !run.runId) continue;
    const auditRunId = sanitizeRunId(`${run.scriptKey}-${run.runId}`);
    const runAbs = path.resolve('results', 'ui-audit', 'runs', auditRunId, 'summary.json');
    const abs = fs.existsSync(runAbs) ? runAbs : latestAbs;
    if (!fs.existsSync(abs)) continue;
    try {
      const item = JSON.parse(fs.readFileSync(abs, 'utf8')) as Record<string, unknown>;
      if (String(item.manifestRunId || item.runTs || '') !== run.runId) continue;
      summary.runCount += 1;
      for (const key of [
        'total',
        'pass',
        'review',
        'fail',
        'skipped',
        'issueTotal',
        'observationTotal',
        'degradedSteps',
      ] as const) {
        summary[key] += Number(item[key]) || 0;
      }
    } catch {
      /* 单个审计摘要损坏不影响截图验收报告 */
    }
  }
  return summary;
}
