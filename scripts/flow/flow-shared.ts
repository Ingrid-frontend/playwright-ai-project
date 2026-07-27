import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { browserToRunSegment, recordLastGreenRun } from '../report/baseline-manager.js';
import { loadUiRegressionConfig, resolveDefaultBrowsers } from '../report/ui-regression-config.js';
import {
  getLegacyEnvDefault,
  parseEnvAndDateCategoryFromRawOrProcessed,
  specMatchesEnv,
} from '../../src/utils/test-env-path.js';

export function findFiles(dir: string, pattern: RegExp): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findFiles(fullPath, pattern));
    } else if (pattern.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

export function isUnderOriginal(fullPath: string, rawRoot: string): boolean {
  const rel = path.relative(rawRoot, fullPath).replace(/\\/g, '/');
  return rel.startsWith('original/') || rel === 'original';
}

export function isRawRecordingSpecPath(
  fullPath: string,
  rawRoot: string,
  opts?: { includeOriginal?: boolean },
): boolean {
  if (opts?.includeOriginal) return true;
  return !isUnderOriginal(fullPath, rawRoot);
}

export function specPathInOriginal(specPath: string): boolean {
  return specPath.replace(/\\/g, '/').includes('/original/');
}

export function findOptimizedSpecForRawRecording(rawSpecPath: string, optimizedRoot: string): string | null {
  const stem = path.basename(rawSpecPath, '.spec.ts');
  const wantBase = `${stem}.optimized.spec.ts`;
  const meta = parseEnvAndDateCategoryFromRawOrProcessed(rawSpecPath);
  const runtimeEnv = process.env.PLAYWRIGHT_ENV?.trim() || meta.env || getLegacyEnvDefault();
  const candidates = findFiles(optimizedRoot, /\.optimized\.spec\.ts$/).filter(
    (p) => path.basename(p) === wantBase,
  );
  if (candidates.length === 0) return null;
  const envMatched = candidates.filter((p) => {
    const rel = path.relative(process.cwd(), p).replace(/\\/g, '/');
    return specMatchesEnv(rel, meta.env || runtimeEnv);
  });
  const pool = envMatched.length ? envMatched : candidates;
  if (pool.length === 1) return pool[0];
  return pool.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

export function scriptKeyFromOptimizedPath(optimizedTestPath: string): string {
  const rel = path.relative(path.join(process.cwd(), 'tests/optimized'), path.resolve(optimizedTestPath));
  const parts = rel.split(path.sep).filter(Boolean);
  const file = parts.pop() || '';
  const stem = file.replace(/\.optimized\.spec\.ts$/, '').replace(/\.spec\.ts$/, '');
  if (parts.length) return `${parts.join('/')}/${stem}`;
  return stem;
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

export function runCommand(
  command: string,
  description: string,
  continueOnError = false,
): boolean {
  console.log(`\n📋 ${description}`);
  console.log(`🔧 执行命令: ${command}`);
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`✅ ${description} 完成`);
    return true;
  } catch {
    console.error(`❌ ${description} 失败`);
    if (continueOnError) {
      console.log(`⚠️  继续执行后续步骤...`);
      return false;
    }
    throw new Error(`${description} 失败`);
  }
}

export type AnalyzeTestResult = {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  reportPath: string;
  pomHint: boolean;
};

export function runAnalyzeTest(specPath: string, analyzeGate: boolean): AnalyzeTestResult {
  const base = path.basename(specPath, path.extname(specPath)).replace(/\.optimized\.spec$/, '');
  const reportPath = path.join(process.cwd(), 'results', `analyze-${base}.json`);
  const gateFlag = analyzeGate ? ' --gate' : '';
  const ok = runCommand(
    `npx tsx scripts/analyze/analyze-test.ts "${specPath}" --output="${reportPath}"${gateFlag}`,
    '脚本质量检查（analyze-test）',
    !analyzeGate,
  );
  let errorCount = 0;
  let warningCount = 0;
  let pomHint = false;
  if (fs.existsSync(reportPath)) {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as {
        issues?: { type: string }[];
        stats?: { cssLocators?: number; semanticLocators?: number };
      };
      const issues = report.issues || [];
      errorCount = issues.filter((i) => i.type === 'error').length;
      warningCount = issues.filter((i) => i.type === 'warning').length;
      const css = report.stats?.cssLocators || 0;
      const semantic = report.stats?.semanticLocators || 0;
      pomHint = css > semantic && css >= 3;
    } catch {
      /* ignore */
    }
  }
  if (pomHint) {
    console.log(`💡 CSS 定位符较多，可考虑: npm run generate-pom -- ${specPath.replace(/\.optimized\.spec\.ts$/, '.spec.ts')}`);
  }
  return { ok, errorCount, warningCount, reportPath, pomHint };
}

export function getAnalyzeErrorsSummary(maxLines = 5): string {
  const errorDir = path.join(process.cwd(), 'tests/deprecated/errors');
  if (!fs.existsSync(errorDir)) return '';
  const errorFiles = fs
    .readdirSync(errorDir)
    .filter((f) => f.startsWith('test-errors-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (errorFiles.length === 0) return '';
  try {
    const content = JSON.parse(fs.readFileSync(path.join(errorDir, errorFiles[0]!), 'utf-8')) as {
      errors?: { testFile?: string; error?: string; errorLine?: number; errorFile?: string }[];
    };
    const lines: string[] = ['**失败摘要**：'];
    for (const err of (content.errors || []).slice(0, maxLines)) {
      const loc = err.errorLine != null ? `${err.errorFile || err.testFile}:${err.errorLine}` : err.testFile;
      const msg = (err.error || '').split('\n')[0]?.slice(0, 120) || '未知错误';
      lines.push(`- ${loc} — ${msg}`);
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

export function runAnalyzeErrorsOnFailure(): void {
  runCommand('npm run analyze-errors', '失败分析（analyze-errors）', true);
}


export { isFlakeError } from '../../custom-reporters/flake-patterns.js';

type PromoteUiIssue = {
  scriptKey: string;
  compareKind: string;
  severity: string;
  difference: number;
};

export function tryAutoPromoteBaseline(
  scriptKey: string,
  uiBlockerCount: number,
  uiIssues?: PromoteUiIssue[],
): void {
  if (process.env.AUTO_PROMOTE_BASELINE === '0') return;

  const cfg = loadUiRegressionConfig();
  const maxDiff = Number(
    process.env.AUTO_PROMOTE_MAX_DIFF ?? cfg.autoPromote?.maxDiffRatio ?? 0.005,
  );
  const goldenLike = (uiIssues || []).filter(
    (i) =>
      i.scriptKey === scriptKey &&
      (i.compareKind === 'golden' || i.compareKind === 'last-green'),
  );
  const goldenBlockers = goldenLike.filter((i) => i.severity === 'blocker');
  const maxGoldenDiff = goldenLike.reduce((m, i) => Math.max(m, i.difference), 0);

  if (goldenBlockers.length > 0 && maxGoldenDiff > maxDiff) {
    console.log(
      `ℹ️  golden/last-green blocker ${goldenBlockers.length} 项、max diff ${(maxGoldenDiff * 100).toFixed(3)}% > ${(maxDiff * 100).toFixed(3)}%，跳过 auto-promote`,
    );
    return;
  }
  if (uiBlockerCount > 0 && goldenBlockers.length === 0) {
    console.log('ℹ️  存在非 golden UI blocker，跳过 auto-promote');
    return;
  }

  for (const browser of resolveDefaultBrowsers()) {
    const ts = findLatestRunTimestamp(scriptKey, browser);
    if (!ts) continue;
    runCommand(
      `npm run promote-baseline -- --script=${scriptKey} --run=${ts} --browser=${browser}`,
      `自动提升 Golden（${browser}）`,
      true,
    );
  }
}
