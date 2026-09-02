const fs = require('fs');
const path = require('path');

const SEEDS_REL = path.join('approval-flow', 'datasource', 'golden-seeds.json');

function readSeedsFile(repoRoot) {
  const abs = path.join(repoRoot, SEEDS_REL);
  if (!fs.existsSync(abs)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function resolveApprovalGoldenSeed(repoRoot, envId, roleSlug) {
  const env = String(envId || 'dev').trim();
  const slug = String(roleSlug || '').trim();
  const seeds = readSeedsFile(repoRoot);
  const bucket = seeds[env] || {};
  const entry = (slug && bucket[slug]) || bucket['*'] || bucket.default || {};
  return {
    approvalDocNo: String(entry.approvalDocNo || '').trim(),
  };
}

module.exports = { resolveApprovalGoldenSeed };
