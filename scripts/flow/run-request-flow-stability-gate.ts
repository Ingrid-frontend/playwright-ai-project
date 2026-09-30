#!/usr/bin/env tsx
/**
 * request-flow write 稳定性 gate（薄封装，实现见 run-flow-stability-gate.ts）。
 *
 * 用法:
 *   npm run request-flow:stability-gate
 *   npm run request-flow:stability-gate -- --runs=5 --env=dev --profile=write
 */
import { runFlowStabilityGateMain } from "./run-flow-stability-gate.js";

runFlowStabilityGateMain({
  flowId: "request-flow",
  writeScriptRel: "scripts/flow/run-request-flow-write.ts",
});
