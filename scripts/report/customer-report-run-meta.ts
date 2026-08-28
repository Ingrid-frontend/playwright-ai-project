import fs from 'fs';
import path from 'path';
import {
  flowScreenshotScriptKey,
  flowRunsDir,
  specSlug,
  type FlowId,
  type FlowRunManifest,
} from '../../src/utils/flow-run-report.js';
import { RUN_SEGMENT_DIR } from './compare-screenshots-scan.js';

export type ScriptRunMeta = {
  scriptKey: string;
  startedAt?: string;
  finishedAt?: string;
  durationSec?: number;
};

export type ScriptRunHistoryEntry = {
  /** 从 1 开始，按开始时间升序 */
  runIndex: number;
  runId: string;
  startedAt?: string;
  finishedAt?: string;
  durationSec?: number;
  screenshotCount: number;
  comparedSteps: number;
  passSteps: number;
  minorSteps: number;
  regressSteps: number;
  maxDifference: number;
  verdict: 'pass' | 'minor' | 'regress' | 'uncovered' | 'empty';
  verdictLabel: string;
  isLatest: boolean;
  ok?: boolean;
};

const FLOW_IDS: FlowId[] = ['request-flow', 'approval-flow'];

function fmtClock(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

export function formatScriptStartedAt(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function formatDurationSec(sec?: number): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return s >= 0.05 ? `${m}m ${s.toFixed(0)}s` : `${m}m`;
}

export function formatScriptRunSummary(meta: ScriptRunMeta): string {
  const dur = formatDurationSec(meta.durationSec);
  const start = fmtClock(meta.startedAt);
  const end = fmtClock(meta.finishedAt);
  if (start && end && dur) return `${start}–${end}（${dur}）`;
  if (dur) return dur;
  if (start && end) return `${start}–${end}`;
  return '';
}

export function summarizeScriptRuns(runs: ScriptRunMeta[]): string {
  const known = runs.filter((r) => r.durationSec && r.durationSec > 0);
  if (!known.length) return '';
  if (known.length === 1) return formatScriptRunSummary(known[0]!);
  const total = known.reduce((n, r) => n + (r.durationSec || 0), 0);
  return `共 ${formatDurationSec(total)}（${known.length} 个脚本）`;
}

function manifestScriptKey(m: FlowRunManifest): string {
  const ext = m as FlowRunManifest & { scriptKey?: string };
  if (ext.scriptKey) return ext.scriptKey;
  const roleSlug = (m as FlowRunManifest & { roleSlug?: string }).roleSlug;
  return flowScreenshotScriptKey(m.flowId, m.env, m.spec, roleSlug);
}

function loadFlowManifestRows(): FlowRunManifest[] {
  const rows: FlowRunManifest[] = [];
  for (const flowId of FLOW_IDS) {
    const lastPath = path.join(flowRunsDir(flowId), 'last-run.json');
    if (fs.existsSync(lastPath)) {
      try {
        rows.push(JSON.parse(fs.readFileSync(lastPath, 'utf-8')) as FlowRunManifest);
      } catch {
        /* ignore */
      }
    }
    const histDir = path.join(flowRunsDir(flowId), 'history');
    if (!fs.existsSync(histDir)) continue;
    for (const name of fs.readdirSync(histDir).filter((f) => f.endsWith('.json'))) {
      try {
        const batch = JSON.parse(fs.readFileSync(path.join(histDir, name), 'utf-8')) as FlowRunManifest[];
        rows.push(...batch);
      } catch {
        /* ignore */
      }
    }
  }
  return rows.sort(
    (a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime(),
  );
}

function parseRunDirStartedAt(runDirName: string): string | undefined {
  const iso = runDirName.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!iso) return undefined;
  const raw = `${iso[1]}T${iso[2]}:${iso[3]}:${iso[4]}Z`;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function latestRunIdFromScreenshots(scriptPath: string): string {
  const ids = listRunIdsFromScreenshots(scriptPath);
  return ids[ids.length - 1] || '';
}

/** 列出 scriptPath 下全部 run 目录名，按开始时间升序 */
export function listRunIdsFromScreenshots(scriptPath: string): string[] {
  if (!fs.existsSync(scriptPath)) return [];

  let runRoot = '';
  for (const name of fs.readdirSync(scriptPath).filter((f) => !f.startsWith('.'))) {
    const p = path.join(scriptPath, name);
    if (!fs.statSync(p).isDirectory() || !RUN_SEGMENT_DIR.test(name)) continue;
    runRoot = p;
    break;
  }
  if (!runRoot) return [];

  const hits: Array<{ id: string; key: number }> = [];
  for (const name of fs.readdirSync(runRoot).filter((f) => !f.startsWith('.'))) {
    const p = path.join(runRoot, name);
    if (!fs.statSync(p).isDirectory()) continue;
    const key = runTimestampSortKey(name) || fs.statSync(p).mtimeMs;
    hits.push({ id: name, key });
  }
  hits.sort((a, b) => a.key - b.key || a.id.localeCompare(b.id));
  return hits.map((h) => h.id);
}

function runTimestampSortKey(timestamp: string): number {
  const iso = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (iso) {
    const t = Date.parse(`${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:${iso[6]}Z`);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

export function countRunScreenshots(scriptPath: string, runId: string): number {
  if (!scriptPath || !runId) return 0;
  const segments = findRunRootSegments(scriptPath);
  const runDir = path.join(scriptPath, ...segments, runId);
  if (!fs.existsSync(runDir)) return 0;
  let n = 0;
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      if (name.endsWith('.png') && /^step-\d+/.test(name)) n++;
    }
  };
  walk(runDir);
  return n;
}

function metaForRun(manifests: FlowRunManifest[], scriptKey: string, runId: string): FlowRunManifest | undefined {
  return manifests.find((m) => m.runId === runId && manifestScriptKey(m) === scriptKey);
}

export function resolveScriptRunHistory(
  scriptKeys: string[],
  scanTargets: Array<{ testDir: string; scriptPath: string }> = [],
): Map<string, ScriptRunHistoryEntry[]> {
  const unique = [...new Set(scriptKeys.filter(Boolean))];
  const out = new Map<string, ScriptRunHistoryEntry[]>();
  const manifests = loadFlowManifestRows();
  const pathByKey = new Map(scanTargets.map((t) => [t.testDir, t.scriptPath]));

  for (const scriptKey of unique) {
    const scriptPath = pathByKey.get(scriptKey) || '';
    if (!scriptPath) continue;
    const runIds = listRunIdsFromScreenshots(scriptPath);
    const rows: ScriptRunHistoryEntry[] = [];
    runIds.forEach((runId, i) => {
      const manifest = metaForRun(manifests, scriptKey, runId);
      const startedAt = manifest?.startedAt || parseRunDirStartedAt(runId);
      const finishedAt = manifest?.finishedAt;
      const durationSec = manifest?.durationSec;
      rows.push({
        runIndex: i + 1,
        runId,
        startedAt,
        finishedAt,
        durationSec,
        screenshotCount: countRunScreenshots(scriptPath, runId),
        comparedSteps: 0,
        passSteps: 0,
        minorSteps: 0,
        regressSteps: 0,
        maxDifference: 0,
        verdict: 'empty',
        verdictLabel: '待对比',
        isLatest: i === runIds.length - 1,
        ok: manifest?.ok,
      });
    });
    if (rows.length) out.set(scriptKey, rows);
  }
  return out;
}

function inferRunMetaFromScreenshots(scriptKey: string, scriptPath: string): ScriptRunMeta | null {
  if (!fs.existsSync(scriptPath)) return null;

  const latestRun = latestRunIdFromScreenshots(scriptPath);
  if (!latestRun) return null;

  const runDir = path.join(scriptPath, ...findRunRootSegments(scriptPath), latestRun);
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = 0;
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      if (!name.endsWith('.png') || !/^step-\d+/.test(name)) continue;
      minMs = Math.min(minMs, st.mtimeMs);
      maxMs = Math.max(maxMs, st.mtimeMs);
    }
  };
  walk(runDir);
  if (!Number.isFinite(minMs) || maxMs <= 0) return null;

  const startedAt = parseRunDirStartedAt(latestRun) || new Date(minMs).toISOString();
  const finishedAt = new Date(maxMs).toISOString();
  const durationSec = Math.max(0.1, (maxMs - minMs) / 1000);
  return { scriptKey, startedAt, finishedAt, durationSec };
}

function findRunRootSegments(scriptPath: string): string[] {
  for (const name of fs.readdirSync(scriptPath).filter((f) => !f.startsWith('.'))) {
    const p = path.join(scriptPath, name);
    if (fs.statSync(p).isDirectory() && RUN_SEGMENT_DIR.test(name)) return [name];
  }
  return [];
}

function manifestForRunId(manifests: FlowRunManifest[], runId: string): FlowRunManifest | undefined {
  if (!runId) return undefined;
  return manifests.find((m) => m.runId === runId);
}

export function resolveScriptRunMeta(
  scriptKeys: string[],
  scanTargets: Array<{ testDir: string; scriptPath: string }> = [],
): Map<string, ScriptRunMeta> {
  const unique = [...new Set(scriptKeys.filter(Boolean))];
  const out = new Map<string, ScriptRunMeta>();
  const manifests = loadFlowManifestRows();
  const pathByKey = new Map(scanTargets.map((t) => [t.testDir, t.scriptPath]));

  for (const scriptKey of unique) {
    const scriptPath = pathByKey.get(scriptKey) || '';
    const runId = scriptPath ? latestRunIdFromScreenshots(scriptPath) : '';
    const byRunId = manifestForRunId(manifests, runId);
    if (byRunId?.durationSec && byRunId.durationSec > 0) {
      out.set(scriptKey, {
        scriptKey,
        startedAt: byRunId.startedAt,
        finishedAt: byRunId.finishedAt,
        durationSec: byRunId.durationSec,
      });
      continue;
    }

    const hit = manifests.find((m) => manifestScriptKey(m) === scriptKey);
    if (hit?.durationSec && hit.durationSec > 0) {
      out.set(scriptKey, {
        scriptKey,
        startedAt: hit.startedAt,
        finishedAt: hit.finishedAt,
        durationSec: hit.durationSec,
      });
      continue;
    }

    if (!scriptPath) continue;
    const inferred = inferRunMetaFromScreenshots(scriptKey, scriptPath);
    if (inferred) out.set(scriptKey, inferred);
  }

  return out;
}

export function manifestScriptKeyForFlow(
  flowId: FlowId,
  env: string,
  spec: string,
  roleSlug?: string,
): string {
  return flowScreenshotScriptKey(flowId, env, spec, roleSlug);
}

export { specSlug };
