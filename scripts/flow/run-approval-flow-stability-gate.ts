#!/usr/bin/env tsx
/**
 * approval-flow write 稳定性 gate（薄封装，实现见 run-flow-stability-gate.ts）。
 *
 * 用法:
 *   npm run approval-flow:stability-gate
 *   npm run approval-flow:stability-gate -- --runs=5 --env=dev --profile=write
 */
import { runFlowStabilityGateMain } from "./run-flow-stability-gate.js";

runFlowStabilityGateMain({
  flowId: "approval-flow",
  writeScriptRel: "scripts/flow/run-approval-flow-write.ts",
});
