const fs = require('fs');
const path = require('path');

function normalizeReportBatchId(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

function createReportBatchId(flowId, env) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return normalizeReportBatchId(`${flowId}-${env || 'dev'}-${ts}`);
}

function reportBatchDir(repoRoot, batchId) {
  return path.join(repoRoot, 'results', 'flow-report-batches', normalizeReportBatchId(batchId));
}

function reportBatchManifestAbs(repoRoot, batchId) {
  return path.join(reportBatchDir(repoRoot, batchId), 'manifest.json');
}

function reportBatchCustomerRel(batchId) {
  return `results/flow-report-batches/${normalizeReportBatchId(batchId)}/customer-report.html`;
}

function writeReportBatch(repoRoot, batch) {
  const batchId = normalizeReportBatchId(batch?.batchId);
  if (!batchId) throw new Error('report batchId 不能为空');
  const abs = reportBatchManifestAbs(repoRoot, batchId);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const next = {
    ...batch,
    batchId,
    updatedAt: new Date().toISOString(),
  };
  const tmp = `${abs}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, abs);
  return next;
}

function readReportBatch(repoRoot, batchId) {
  const abs = reportBatchManifestAbs(repoRoot, batchId);
  if (!fs.existsSync(abs)) return null;
  try {
    const batch = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return batch && typeof batch === 'object' ? batch : null;
  } catch {
    return null;
  }
}

module.exports = {
  createReportBatchId,
  normalizeReportBatchId,
  readReportBatch,
  reportBatchCustomerRel,
  reportBatchDir,
  reportBatchManifestAbs,
  writeReportBatch,
};
