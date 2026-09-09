import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { CustomerPageCard } from './customer-report-model.js';
import {
  flowScreenshotScriptKey,
  flowRunsDir,
  specSlug,
  type FlowId,
  type FlowRunManifest,
} from '../../src/utils/flow-run-report.js';
import { RUN_SEGMENT_DIR } from './compare-screenshots-scan.js';
import { flowBaselineScriptKey } from './baseline-manager.js';
import { readGoldenMatchVerdictForScriptRun } from './prune-flow-golden-runs.js';

const require = createRequire(import.meta.url);
const { readRunMarkerFile } = require('../../pw-files/lib/flow-run-marker.js') as {
  readRunMarkerFile: (runDir: string) => string;
};

export type ScriptRunMeta = {
  scriptKey: string;
  runId?: string;
  startedAt?: string;
  finishedAt?: string;
  durationSec?: number;
};

export type ScriptRunHistoryPreview = {
  stepLabel: string;
  currentPath?: string;
  baselinePath?: string;
  status?: 'pass' | 'minor' | 'regress' | 'uncovered';
};

export type ScriptRunHistoryEntry = {
  /** 从 1 开始，按开始时间升序 */
  runIndex: number;
  runId: string;
  runMarker?: string;
  startedAt?: string;
  finishedAt?: string;
  durationSec?: number;
  screenshotCount: number;
  /** 截图已被 golden-prune 清理，screenshotCount 来自 .golden-match.json 归档 */
  screenshotsPruned?: boolean;
  comparedSteps: number;
  passSteps: number;
  minorSteps: number;
  regressSteps: number;
  maxDifference: number;
  verdict: 'pass' | 'minor' | 'regress' | 'uncovered' | 'empty';
  verdictLabel: string;
  isLatest: boolean;
  ok?: boolean;
  /** 最新 run 截图步数少于历史完整轮次 */
  incomplete?: boolean;
  /** 该 run 各步骤截图（相对报告路径），无完整对比时兜底 */
  previews?: ScriptRunHistoryPreview[];
  /** 该 run 已对比步骤的完整证据卡（与最新一轮相同 UI） */
  comparePages?: CustomerPageCard[];
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
  return resolveRunScreenshotMeta(scriptPath, runId).count;
}

/** 磁盘 PNG 数；已清理时从 .golden-match.json 回填 prunedScreenshots / steps */
export function resolveRunScreenshotMeta(
  scriptPath: string,
  runId: string,
): { count: number; pruned: boolean } {
  const live = countRunPngsOnDisk(scriptPath, runId);
  if (live > 0) return { count: live, pruned: false };

  const verdict = readGoldenMatchVerdictForScriptRun(scriptPath, runId);
  if (!verdict) return { count: 0, pruned: false };

  const pruned = (verdict.prunedScreenshots ?? 0) > 0;
  const archived = pruned ? verdict.prunedScreenshots! : verdict.steps ?? 0;
  return { count: archived, pruned };
}

function countRunPngsOnDisk(scriptPath: string, runId: string): number {
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

function scriptKeysMatch(a: string, b: string): boolean {
  const na = flowBaselineScriptKey(a);
  const nb = flowBaselineScriptKey(b);
  return na === nb;
}

function durationFromManifest(m?: FlowRunManifest): number | undefined {
  if (!m) return undefined;
  if (m.durationSec && m.durationSec > 0) return m.durationSec;
  if (m.startedAt && m.finishedAt) {
    const sec = (Date.parse(m.finishedAt) - Date.parse(m.startedAt)) / 1000;
    if (Number.isFinite(sec) && sec > 0) return Math.round(sec * 10) / 10;
  }
  return undefined;
}

function metaForRun(manifests: FlowRunManifest[], scriptKey: string, runId: string): FlowRunManifest | undefined {
  const normalized = flowBaselineScriptKey(scriptKey);
  return manifests.find((m) => m.runId === runId && scriptKeysMatch(manifestScriptKey(m), normalized));
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
      const durationSec = durationFromManifest(manifest);
      const runDir = path.join(scriptPath, ...findRunRootSegments(scriptPath), runId);
      const runMarker = manifest?.runMarker || readRunMarkerFile(runDir) || undefined;
      const shotMeta = resolveRunScreenshotMeta(scriptPath, runId);
      rows.push({
        runIndex: i + 1,
        runId,
        runMarker,
        startedAt,
        finishedAt,
        durationSec,
        screenshotCount: shotMeta.count,
        screenshotsPruned: shotMeta.pruned || undefined,
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
  return { scriptKey, runId: latestRun, startedAt, finishedAt, durationSec };
}

function findRunRootSegments(scriptPath: string): string[] {
  for (const name of fs.readdirSync(scriptPath).filter((f) => !f.startsWith('.'))) {
    const p = path.join(scriptPath, name);
    if (fs.statSync(p).isDirectory() && RUN_SEGMENT_DIR.test(name)) return [name];
  }
  return [];
}


export function resolveScriptRunMeta(
  scriptKeys: string[],
  scanTargets: Array<{ testDir: string; scriptPath: string }> = [],
  usedRunIds: Map<string, string> = new Map(),
): Map<string, ScriptRunMeta> {
  const unique = [...new Set(scriptKeys.filter(Boolean))];
  const out = new Map<string, ScriptRunMeta>();
  const manifests = loadFlowManifestRows();
  const pathByKey = new Map(scanTargets.map((t) => [t.testDir, t.scriptPath]));

  for (const scriptKey of unique) {
    const scriptPath = pathByKey.get(scriptKey) || '';
    const runId = usedRunIds.get(scriptKey) || (scriptPath ? latestRunIdFromScreenshots(scriptPath) : '');
    const byRunId = manifests.find(
      (m) => m.runId === runId && scriptKeysMatch(manifestScriptKey(m), scriptKey),
    );
    const byRunDuration = durationFromManifest(byRunId);
    if (byRunDuration && byRunDuration > 0) {
      out.set(scriptKey, {
        scriptKey,
        runId: runId || byRunId!.runId,
        startedAt: byRunId!.startedAt,
        finishedAt: byRunId!.finishedAt,
        durationSec: byRunDuration,
      });
      continue;
    }

    const hit = manifests.find((m) => scriptKeysMatch(manifestScriptKey(m), scriptKey));
    const hitDuration = hit ? durationFromManifest(hit) : undefined;
    if (hit && hitDuration && hitDuration > 0) {
      out.set(scriptKey, {
        scriptKey,
        runId: runId || hit.runId,
        startedAt: hit.startedAt,
        finishedAt: hit.finishedAt,
        durationSec: hitDuration,
      });
      continue;
    }

    if (!scriptPath) continue;
    const inferred = inferRunMetaFromScreenshots(scriptKey, scriptPath);
    if (inferred) {
      out.set(scriptKey, inferred);
      continue;
    }
    if (runId) {
      out.set(scriptKey, {
        scriptKey,
        runId,
        startedAt: parseRunDirStartedAt(runId) || byRunId?.startedAt || hit?.startedAt,
      });
    }
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
