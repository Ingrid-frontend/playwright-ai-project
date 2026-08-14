import fs from 'fs';
import path from 'path';

export const RUN_SEGMENT_DIR = /^run-(chromium|webkit|firefox|safari|edge)-/i;

export interface ScriptScanTarget {
  testDir: string;
  scriptPath: string;
}

export function hasDirectRunSegment(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  return fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .some((f) => fs.statSync(path.join(dir, f)).isDirectory() && RUN_SEGMENT_DIR.test(f));
}

export function discoverScriptScanTargets(screenshotsDir: string): ScriptScanTarget[] {
  const skipTop = new Set(['results', 'diffs', 'pom']);
  const targets: ScriptScanTarget[] = [];

  function walk(relativeDir: string, absDir: string): void {
    if (hasDirectRunSegment(absDir)) {
      targets.push({
        testDir: relativeDir.replaceAll(path.sep, '/'),
        scriptPath: absDir,
      });
      return;
    }

    for (const entry of fs.readdirSync(absDir).filter((f) => !f.startsWith('.'))) {
      const childAbs = path.join(absDir, entry);
      if (!fs.statSync(childAbs).isDirectory() || RUN_SEGMENT_DIR.test(entry)) continue;
      const childRel = relativeDir ? path.join(relativeDir, entry) : entry;
      walk(childRel, childAbs);
    }
  }

  if (!fs.existsSync(screenshotsDir)) return targets;

  for (const top of fs
    .readdirSync(screenshotsDir)
    .filter((f) => !f.startsWith('.') && !skipTop.has(f))
    .filter((f) => fs.statSync(path.join(screenshotsDir, f)).isDirectory())) {
    walk(top, path.join(screenshotsDir, top));
  }

  return targets.sort((a, b) => a.testDir.localeCompare(b.testDir, 'zh-CN'));
}
