/**
 * 从 raw / optimized 头部注释回填 *.spec-meta.json sidecar
 *
 *   npx tsx scripts/migrate/backfill-spec-meta.ts
 *   npx tsx scripts/migrate/backfill-spec-meta.ts --dry-run
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const requireCjs = createRequire(import.meta.url);
const specMeta = requireCjs('../../src/utils/spec-meta.cjs');
const { parseEnvFromSpecRel, getLegacyEnvDefault } = requireCjs('../../src/utils/test-env-path.cjs');

const repoRoot = process.cwd();
const dryRun = process.argv.includes('--dry-run');

function walkSpecs(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkSpecs(full, out);
    else if (ent.name.endsWith('.spec.ts') && !ent.name.endsWith('.optimized.spec.ts')) {
      out.push(path.relative(repoRoot, full).replace(/\\/g, '/'));
    }
  }
}

function walkOptimized(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkOptimized(full, out);
    else if (ent.name.endsWith('.optimized.spec.ts')) {
      out.push(path.relative(repoRoot, full).replace(/\\/g, '/'));
    }
  }
}

function backfillOne(rel: string, kind: 'raw' | 'optimized') {
  const metaRel = specMeta.specMetaPathForRel(rel);
  if (!metaRel) return { rel, skipped: true, reason: 'unsupported' };
  const metaAbs = path.join(repoRoot, metaRel);
  if (fs.existsSync(metaAbs)) return { rel, skipped: true, reason: 'exists' };

  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return { rel, skipped: true, reason: 'missing' };

  const code = fs.readFileSync(abs, 'utf8');
  const fromCode = specMeta.parseSpecMetaBlockFromCode(code);
  const env =
    fromCode?.playwrightEnv ||
    parseEnvFromSpecRel(rel, repoRoot) ||
    getLegacyEnvDefault(repoRoot);

  const meta = specMeta.buildSpecMeta({
    playwrightEnv: env,
    accountProfile: fromCode?.accountProfile || 'default',
    loginAccountRaw: fromCode?.loginAccount || null,
    storageStateRel: fromCode?.storageStateRel || null,
    recordedAt: fromCode?.recordedAt || null,
    recordSource: 'backfill',
    rawOriginalRel: kind === 'raw' ? rel : null,
    optimizedRel: kind === 'optimized' ? rel : null,
  });

  if (!dryRun) {
    specMeta.writeSpecMetaFile(repoRoot, rel, meta);
    if (kind === 'optimized') {
      const withHeader = specMeta.appendSpecMetaHeaderToCode(code, meta);
      if (withHeader !== code) fs.writeFileSync(abs, withHeader, 'utf8');
    }
  }
  return { rel, skipped: false, metaRel };
}

const rawDir = path.join(repoRoot, 'tests/raw-recordings');
const optDir = path.join(repoRoot, 'tests/optimized');
const rawSpecs: string[] = [];
const optSpecs: string[] = [];
walkSpecs(rawDir, rawSpecs);
walkOptimized(optDir, optSpecs);

let written = 0;
let skipped = 0;
for (const rel of rawSpecs) {
  const r = backfillOne(rel, 'raw');
  if (r.skipped) skipped++;
  else written++;
}
for (const rel of optSpecs) {
  const r = backfillOne(rel, 'optimized');
  if (r.skipped) skipped++;
  else written++;
}

console.log(`${dryRun ? '[dry-run] ' : ''}回填完成: 写入 ${written}，跳过 ${skipped}`);
