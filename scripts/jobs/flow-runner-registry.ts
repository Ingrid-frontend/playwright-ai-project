import type { ResolvedTestJob } from "./test-jobs-config.js";
import { buildRunnerLabels, buildRunnerScripts, runnerKey } from "../flow/flow-registry.js";

/**
 * runner key 形如 `<flow-id>-golden` / `<flow-id>-write`。
 * 由 flow-registry 派生，新增流程不用再改本文件。
 */
export type FlowRunnerKey = string;

export const FLOW_RUNNER_SCRIPTS: Record<FlowRunnerKey, string> = buildRunnerScripts();

export const FLOW_RUNNER_LABELS: Record<FlowRunnerKey, string> = buildRunnerLabels();

export function resolveFlowRunnerKey(
  runner?: string | null,
  jobId?: string,
): FlowRunnerKey | null {
  const key = runner || jobId || "";
  return key in FLOW_RUNNER_SCRIPTS ? key : null;
}

export function isRequestFlowRunner(job: { runner?: string | null; id?: string }): boolean {
  return resolveFlowRunnerKey(job.runner, job.id) != null;
}

export function countRequestFlowWriteSpecs(job: ResolvedTestJob): number {
  if (Array.isArray(job.specs)) return job.specs.length;
  return 2;
}

export function countApprovalFlowWriteSpecs(job: ResolvedTestJob): number {
  if (Array.isArray(job.specs)) return job.specs.length;
  return 1;
}

/** 按 flow id 统计 write 用例数；未知流程回落到 specs 长度 */
export function countFlowWriteSpecs(flowId: string, job: ResolvedTestJob): number {
  if (Array.isArray(job.specs)) return job.specs.length;
  void runnerKey;
  return flowId === "approval-flow" ? 1 : 2;
}
