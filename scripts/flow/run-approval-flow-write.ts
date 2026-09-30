#!/usr/bin/env tsx
/**
 * 审批流程 write runner（薄封装，实现见 run-flow-write.ts）。
 * pipeline 显式传 "default"：保持 approval 原实现行为（不走 finalizeFlowRun 自动探测）。
 */
import { runFlowWriteMain } from "./run-flow-write.js";

runFlowWriteMain({
  flowId: "approval-flow",
  label: "审批流程",
  configRel: "approval-flow/playwright.config.ts",
  defaultSpecs: ["approval/approve-reject.spec.ts"],
  enableWriteEnv: "APPROVAL_ENABLE_WRITE",
  pipeline: "default",
});
