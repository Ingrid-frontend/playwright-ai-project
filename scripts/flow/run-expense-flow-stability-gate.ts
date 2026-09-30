#!/usr/bin/env tsx
/**
 * expense-flow write 稳定性 gate（薄封装，实现见 run-flow-stability-gate.ts）。
 *
 * 用法:
 *   npm run expense-flow:stability-gate
 *   npm run expense-flow:stability-gate -- --runs=5 --env=dev --profile=write
 */
import { runFlowStabilityGateMain } from "./run-flow-stability-gate.js";

runFlowStabilityGateMain({
  flowId: "expense-flow",
  writeScriptRel: "scripts/flow/run-expense-flow-write.ts",
});
