const fs = require('fs');
const path = require('path');
const { assertAllowedOptimizedSpec } = require('./repo-paths');
const { listOptimizedSpecs } = require('./repo-optimized-list');
const {
  parseRawOriginalRel,
  buildOptimizedRel,
  getLegacyEnvDefault,
} = require('../src/utils/test-env-path.cjs');

/** 根据 raw original 路径推断 optimized 产物位置（pipeline 刚结束时优先用） */
function findOptimizedCandidatesForRawTarget(repoRoot, targetRelative, sessionEnv) {
  const norm = String(targetRelative || '').replace(/\\/g, '/');
  if (!norm.endsWith('.spec.ts')) return [];
  const parsed = parseRawOriginalRel(norm, repoRoot);
  const stem = path.basename(norm, '.spec.ts');
  const env = parsed?.env || sessionEnv || getLegacyEnvDefault(repoRoot);
  const dateCategory = parsed?.dateCategory || '';
  const relCandidates = [];
  if (parsed) {
    relCandidates.push(buildOptimizedRel({ playwrightEnv: env, dateCategory, stem, repoRoot }));
    if (dateCategory) {
      relCandidates.push(buildOptimizedRel({ playwrightEnv: env, dateCategory: '', stem, repoRoot }));
    }
  }
  if (dateCategory) {
    relCandidates.push(`tests/optimized/${dateCategory}/${stem}.optimized.spec.ts`);
    relCandidates.push(`tests/optimized/${env}/${dateCategory}/${stem}.optimized.spec.ts`);
    relCandidates.push(`tests/optimized/${env}/${stem}.optimized.spec.ts`);
  }
  relCandidates.push(`tests/optimized/${stem}.optimized.spec.ts`);

  const out = [];
  const seen = new Set();
  for (const rel of relCandidates) {
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    try {
      const abs = assertAllowedOptimizedSpec(repoRoot, rel);
      if (fs.existsSync(abs)) out.push(rel);
    } catch {
      /* skip invalid */
    }
  }
  return out;
}

/** pipeline 结束后：优先本次新生成/更新的，否则回退为仓库内最近用例，并按保存文件名优先匹配 */
function resolveOptimizedSpecsAfterPipeline(repoRoot, sinceMs, targetRelative, env) {
  const parsedTarget = parseRawOriginalRel(String(targetRelative || '').replace(/\\/g, '/'), repoRoot);
  const envFilter = (parsedTarget?.env || env || getLegacyEnvDefault(repoRoot)).trim();
  const fromTarget = findOptimizedCandidatesForRawTarget(repoRoot, targetRelative, envFilter);
  let specs = [...fromTarget];
  let recent = listOptimizedSpecs(repoRoot, { sinceMs, limit: 12, env: envFilter });
  const stem = targetRelative && targetRelative.endsWith('.spec.ts')
    ? path.basename(targetRelative, '.spec.ts')
    : '';
  if (stem) {
    const byName = listOptimizedSpecs(repoRoot, { limit: 50, nameIncludes: stem, env: envFilter });
    if (byName.length) {
      recent = [...new Set([...byName, ...recent])];
    }
  }
  if (recent.length === 0) {
    recent = listOptimizedSpecs(repoRoot, { limit: 40, env: envFilter });
  }
  if (recent.length === 0 && envFilter) {
    recent = listOptimizedSpecs(repoRoot, { limit: 40, nameIncludes: stem || undefined });
  }
  specs = [...new Set([...specs, ...recent])];
  return specs.slice(0, 40);
}

function readOptimizedCodeAfterPipeline(repoRoot, draftRel, optimizedSpecs) {
  const candidates = [
    draftRel,
    ...(Array.isArray(optimizedSpecs) ? optimizedSpecs : []),
  ].filter(Boolean);
  const seen = new Set();
  for (const rel of candidates) {
    const norm = String(rel).replace(/\\/g, '/');
    if (seen.has(norm)) continue;
    seen.add(norm);
    try {
      const code = fs.readFileSync(assertAllowedOptimizedSpec(repoRoot, norm), 'utf8');
      if (String(code || '').trim()) return code;
    } catch {
      /* try next */
    }
  }
  return '';
}

module.exports = {
  findOptimizedCandidatesForRawTarget,
  resolveOptimizedSpecsAfterPipeline,
  readOptimizedCodeAfterPipeline,
};
