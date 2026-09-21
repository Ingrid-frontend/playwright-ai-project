import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';

const RETRACE_FILE = 'results/retest-trace.json';

export type RetestVerdict = 'resolved' | 'still-present' | 'changed';

export type RetestAttempt = {
  attemptIndex: number;
  testedAt: string;
  runId: string;
  verdict: RetestVerdict;
  notes?: string;
  evidencePath?: string;
};

export type RetestTraceEntry = {
  stableIssueId: string;
  envId: string;
  scriptLabel: string;
  stepLabel: string;
  browserLabel: string;
  title: string;
  firstDetectedAt: string;
  attempts: RetestAttempt[];
  resolvedAt?: string;
  resolvedByRunId?: string;
};

type RetestStore = {
  version: 1;
  entries: Record<string, RetestTraceEntry>;
};

function readStore(): RetestStore {
  const abs = path.resolve(RETRACE_FILE);
  if (!fs.existsSync(abs)) return { version: 1, entries: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf-8')) as RetestStore;
    if (!parsed.entries) parsed.entries = {};
    return parsed;
  } catch {
    return { version: 1, entries: {} };
  }
}

function writeStore(store: RetestStore): void {
  const abs = path.resolve(RETRACE_FILE);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(store, null, 2), 'utf-8');
}

export function deriveStableIssueId(
  envId: string,
  scriptLabel: string,
  stepLabel: string,
  browserLabel: string,
  title: string,
): string {
  const raw = [envId, scriptLabel, stepLabel, browserLabel, title].join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export function recordRetestAttempt(params: {
  stableIssueId: string;
  envId: string;
  scriptLabel: string;
  stepLabel: string;
  browserLabel: string;
  title: string;
  runId: string;
  verdict: RetestVerdict;
  notes?: string;
  evidencePath?: string;
}): RetestTraceEntry {
  const store = readStore();
  const { stableIssueId } = params;

  let entry = store.entries[stableIssueId];
  if (!entry) {
    entry = {
      stableIssueId,
      envId: params.envId,
      scriptLabel: params.scriptLabel,
      stepLabel: params.stepLabel,
      browserLabel: params.browserLabel,
      title: params.title,
      firstDetectedAt: new Date().toISOString(),
      attempts: [],
    };
    store.entries[stableIssueId] = entry;
  }

  const attempt: RetestAttempt = {
    attemptIndex: entry.attempts.length + 1,
    testedAt: new Date().toISOString(),
    runId: params.runId,
    verdict: params.verdict,
    notes: params.notes,
    evidencePath: params.evidencePath,
  };
  entry.attempts.push(attempt);

  if (params.verdict === 'resolved') {
    entry.resolvedAt = attempt.testedAt;
    entry.resolvedByRunId = params.runId;
  } else {
    entry.resolvedAt = undefined;
    entry.resolvedByRunId = undefined;
  }

  writeStore(store);
  return entry;
}

export function readRetestTrace(stableIssueId?: string): RetestTraceEntry[] {
  const store = readStore();
  if (stableIssueId) {
    const entry = store.entries[stableIssueId];
    return entry ? [entry] : [];
  }
  return Object.values(store.entries);
}

export type RetestSummary = {
  totalTracked: number;
  resolved: number;
  stillPresent: number;
  pending: number;
  avgAttemptsToResolve: number;
  entries: RetestTraceEntry[];
};

export function buildRetestSummary(): RetestSummary {
  const entries = readRetestTrace();
  let resolved = 0;
  let stillPresent = 0;
  let pending = 0;
  let totalAttemptsToResolve = 0;
  let resolvedCount = 0;

  for (const entry of entries) {
    if (entry.resolvedAt) {
      resolved++;
      totalAttemptsToResolve += entry.attempts.length;
      resolvedCount++;
    } else if (entry.attempts.length > 0) {
      const last = entry.attempts[entry.attempts.length - 1]!;
      if (last.verdict === 'still-present' || last.verdict === 'changed') {
        stillPresent++;
      } else {
        pending++;
      }
    } else {
      pending++;
    }
  }

  return {
    totalTracked: entries.length,
    resolved,
    stillPresent,
    pending,
    avgAttemptsToResolve: resolvedCount > 0 ? totalAttemptsToResolve / resolvedCount : 0,
    entries,
  };
}

export function formatRetestSummary(summary: RetestSummary): string {
  const lines: string[] = [];
  lines.push(`复验追踪：${summary.totalTracked} 项已追踪`);
  lines.push(`  ✅ 已解决 ${summary.resolved}（平均 ${summary.avgAttemptsToResolve.toFixed(1)} 次复验）`);
  lines.push(`  ❌ 仍存在 ${summary.stillPresent}`);
  lines.push(`  ⏳ 待复验 ${summary.pending}`);
  return lines.join('\n');
}
