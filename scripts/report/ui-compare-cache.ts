import fs from 'fs';
import path from 'path';
import type { TestDirComparisons } from './compare-screenshots-engine.js';

export const UI_COMPARE_CACHE_FILE = 'results/ui-compare-cache.json';
export const FLOW_UI_COMPARE_CACHE_FILE = 'results/flow-ui-compare-cache.json';

export type UiCompareCache = {
  generatedAt: string;
  testDirs: TestDirComparisons[];
};

function readCacheFile(file: string): UiCompareCache | null {
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as UiCompareCache;
    if (!data?.generatedAt || !Array.isArray(data.testDirs)) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeUiCompareCache(
  report: UiCompareCache,
  file = UI_COMPARE_CACHE_FILE,
): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf-8');
  return file;
}

export function readUiCompareCache(): UiCompareCache | null {
  const files = [UI_COMPARE_CACHE_FILE, FLOW_UI_COMPARE_CACHE_FILE];
  const parts: TestDirComparisons[] = [];
  let generatedAt = '';
  for (const file of files) {
    const data = readCacheFile(file);
    if (!data) continue;
    parts.push(...data.testDirs);
    if (data.generatedAt > generatedAt) generatedAt = data.generatedAt;
  }
  if (!parts.length) return null;
  return { generatedAt, testDirs: parts };
}

export function normDir(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/^flows\//, '');
}

export function pickCompareCache(
  cache: UiCompareCache,
  testDirs: string[],
): TestDirComparisons[] | null {
  const byDir = new Map(cache.testDirs.map((item) => [normDir(item.testDir), item]));
  const picked: TestDirComparisons[] = [];
  for (const dir of testDirs) {
    const hit = byDir.get(normDir(dir));
    if (!hit) return null;
    picked.push({ testDir: dir.replace(/\\/g, '/'), comparisons: hit.comparisons });
  }
  return picked;
}

export function shouldReuseCompareCache(opts?: { issuesGeneratedAt?: string }): boolean {
  if (process.argv.includes('--reuse-compare')) return true;
  if (process.env.CUSTOMER_REUSE_COMPARE === '0') return false;
  if (process.env.CUSTOMER_REUSE_COMPARE === '1') return true;
  const cache = readUiCompareCache();
  if (!cache) return false;
  if (!opts?.issuesGeneratedAt) return true;
  return cache.generatedAt === opts.issuesGeneratedAt;
}
