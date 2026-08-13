import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { browserToRunSegment, recordLastGreenRun } from '../report/baseline-manager.js';
import { specMatchesEnv } from '../../src/utils/test-env-path.js';

const requireCjs = createRequire(import.meta.url);
const specMeta = requireCjs('../../src/utils/spec-meta.cjs') as {
  enrichOptimizedSpecEntry: (
    repoRoot: string,
    rel: string,
  ) => { accountProfile?: string };
  groupEntriesByAccountProfile: (
    entries: { rel: string; accountProfile?: string }[],
  ) => [string, { rel: string; accountProfile?: string }[]][];
  summarizeProfileCounts: (entries: { accountProfile?: string }[]) => Record<string, number>;
  UNKNOWN_PROFILE: string;
};

export type AccountProfileFilter = string | string[] | null | undefined;

export type SpecRunEntry = {
  absPath: string;
  relPath: string;
  accountProfile: string;
};

function normalizeAccountProfileFilter(filter: AccountProfileFilter): string[] | null {
  if (filter == null || filter === '' || filter === 'all') return null;
  if (Array.isArray(filter)) return filter.map(String).filter(Boolean);
  const one = String(filter).trim();
  return one ? [one] : null;
}

export function findOptimizedSpecFiles(rootDir: string): string[] {
  const absRoot = path.resolve(process.cwd(), rootDir);
  const out: string[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.name.endsWith('.optimized.spec.ts')) {
        out.push(full);
      }
    }
  }

  if (fs.existsSync(absRoot) && fs.statSync(absRoot).isDirectory()) {
    walk(absRoot);
  }

  return out.sort((a, b) => a.localeCompare(b));
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/');
  let re = '^';
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (/[+?^${}()|[\]\\]/.test(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  re += '$';
  return new RegExp(re);
}

function matchesAnyPattern(relPath: string, patterns: string[]): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return patterns.some((p) => {
    const pat = p.replace(/\\/g, '/');
    if (pat.includes('*')) {
      return globToRegExp(pat).test(normalized);
    }
    return normalized === pat || normalized.endsWith(`/${pat}`);
  });
}

function isDraftOptimizedSpecAbs(absPath: string): boolean {
  const base = path.basename(absPath);
  return (
    base === 'studio-auto.optimized.spec.ts' ||
    base === 'studio-unsaved-draft.optimized.spec.ts' ||
    base.startsWith('studio-auto_') && base.endsWith('.optimized.spec.ts')
  );
}

/** 将 legacy 路径 tests/optimized/<dateCategory>/file 规范为带 env 段，便于 glob 匹配 */
function relPathForJobSpecMatch(relPath: string, playwrightEnv: string): string {
  const rel = relPath.replace(/\\/g, '/');
  const legacy = rel.match(/^tests\/optimized\/(\d{6})\/(.+\.optimized\.spec\.ts)$/);
  if (legacy && !KNOWN_ENV_IDS.includes(legacy[1])) {
    return `tests/optimized/${playwrightEnv}/${legacy[1]}/${legacy[2]}`;
  }
  return rel;
}

/** 收集某 env 下全部正式 optimized 用例（含 legacy 无 env 段路径） */
export function collectOptimizedSpecsForEnv(optimizedDir: string, playwrightEnv?: string): string[] {
  let allSpecs = findOptimizedSpecFiles(optimizedDir).filter((p) => !isDraftOptimizedSpecAbs(p));
  if (playwrightEnv) {
    allSpecs = allSpecs.filter((abs) => {
      const rel = path.relative(process.cwd(), abs).replace(/\\/g, '/');
      return specMatchesEnv(rel, playwrightEnv);
    });
  }
  return allSpecs;
}

const KNOWN_ENV_IDS = ['dev', 'uat', 'stage', 'stage9084'];

/** 将 Job 配置中的 glob 规范化为带 env 段的路径 */
export function normalizeSpecPatterns(specs: string[], playwrightEnv: string): string[] {
  const env = String(playwrightEnv || 'stage').trim();
  const envPrefix = `tests/optimized/${env}/`;
  return specs.map((raw) => {
    let pat = String(raw || '').replace(/\\/g, '/').trim();
    if (!pat) return pat;
    if (!pat.startsWith('tests/')) {
      pat = pat.startsWith('optimized/') ? `tests/${pat}` : `${envPrefix}${pat}`;
    }
    // legacy: tests/optimized/260612/foo → tests/optimized/<env>/260612/foo
    const legacy = pat.match(/^tests\/optimized\/(\d{6})\/(.+)$/);
    if (legacy && !KNOWN_ENV_IDS.includes(legacy[1])) {
      return `tests/optimized/${env}/${legacy[1]}/${legacy[2]}`;
    }
    // 已有 tests/optimized/<env>/...
    const withEnv = pat.match(/^tests\/optimized\/([^/]+)\/(.+)$/);
    if (withEnv && KNOWN_ENV_IDS.includes(withEnv[1])) return pat;
    // tests/optimized/<dateCategory>/file 缺 env
    if (legacy) return `tests/optimized/${env}/${legacy[1]}/${legacy[2]}`;
    return pat;
  });
}

export function resolveSpecPaths(
  specs: 'all' | string[],
  optimizedDir: string,
  playwrightEnv?: string,
): string[] {
  const env = playwrightEnv || 'stage';
  const allSpecs = collectOptimizedSpecsForEnv(optimizedDir, playwrightEnv);
  if (specs === 'all') return allSpecs;

  const patterns = normalizeSpecPatterns(specs, env);
  const matched = allSpecs.filter((abs) => {
    const rel = path.relative(process.cwd(), abs).replace(/\\/g, '/');
    const normRel = relPathForJobSpecMatch(rel, env);
    return matchesAnyPattern(normRel, patterns) || matchesAnyPattern(rel, patterns);
  });

  return matched.sort((a, b) => a.localeCompare(b));
}

/** 优先扫描 tests/optimized/<env>/（仅用于文档/兼容；resolveSpecPaths 已全树扫描） */
export function resolveOptimizedScanDir(optimizedDir: string, playwrightEnv?: string): string {
  const env = String(playwrightEnv || '').trim();
  if (!env) return optimizedDir;
  const envAbs = path.join(process.cwd(), optimizedDir, env);
  if (fs.existsSync(envAbs) && fs.statSync(envAbs).isDirectory()) {
    return path.join(optimizedDir, env).replace(/\\/g, '/');
  }
  return optimizedDir;
}

export function resolveSpecEntries(
  specs: 'all' | string[],
  optimizedDir: string,
  playwrightEnv?: string,
  accountProfileFilter?: AccountProfileFilter,
): SpecRunEntry[] {
  const absPaths = resolveSpecPaths(specs, optimizedDir, playwrightEnv);
  const allowed = normalizeAccountProfileFilter(accountProfileFilter);
  const repoRoot = process.cwd();

  let entries: SpecRunEntry[] = absPaths.map(absPath => {
    const relPath = path.relative(repoRoot, absPath).replace(/\\/g, '/');
    const enriched = specMeta.enrichOptimizedSpecEntry(repoRoot, relPath);
    return {
      absPath,
      relPath,
      accountProfile: enriched.accountProfile || specMeta.UNKNOWN_PROFILE,
    };
  });

  if (allowed) {
    entries = entries.filter(e => allowed.includes(e.accountProfile));
  }
  return entries;
}

export function groupSpecEntriesByProfile(entries: SpecRunEntry[]): [string, SpecRunEntry[]][] {
  const grouped = specMeta.groupEntriesByAccountProfile(
    entries.map(e => ({ rel: e.relPath, accountProfile: e.accountProfile })),
  );
  return grouped.map(([profile, group]) => [
    profile,
    group.map(g => entries.find(e => e.relPath === g.rel)!),
  ]);
}

export function summarizeSpecProfileCounts(entries: SpecRunEntry[]): Record<string, number> {
  return specMeta.summarizeProfileCounts(entries.map(e => ({ accountProfile: e.accountProfile })));
}

export function countResolvedSpecs(
  specs: 'all' | string[],
  optimizedDir: string,
  playwrightEnv?: string,
  accountProfileFilter?: AccountProfileFilter,
): number {
  return resolveSpecEntries(specs, optimizedDir, playwrightEnv, accountProfileFilter).length;
}

const DRAFT_SPEC_BASENAME = 'studio-auto.optimized.spec.ts';
const LEGACY_DRAFT_SPEC_BASENAME = 'studio-unsaved-draft.optimized.spec.ts';

function isDraftOptimizedRel(relPath: string): boolean {
  const base = path.basename(String(relPath || ''));
  return (
    base === DRAFT_SPEC_BASENAME ||
    base === LEGACY_DRAFT_SPEC_BASENAME ||
    base.startsWith('studio-auto_') && base.endsWith('.optimized.spec.ts')
  );
}

/** 按相对路径解析用例（Job / CLI 运行时覆盖 glob 配置） */
export function resolveSpecEntriesFromRelatives(
  specRelatives: string[],
  optimizedDir: string,
  playwrightEnv?: string,
  accountProfileFilter?: AccountProfileFilter,
): SpecRunEntry[] {
  const repoRoot = process.cwd();
  const absOptimizedDir = path.resolve(repoRoot, optimizedDir);
  const allowed = normalizeAccountProfileFilter(accountProfileFilter);
  const seen = new Set<string>();
  const entries: SpecRunEntry[] = [];

  for (const raw of specRelatives) {
    const relPath = String(raw || '').trim().replace(/\\/g, '/');
    if (!relPath || isDraftOptimizedRel(relPath) || seen.has(relPath)) continue;
    seen.add(relPath);

    const absPath = path.resolve(repoRoot, relPath);
    const relFromOptimized = path.relative(absOptimizedDir, absPath).replace(/\\/g, '/');
    if (relFromOptimized.startsWith('..') || path.isAbsolute(relFromOptimized)) continue;
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) continue;
    if (!relPath.endsWith('.optimized.spec.ts')) continue;

    const enriched = specMeta.enrichOptimizedSpecEntry(repoRoot, relPath);
    const accountProfile = enriched.accountProfile || specMeta.UNKNOWN_PROFILE;
    if (allowed && !allowed.includes(accountProfile)) continue;

    entries.push({ absPath, relPath, accountProfile });
  }

  return entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

export function scriptKeyFromOptimizedPath(optimizedTestPath: string, optimizedDir = 'tests/optimized'): string {
  const rel = path.relative(path.join(process.cwd(), optimizedDir), path.resolve(optimizedTestPath));
  const parts = rel.split(path.sep).filter(Boolean);
  const file = parts.pop() || '';
  const stem = file.replace(/\.optimized\.spec\.ts$/, '').replace(/\.spec\.ts$/, '');
  if (parts.length) return `${parts.join('/')}/${stem}`;
  return stem;
}

export function projectToBrowser(project: string): string {
  if (/webkit/i.test(project)) return 'webkit';
  return 'chrome';
}

export function findLatestRunTimestamp(scriptKey: string, browser: string): string | null {
  const runDir = path.join(process.cwd(), 'screenshots', scriptKey, browserToRunSegment(browser));
  if (!fs.existsSync(runDir)) return null;
  const runs = fs
    .readdirSync(runDir)
    .filter((f) => fs.statSync(path.join(runDir, f)).isDirectory())
    .sort((a, b) => fs.statSync(path.join(runDir, b)).mtimeMs - fs.statSync(path.join(runDir, a)).mtimeMs);
  return runs[0] || null;
}

export function recordLastGreenForScript(scriptKey: string, browsers: string[]): void {
  for (const browser of browsers) {
    const ts = findLatestRunTimestamp(scriptKey, browser);
    if (ts) recordLastGreenRun(scriptKey, browser, ts);
  }
}

export function formatRunId(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function jobsRootDir(): string {
  return path.join(process.cwd(), 'results/jobs');
}

export function jobDir(jobId: string): string {
  return path.join(jobsRootDir(), jobId);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
