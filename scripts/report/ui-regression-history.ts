import fs from 'fs';
import path from 'path';
import type { UiIssuesReport } from './ui-issues.js';

const HISTORY_DIR = path.join('results', 'history');

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
  return filePath;
}
