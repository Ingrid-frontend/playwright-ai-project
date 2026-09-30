#!/usr/bin/env tsx
/**
 * 报销流程 write runner（薄封装，实现见 run-flow-write.ts）。
 */
import { runFlowWriteMain } from "./run-flow-write.js";

runFlowWriteMain({
  flowId: "expense-flow",
  label: "报销流程",
  configRel: "expense-flow/playwright.config.ts",
  defaultSpecs: ["expense/full-flow.spec.ts"],
  enableWriteEnv: "EXPENSE_ENABLE_WRITE",
});
