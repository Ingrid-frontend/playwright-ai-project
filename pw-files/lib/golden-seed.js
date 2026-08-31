const fs = require('fs');
const path = require('path');

const SEEDS_REL = path.join('request-flow', 'datasource', 'golden-seeds.json');

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

function resolveGoldenSeed(repoRoot, envId, roleSlug) {
  const env = String(envId || 'dev').trim();
  const slug = String(roleSlug || '').trim();
  const seeds = readSeedsFile(repoRoot);
  const bucket = seeds[env] || {};
  const entry = (slug && bucket[slug]) || bucket['*'] || bucket.default || {};
  return {
    requestDocNo: String(entry.requestDocNo || '').trim(),
    requestFilterKeyword: String(entry.requestFilterKeyword || '').trim(),
  };
}

module.exports = { resolveGoldenSeed };
