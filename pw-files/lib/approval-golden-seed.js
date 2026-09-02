/**
 * approval-flow 的 golden 档案解析。
 * 实现已收敛到 flow-golden-seed.js，这里只保留原有导出名，避免改调用方。
 */
const { resolveFlowGoldenSeed } = require('./flow-golden-seed.js');

function resolveApprovalGoldenSeed(repoRoot, envId, roleSlug) {
  return resolveFlowGoldenSeed(repoRoot, 'approval-flow', envId, roleSlug, ['approvalDocNo']);
}

module.exports = { resolveApprovalGoldenSeed };
