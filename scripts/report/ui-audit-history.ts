import fs from 'fs';
import path from 'path';

export type AuditHistoryEntry = {
  runId: string;
  runKey: string;
  runTs?: string;
  scriptKey: string;
  generatedAt: string;
  mode: string;
  total: number;
  pass: number;
  review: number;
  fail: number;
  skipped: number;
  issueTotal: number;
  verdict: 'pass' | 'review' | 'fail';
  verdictLabel: string;
  reportRel: string;
};

export type AuditRunGroup = {
  runKey: string;
  runTs: string;
  scriptKey: string;
  items: Array<{
    pngPath: string;
    metaPath: string;
    scriptKey: string;
    stepName: string;
    stepNumber?: number;
  }>;
};

const HISTORY_DIR = 'history';
const RUNS_DIR = 'runs';
const MAX_HISTORY = 50;

export function deriveRunMeta(
  pngPath: string,
  rootDir: string,
  scriptKey: string,
): { runKey: string; runTs: string; runId: string } {
  const norm = pngPath.replace(/\\/g, '/');
  const m = norm.match(/\/run-[^/]+\/([^/]+)\//i);
  const runTs = m?.[1] || `shot-${fs.statSync(pngPath).mtimeMs}`;
  const runKey = `${scriptKey}::${runTs}`;
  const runId = sanitizeRunId(`${scriptKey}-${runTs}`);
  return { runKey, runTs, runId };
}

export function sanitizeRunId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '-').replace(/-+/g, '-').slice(0, 120);
}

export function verdictFromCounts(counts: {
  fail: number;
  review: number;
}): { verdict: AuditHistoryEntry['verdict']; verdictLabel: string } {
  if (counts.fail > 0) return { verdict: 'fail', verdictLabel: '需修复' };
  if (counts.review > 0) return { verdict: 'review', verdictLabel: '待确认' };
  return { verdict: 'pass', verdictLabel: '通过' };
}

export function groupCandidatesByRun<
  T extends { pngPath: string; scriptKey: string; stepNumber?: number; stepName: string; metaPath: string },
>(candidates: T[], rootDir: string): AuditRunGroup[] {
  const buckets = new Map<string, AuditRunGroup>();
  for (const cand of candidates) {
    const { runKey, runTs, runId } = deriveRunMeta(cand.pngPath, rootDir, cand.scriptKey);
    if (!buckets.has(runKey)) {
      buckets.set(runKey, { runKey, runTs, scriptKey: cand.scriptKey, items: [] });
    }
    buckets.get(runKey)!.items.push(cand);
  }
  for (const group of buckets.values()) {
    group.items.sort((a, b) => {
      const na = a.stepNumber ?? 9999;
      const nb = b.stepNumber ?? 9999;
      if (na !== nb) return na - nb;
      return a.stepName.localeCompare(b.stepName, 'zh-CN');
    });
  }
  return [...buckets.values()].sort((a, b) => runGroupMtime(b) - runGroupMtime(a));
}

function runGroupMtime(group: AuditRunGroup): number {
  return Math.max(...group.items.map((i) => fs.statSync(i.pngPath).mtimeMs));
}

export function pickLatestRunGroup<T extends { pngPath: string; scriptKey: string; stepName: string; metaPath: string; stepNumber?: number }>(
  candidates: T[],
  rootDir: string,
): AuditRunGroup | null {
  const groups = groupCandidatesByRun(candidates, rootDir);
  return groups[0] || null;
}

export function historyDir(outDir: string): string {
  return path.join(outDir, HISTORY_DIR);
}

export function runsDir(outDir: string): string {
  return path.join(outDir, RUNS_DIR);
}

export function readAuditHistory(outDir: string): AuditHistoryEntry[] {
  const dir = historyDir(outDir);
  if (!fs.existsSync(dir)) return [];
  const rows: AuditHistoryEntry[] = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      rows.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8')) as AuditHistoryEntry);
    } catch {
      /* ignore */
    }
  }
  return rows.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
}

export function archiveAuditRun(outDir: string, entry: AuditHistoryEntry): void {
  const dir = historyDir(outDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${entry.runId}.json`);
  fs.writeFileSync(file, JSON.stringify(entry, null, 2), 'utf-8');

  const rows = readAuditHistory(outDir);
  if (rows.length <= MAX_HISTORY) return;
  for (const old of rows.slice(MAX_HISTORY)) {
    const p = path.join(dir, `${old.runId}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    const runHtml = path.join(runsDir(outDir), old.runId, 'index.html');
    if (fs.existsSync(runHtml)) {
      try {
        fs.rmSync(path.join(runsDir(outDir), old.runId), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}
