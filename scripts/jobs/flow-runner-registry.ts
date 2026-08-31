import type { ResolvedTestJob } from "./test-jobs-config.js";

export type FlowRunnerKey = "request-flow-golden" | "request-flow-write";

export const FLOW_RUNNER_SCRIPTS: Record<FlowRunnerKey, string> = {
  "request-flow-golden": "run-request-flow-golden.ts",
  "request-flow-write": "run-request-flow-write.ts",
};

export const FLOW_RUNNER_LABELS: Record<FlowRunnerKey, string> = {
  "request-flow-golden": "申请单 Golden",
  "request-flow-write": "申请单 Write",
};

export function resolveFlowRunnerKey(
  runner?: string | null,
  jobId?: string,
): FlowRunnerKey | null {
  const key = (runner || jobId || "") as FlowRunnerKey;
  return key in FLOW_RUNNER_SCRIPTS ? key : null;
}

export function isRequestFlowRunner(job: { runner?: string | null; id?: string }): boolean {
  return resolveFlowRunnerKey(job.runner, job.id) != null;
}

export function countRequestFlowWriteSpecs(job: ResolvedTestJob): number {
  if (Array.isArray(job.specs)) return job.specs.length;
  return 2;
}
