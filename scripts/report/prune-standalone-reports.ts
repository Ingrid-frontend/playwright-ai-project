#!/usr/bin/env tsx
/**
 * 清理 results/ 下可再生成的 *.standalone.html（客户报告 --inline-assets 产物）。
 * 默认预览；--apply 只删 standalone HTML。--assets 才顺带删配对的 *-assets 目录。
 */
import fs from 'fs';
import path from 'path';
import {
  applyRemovals,
  hasFlag,
  isDirectRun,
  isForbiddenAbs,
  isInsideDir,
  isJobsPath,
  measurePathBytes,
  printApplyResult,
  printPruneHeader,
  printPrunePlan,
  resolveResultsRoot,
  type PruneItem,
} from './prune-results-shared.js';

export type StandalonePlan = {
  resultsRoot: string;
  missing: boolean;
  htmlItems: PruneItem[];
  assetItems: PruneItem[];
  skippedHtml: string[];
};

const CUSTOMER_HTML_RE = /(?:^|\/)(?:ui-regression-customer|flow-customer-report)[^/]*\.html$/i;

export function isStandaloneHtmlName(name: string): boolean {
  return name.endsWith('.standalone.html');
}

export function pairedAssetDirNames(htmlName: string): string[] {
  const standaloneStem = htmlName.endsWith('.standalone.html')
    ? htmlName.slice(0, -'.standalone.html'.length)
    : path.basename(htmlName, '.html');
  const htmlStem = htmlName.replace(/\.html$/i, '');
  return [...new Set([`${standaloneStem}-assets`, `${htmlStem}-assets`])];
}

function toPosixRel(resultsRoot: string, abs: string): string {
  return path.relative(resultsRoot, abs).split(path.sep).join('/');
}

function walkFiles(dir: string, resultsRoot: string, out: string[]): void {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const abs = path.join(dir, name);
    if (isJobsPath(abs, resultsRoot) || isForbiddenAbs(abs, resultsRoot)) continue;
    if (!isInsideDir(abs, resultsRoot) && abs !== path.resolve(resultsRoot)) continue;
    let st: fs.Stats;
    try {
      st = fs.lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      walkFiles(abs, resultsRoot, out);
      continue;
    }
    if (st.isFile()) out.push(abs);
  }
}

export function planStandalonePrune(opts: {
  resultsRoot: string;
  includeHtml?: boolean;
  assets?: boolean;
}): StandalonePlan {
  const resultsRoot = path.resolve(opts.resultsRoot);
  const missing = !fs.existsSync(resultsRoot);
  const htmlItems: PruneItem[] = [];
  const assetItems: PruneItem[] = [];
  const skippedHtml: string[] = [];
  if (missing) {
    return { resultsRoot, missing, htmlItems, assetItems, skippedHtml };
  }

  const files: string[] = [];
  walkFiles(resultsRoot, resultsRoot, files);

  const htmlTargets: string[] = [];
  for (const abs of files) {
    const name = path.basename(abs);
    const rel = toPosixRel(resultsRoot, abs);
    if (isStandaloneHtmlName(name)) {
      htmlTargets.push(abs);
      htmlItems.push({
        rel,
        abs,
        bytes: measurePathBytes(abs),
        reason: 'standalone HTML（可用客户报告 --inline-assets 再生成）',
      });
      continue;
    }
    if (opts.includeHtml && name.endsWith('.html') && CUSTOMER_HTML_RE.test(rel)) {
      htmlTargets.push(abs);
      htmlItems.push({
        rel,
        abs,
        bytes: measurePathBytes(abs),
        reason: '客户报告 HTML（已显式 --include-html）',
      });
      continue;
    }
    if (name.endsWith('.html') && CUSTOMER_HTML_RE.test(rel)) {
      skippedHtml.push(rel);
    }
  }

  if (opts.assets) {
    const seen = new Set<string>();
    for (const htmlAbs of htmlTargets) {
      const dir = path.dirname(htmlAbs);
      for (const assetName of pairedAssetDirNames(path.basename(htmlAbs))) {
        const abs = path.join(dir, assetName);
        if (seen.has(abs)) continue;
        if (isForbiddenAbs(abs, resultsRoot) || !isInsideDir(abs, resultsRoot)) continue;
        if (!fs.existsSync(abs)) continue;
        let st: fs.Stats;
        try {
          st = fs.lstatSync(abs);
        } catch {
          continue;
        }
        if (!st.isDirectory() || st.isSymbolicLink()) continue;
        seen.add(abs);
        assetItems.push({
          rel: toPosixRel(resultsRoot, abs),
          abs,
          bytes: measurePathBytes(abs),
          reason: `配对资源目录（--assets，对应 ${path.basename(htmlAbs)}）`,
        });
      }
    }
  }

  htmlItems.sort((a, b) => a.rel.localeCompare(b.rel));
  assetItems.sort((a, b) => a.rel.localeCompare(b.rel));
  skippedHtml.sort();
  return { resultsRoot, missing, htmlItems, assetItems, skippedHtml };
}

function printHelp(): void {
  console.log(`用法: npm run prune:standalone-reports -- [选项]

清理 results/ 下可再生成的 *.standalone.html（含 ui-regression-customer*.standalone.html）。
默认只预览（dry-run），加 --apply 才会删除。默认不删普通 .html。

选项:
  --apply           真正删除 standalone HTML
  --assets          同时删除与本次清理的报告配对的 *-assets 目录（默认关）
  --include-html    同时删除客户报告非 standalone HTML（需显式打开）
  --results=<dir>   结果根目录，默认 results
  -h, --help

不会触碰 screenshots-baseline/、.env、源码、results/jobs。
`);
}

export function runStandalonePrune(argv = process.argv.slice(2), cwd = process.cwd()): number {
  if (hasFlag('help', argv) || hasFlag('h', argv)) {
    printHelp();
    return 0;
  }

  const apply = hasFlag('apply', argv);
  const assets = hasFlag('assets', argv);
  const includeHtml = hasFlag('include-html', argv);
  const resultsRoot = resolveResultsRoot(argv, cwd);
  const plan = planStandalonePrune({ resultsRoot, includeHtml, assets });
  const relRoot = path.relative(cwd, resultsRoot) || resultsRoot;

  printPruneHeader('Standalone 客户报告清理', apply, [
    `目录: ${relRoot}${plan.missing ? '（不存在）' : ''}`,
    `范围: *.standalone.html${includeHtml ? ' + 客户报告 .html' : ''}${assets ? ' + 配对 *-assets' : ''}`,
  ]);

  if (plan.skippedHtml.length && !includeHtml) {
    console.log(`已跳过 ${plan.skippedHtml.length} 个非 standalone 客户报告 HTML（需要 --include-html 才会删）:`);
    for (const rel of plan.skippedHtml.slice(0, 8)) console.log(`  ~ ${rel}`);
    if (plan.skippedHtml.length > 8) console.log(`  … 另有 ${plan.skippedHtml.length - 8} 个`);
    console.log('');
  }

  printPrunePlan([...plan.htmlItems, ...plan.assetItems], apply);
  if (!apply) return 0;

  const result = applyRemovals([...plan.htmlItems, ...plan.assetItems], resultsRoot);
  printApplyResult(result.deleted, result.bytes);
  return 0;
}

if (isDirectRun(import.meta.url)) {
  process.exitCode = runStandalonePrune();
}
