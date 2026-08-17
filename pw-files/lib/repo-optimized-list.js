const fs = require('fs');
const path = require('path');
const specMeta = require('../../src/utils/spec-meta.cjs');
const { specMatchesEnv } = require('../../src/utils/test-env-path.cjs');

/** 列出 tests/optimized 下 *.optimized.spec.ts（按 mtime 倒序） */
function listOptimizedSpecs(repoRoot, opts = {}) {
  const limit = opts.limit ?? 40;
  const sinceMs = opts.sinceMs;
  const nameIncludes = opts.nameIncludes;
  const envFilter = opts.env != null ? String(opts.env).trim() : null;
  const base = path.join(repoRoot, 'tests', 'optimized');
  if (!fs.existsSync(base)) return [];
  const found = [];
  const walk = (dir) => {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.optimized.spec.ts')) {
        try {
          const st = fs.statSync(full);
          if (sinceMs != null && st.mtimeMs < sinceMs - 3000) continue;
          const rel = path.relative(repoRoot, full).split(path.sep).join('/');
          if (nameIncludes && !rel.includes(nameIncludes)) continue;
          if (envFilter && !specMatchesEnv(rel, envFilter, repoRoot)) continue;
          found.push({ rel, mtime: st.mtimeMs });
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(base);
  found.sort((a, b) => b.mtime - a.mtime);
  return found.slice(0, limit).map((x) => x.rel);
}

/** 列出 optimized 用例并附带账号档案等元数据 */
function listOptimizedSpecEntries(repoRoot, opts = {}) {
  const rels = listOptimizedSpecs(repoRoot, opts);
  const accountFilter = opts.accountProfile != null ? String(opts.accountProfile).trim() : null;
  let entries = rels.map((rel) => specMeta.enrichOptimizedSpecEntry(repoRoot, rel));
  if (accountFilter && accountFilter !== 'all') {
    entries = entries.filter((e) => e.accountProfile === accountFilter);
  }
  return entries;
}

module.exports = { listOptimizedSpecs, listOptimizedSpecEntries };
