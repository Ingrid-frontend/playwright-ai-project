import fs from 'fs';
import path from 'path';
import type { UiIssuesReport } from './ui-issues.js';

const HISTORY_DIR = path.join('results', 'history');
const STEP_TRENDS_FILE = path.join(HISTORY_DIR, 'step-trends.json');
const MAX_STEP_POINTS = 14;
/** 历史快照保留天数（可通过 HISTORY_RETENTION_DAYS 环境变量覆盖） */
const RETENTION_DAYS = Number.parseInt(process.env.HISTORY_RETENTION_DAYS || '90', 10);

export interface StepTrendPoint {
  date: string;
  v: number;
}

export interface StepTrendsFile {
  version: 1;
  steps: Record<string, StepTrendPoint[]>;
}

function stepTrendKey(scriptKey: string, stepNumber: number, stepName: string): string {
  const label = stepName.replace(/-before$/i, '').replace(/-after$/i, '').trim();
  return `${scriptKey}|${stepNumber}|${label}`;
}

export function appendStepTrendPoints(report: UiIssuesReport): void {
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

  let file: StepTrendsFile = { version: 1, steps: {} };
  if (fs.existsSync(STEP_TRENDS_FILE)) {
    try {
      file = JSON.parse(fs.readFileSync(STEP_TRENDS_FILE, 'utf-8')) as StepTrendsFile;
    } catch {
      file = { version: 1, steps: {} };
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const buckets = new Map<string, number>();

  for (const issue of report.issues) {
    if (issue.compareKind !== 'golden' && issue.compareKind !== 'last-green') continue;
    const key = stepTrendKey(issue.scriptKey, issue.stepNumber, issue.stepName);
    buckets.set(key, Math.max(buckets.get(key) || 0, issue.difference));
  }

  for (const [key, v] of buckets) {
    const arr = file.steps[key] ? [...file.steps[key]!] : [];
    const last = arr[arr.length - 1];
    if (last?.date === date) {
      last.v = Math.max(last.v, v);
    } else {
      arr.push({ date, v });
    }
    file.steps[key] = arr.slice(-MAX_STEP_POINTS);
  }

  fs.writeFileSync(STEP_TRENDS_FILE, JSON.stringify(file, null, 2), 'utf-8');
}

export function loadStepTrends(): StepTrendsFile['steps'] {
  if (!fs.existsSync(STEP_TRENDS_FILE)) return {};
  try {
    return (JSON.parse(fs.readFileSync(STEP_TRENDS_FILE, 'utf-8')) as StepTrendsFile).steps || {};
  } catch {
    return {};
  }
}

export interface HistorySnapshot {
  date: string;
  generatedAt: string;
  summary: UiIssuesReport['summary'];
  byScript: Record<
    string,
    {
      blocker: number;
      warning: number;
      avgDifference: number;
    }
  >;
}

export function appendHistorySnapshot(report: UiIssuesReport): string {
  const date = new Date().toISOString().slice(0, 10);
  const filePath = path.join(HISTORY_DIR, `${date}.json`);

  let existing: HistorySnapshot | null = null;
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HistorySnapshot;
    } catch {
      existing = null;
    }
  }

  const byScript: HistorySnapshot['byScript'] = existing?.byScript ? { ...existing.byScript } : {};

  const scriptBuckets = new Map<string, { diffs: number[]; blocker: number; warning: number }>();
  for (const issue of report.issues) {
    if (!scriptBuckets.has(issue.scriptKey)) {
      scriptBuckets.set(issue.scriptKey, { diffs: [], blocker: 0, warning: 0 });
    }
    const b = scriptBuckets.get(issue.scriptKey)!;
    b.diffs.push(issue.difference);
    if (issue.severity === 'blocker') b.blocker++;
    else if (issue.severity === 'warning') b.warning++;
  }

  for (const [scriptKey, bucket] of scriptBuckets) {
    const avg =
      bucket.diffs.length > 0 ? bucket.diffs.reduce((a, c) => a + c, 0) / bucket.diffs.length : 0;
    byScript[scriptKey] = {
      blocker: bucket.blocker,
      warning: bucket.warning,
      avgDifference: avg,
    };
  }

  const snapshot: HistorySnapshot = {
    date,
    generatedAt: report.generatedAt,
    summary: report.summary,
    byScript,
  };

  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  appendStepTrendPoints(report);
  cleanupOldSnapshots();
  return filePath;
}

/** 删除超过保留期的历史快照文件 */
function cleanupOldSnapshots(): void {
  if (!fs.existsSync(HISTORY_DIR)) return;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  try {
    const files = fs.readdirSync(HISTORY_DIR);
    let removed = 0;
    for (const file of files) {
      // 只处理日期快照文件（YYYY-MM-DD.json）
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
      const fileDate = file.replace('.json', '');
      if (fileDate < cutoffStr) {
        try {
          fs.unlinkSync(path.join(HISTORY_DIR, file));
          removed++;
        } catch { /* 忽略单个删除失败 */ }
      }
    }
    if (removed > 0) {
      console.log(`🗑️  已清理 ${removed} 个过期历史快照（保留 ${RETENTION_DAYS} 天）`);
    }
  } catch { /* 目录读取失败时静默跳过 */ }
}
