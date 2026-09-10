/**
 * flow-run-marker.js 的类型声明。
 * 该模块为 pw-files Studio 侧的 CommonJS 实现，scripts/flow 通过 ESM import 引用，
 * 需要本声明以满足 typecheck 硬门禁。
 */

export interface FlowRunHit {
  flowId: string;
  runId: string;
  scriptKey: string;
  runMarker?: string;
  startedAt?: string;
  finishedAt?: string;
  ok?: boolean;
  env?: string;
  spec?: string;
  roleSlug?: string;
  runSegment?: string;
  runDir?: string;
  reason?: string;
}

export interface DeleteRunsOptions {
  force?: boolean;
  dryRun?: boolean;
}

export interface DeleteRunsResult {
  deleted: FlowRunHit[];
  skipped: FlowRunHit[];
  total: number;
}

export const RUN_MARKER_FILE: string;

export function makeRunMarker(opts?: Record<string, unknown>): string;

export function writeRunMarkerFile(
  runDir: string,
  marker: string,
  extra?: Record<string, unknown>,
): void;

export function readRunMarkerFile(runDir: string): Record<string, unknown> | null;

export function loadManifestHits(repoRoot: string): FlowRunHit[];

export function searchFlowRuns(repoRoot: string, query: string): FlowRunHit[];

export function deleteFlowRun(repoRoot: string, hit: FlowRunHit): void;

export function deleteFlowRunsByMarker(
  repoRoot: string,
  query: string,
  opts?: DeleteRunsOptions,
): DeleteRunsResult;
