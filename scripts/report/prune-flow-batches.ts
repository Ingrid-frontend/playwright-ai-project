#!/usr/bin/env tsx
/**
 * 清理 results/flow-report-batches/ 下按 (flowId, env) 重复堆积的报告批次。
 * 默认预览；--apply 才删除。永不碰 results/jobs、基线或源码。
 *
 * 目录名约定（与本地产物一致）：
 *   request-flow-stage9084-2026-09-10T07-18-19-409Z
 *   approval-flow-dev-2026-09-10T12-00-00-000Z
 *   demo-customer-2026-09-10T00-00-00-000Z
 */
import fs from 'fs';
import path from 'path';
import {
  applyRemovals,
  getArgValue,
  hasFlag,
  isDirectRun,
  isForbiddenAbs,
  isInsideDir,
  loadKnownEnvs,
  measurePathBytes,
  parseNonNegInt,
  printApplyResult,
  printPruneHeader,
  printPrunePlan,
  resolveResultsRoot,
  type PruneItem,
} from './prune-results-shared.js';

export const DEFAULT_BATCH_DIR = 'flow-report-batches';
export const DEFAULT_KEEP = 1;
export const DEFAULT_KEEP_DEMO = 1;

const TS_SUFFIX_RE = /-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{1,3})?Z)$/;

export type BatchKind = 'flow-env' | 'demo' | 'other';

export type ParsedBatchName = {
  name: string;
  kind: BatchKind;
  /** 分组键：flow-env 为 flowId::env；demo 一律 demo；其它用去时间戳后的前缀 */
  key: string;
  flowId?: string;
  env?: string;
  timestamp?: string;
  timeMs: number;
};

export function parseBatchTimestamp(ts: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{1,3}))?Z$/.exec(ts);
  if (!m) return Number.NaN;
  const ms = (m[5] || '0').padEnd(3, '0');
  return Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${ms}Z`);
}

export function parseFlowBatchDirName(name: string, knownEnvs: string[] = loadKnownEnvs()): ParsedBatchName {
  const tsMatch = TS_SUFFIX_RE.exec(name);
  const prefix = tsMatch ? name.slice(0, tsMatch.index) : name;
  const timestamp = tsMatch?.[1];
  const parsedTs = timestamp ? parseBatchTimestamp(timestamp) : Number.NaN;
  const timeMs = Number.isFinite(parsedTs) ? parsedTs : 0;

  if (prefix === 'demo' || prefix.startsWith('demo-')) {
    return { name, kind: 'demo', key: 'demo', timestamp, timeMs };
  }

  for (const env of knownEnvs) {
    const suffix = `-${env}`;
    if (prefix.endsWith(suffix) && prefix.length > suffix.length) {
      const flowId = prefix.slice(0, -suffix.length);
      if (flowId) {
        return {
          name,
          kind: 'flow-env',
          key: `${flowId}::${env}`,
          flowId,
          env,
          timestamp,
          timeMs,
        };
      }
    }
  }

  return { name, kind: 'other', key: prefix || name, timestamp, timeMs };
}

export type BatchEntry = {
  name: string;
  abs: string;
  parsed: ParsedBatchName;
  mtimeMs: number;
  bytes: number;
};

export type FlowBatchPlan = {
  resultsRoot: string;
  batchRoot: string;
  keep: number;
  keepDemo: number;
  keepItems: BatchEntry[];
  removeItems: PruneItem[];
  missing: boolean;
};

function newestFirst(a: BatchEntry, b: BatchEntry): number {
  const ta = a.parsed.timeMs || a.mtimeMs;
  const tb = b.parsed.timeMs || b.mtimeMs;
  if (tb !== ta) return tb - ta;
  return b.name.localeCompare(a.name);
}

export function planFlowBatchPrune(opts: {
  resultsRoot: string;
  keep?: number;
  keepDemo?: number;
  batchDirName?: string;
}): FlowBatchPlan {
  const keep = opts.keep ?? DEFAULT_KEEP;
  const keepDemo = opts.keepDemo ?? DEFAULT_KEEP_DEMO;
  const batchRoot = path.resolve(opts.resultsRoot, opts.batchDirName || DEFAULT_BATCH_DIR);
  const empty: FlowBatchPlan = {
    resultsRoot: opts.resultsRoot,
    batchRoot,
    keep,
    keepDemo,
    keepItems: [],
    removeItems: [],
    missing: !fs.existsSync(batchRoot),
  };
  if (empty.missing) return empty;
  if (!fs.statSync(batchRoot).isDirectory()) return empty;

  const groups = new Map<string, BatchEntry[]>();
  for (const name of fs.readdirSync(batchRoot)) {
    const abs = path.join(batchRoot, name);
    if (isForbiddenAbs(abs, opts.resultsRoot) || !isInsideDir(abs, opts.resultsRoot)) continue;
    let st: fs.Stats;
    try {
      st = fs.lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink() || !st.isDirectory()) continue;
    const parsed = parseFlowBatchDirName(name);
    const entry: BatchEntry = {
      name,
      abs,
      parsed,
      mtimeMs: st.mtimeMs,
      bytes: measurePathBytes(abs),
    };
    const list = groups.get(parsed.key) || [];
    list.push(entry);
    groups.set(parsed.key, list);
  }

  const keepItems: BatchEntry[] = [];
  const removeItems: PruneItem[] = [];

  for (const [key, entries] of groups) {
    entries.sort(newestFirst);
    const kind = entries[0]?.parsed.kind;
    const retain = kind === 'demo' ? keepDemo : keep;
    const kept = entries.slice(0, retain);
    const dropped = entries.slice(retain);
    keepItems.push(...kept);
    for (const e of dropped) {
      const label =
        e.parsed.kind === 'demo'
          ? `demo 组超出 --keep-demo=${keepDemo}`
          : e.parsed.kind === 'flow-env'
            ? `${e.parsed.flowId} / ${e.parsed.env} 超出 --keep=${keep}`
            : `分组 ${key} 超出 --keep=${keep}`;
      removeItems.push({
        rel: path.posix.join(DEFAULT_BATCH_DIR, e.name),
        abs: e.abs,
        bytes: e.bytes,
        reason: label,
      });
    }
  }

  removeItems.sort((a, b) => a.rel.localeCompare(b.rel));
  keepItems.sort((a, b) => a.name.localeCompare(b.name));
  return { resultsRoot: opts.resultsRoot, batchRoot, keep, keepDemo, keepItems, removeItems, missing: false };
}

function printHelp(): void {
  console.log(`用法: npm run prune:flow-batches -- [选项]

清理 results/flow-report-batches/ 里按 (flowId, env) 重复的报告批次。
默认只预览（dry-run），加 --apply 才会删除。

选项:
  --keep=N          每个 (flowId, env) 保留最新 N 个批次，默认 ${DEFAULT_KEEP}
  --keep-demo=N     demo-* 作为一组，保留最新 N 个，默认 ${DEFAULT_KEEP_DEMO}；0 表示全部丢掉
  --apply           真正删除（默认只打印计划）
  --results=<dir>   结果根目录，默认 results
  -h, --help

不会触碰 screenshots-baseline/、.env、源码、results/jobs。
`);
}

export function runFlowBatchPrune(argv = process.argv.slice(2), cwd = process.cwd()): number {
  if (hasFlag('help', argv) || hasFlag('h', argv)) {
    printHelp();
    return 0;
  }

  let keep: number;
  let keepDemo: number;
  try {
    keep = parseNonNegInt(getArgValue('keep', argv), DEFAULT_KEEP, '--keep');
    keepDemo = parseNonNegInt(getArgValue('keep-demo', argv), DEFAULT_KEEP_DEMO, '--keep-demo');
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : err}`);
    return 1;
  }

  const apply = hasFlag('apply', argv);
  const resultsRoot = resolveResultsRoot(argv, cwd);
  const plan = planFlowBatchPrune({ resultsRoot, keep, keepDemo });
  const relBatches = path.relative(cwd, plan.batchRoot) || plan.batchRoot;

  printPruneHeader('流程报告批次清理', apply, [
    `目录: ${relBatches}${plan.missing ? '（不存在）' : ''}`,
    `保留: 每 (flowId, env) 最新 ${keep} 份 · demo 最新 ${keepDemo} 份`,
  ]);

  if (plan.keepItems.length && plan.removeItems.length) {
    console.log(`将保留 ${plan.keepItems.length} 个批次:`);
    for (const e of plan.keepItems) {
      const who =
        e.parsed.kind === 'flow-env'
          ? `${e.parsed.flowId} / ${e.parsed.env}`
          : e.parsed.kind === 'demo'
            ? 'demo'
            : e.parsed.key;
      console.log(`  + ${e.name}  (${who})`);
    }
    console.log('');
  }

  printPrunePlan(plan.removeItems, apply);
  if (!apply) return 0;

  const result = applyRemovals(plan.removeItems, resultsRoot);
  printApplyResult(result.deleted, result.bytes);
  return 0;
}

if (isDirectRun(import.meta.url)) {
  process.exitCode = runFlowBatchPrune();
}
