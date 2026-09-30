#!/usr/bin/env tsx
/**
 * 申请单流程 write runner（薄封装，实现见 run-flow-write.ts）。
 */
import { runFlowWriteMain } from "./run-flow-write.js";

runFlowWriteMain({
  flowId: "request-flow",
  label: "申请单流程",
  configRel: "request-flow/playwright.config.ts",
  defaultSpecs: ["request/travel-submit.spec.ts", "request/full-flow.spec.ts"],
  enableWriteEnv: "REQUEST_ENABLE_WRITE",
});
