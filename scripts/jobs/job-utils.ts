import fs from 'fs';
import path from 'path';
import { browserToRunSegment, recordLastGreenRun } from '../report/baseline-manager.js';
import { specMatchesEnv } from '../../src/utils/test-env-path.js';

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
  return base === 'studio-unsaved-draft.optimized.spec.ts';
}

export function resolveSpecPaths(
  specs: 'all' | string[],
  optimizedDir: string,
  playwrightEnv?: string,
): string[] {
  let allSpecs = findOptimizedSpecFiles(optimizedDir).filter((p) => !isDraftOptimizedSpecAbs(p));
  if (playwrightEnv) {
    allSpecs = allSpecs.filter((abs) => {
      const rel = path.relative(process.cwd(), abs).replace(/\\/g, '/');
      return specMatchesEnv(rel, playwrightEnv);
    });
  }
  if (specs === 'all') return allSpecs;

  const patterns = specs.map((s) => s.replace(/\\/g, '/'));
  const matched = allSpecs.filter((abs) => {
    const rel = path.relative(process.cwd(), abs).replace(/\\/g, '/');
    return matchesAnyPattern(rel, patterns);
  });

  return matched.sort((a, b) => a.localeCompare(b));
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
