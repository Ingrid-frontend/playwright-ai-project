import fs from 'fs';
import path from 'path';

type GoldenSeedEntry = {
  approvalDocNo?: string;
};

const SEEDS_REL = path.join('approval-flow', 'datasource', 'golden-seeds.json');

function readSeedsFile(repoRoot?: string): Record<string, Record<string, GoldenSeedEntry>> {
  const roots = repoRoot
    ? [path.join(repoRoot, SEEDS_REL)]
    : [path.join(process.cwd(), SEEDS_REL), path.join(process.cwd(), '..', SEEDS_REL)];
  for (const abs of roots) {
    if (!fs.existsSync(abs)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function resolveGoldenSeed(
  envId: string,
  roleSlug: string,
  repoRoot?: string,
): { docNo: string } {
  const env = String(envId || 'dev').trim();
  const slug = String(roleSlug || '').trim();
  const seeds = readSeedsFile(repoRoot);
  const bucket = seeds[env] || {};
  const entry = (slug && bucket[slug]) || bucket['*'] || bucket.default || {};
  return {
    docNo: String(entry.approvalDocNo || '').trim(),
  };
}
