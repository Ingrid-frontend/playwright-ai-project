import fs from 'fs';
import path from 'path';
import { isDisabledViewportScreenshot } from './ui-regression-config.js';
import {
  formatDisplayTimestampFromRunDir,
  isLoginScreenshotCandidate,
  type ScreenshotInfo,
} from './compare-screenshots-utils.js';

export const RUN_SEGMENT_DIR = /^run-(chromium|webkit|firefox|safari|edge)-/i;
const BY_ACCOUNT_DIR = 'by-account';

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

function hasByAccountChildren(absDir: string): boolean {
  const p = path.join(absDir, BY_ACCOUNT_DIR);
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

/**
 * 流程截图扫描：存在 by-account/<slug> 时按角色拆分，各角色独立对比，不与其它角色混比。
 */
export function discoverFlowScriptScanTargets(screenshotsDir: string): ScriptScanTarget[] {
  const skipTop = new Set(['results', 'diffs', 'pom']);
  const targets: ScriptScanTarget[] = [];

  function walk(relativeDir: string, absDir: string): void {
    if (hasByAccountChildren(absDir)) {
      for (const slug of fs.readdirSync(path.join(absDir, BY_ACCOUNT_DIR)).filter((f) => !f.startsWith('.'))) {
        const slugAbs = path.join(absDir, BY_ACCOUNT_DIR, slug);
        if (!fs.statSync(slugAbs).isDirectory()) continue;
        const slugRel = relativeDir
          ? path.join(relativeDir, BY_ACCOUNT_DIR, slug)
          : path.join(BY_ACCOUNT_DIR, slug);
        walk(slugRel, slugAbs);
      }
      return;
    }

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
      if (entry === BY_ACCOUNT_DIR) continue;
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

export function getAllScreenshots(dir: string, type: 'pom' | 'optimized', outputPath: string): Map<number, ScreenshotInfo[]> {
  const result = new Map<number, ScreenshotInfo[]>();

  if (!fs.existsSync(dir)) {
    console.log(`⚠️  目录不存在: ${dir}`);
    return result;
  }

  const outputDir = path.dirname(outputPath);
  const relativeDir = path.relative(outputDir, dir);

  function scanDirectory(currentDir: string, currentRelativePath: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    entries.forEach(entry => {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.join(currentRelativePath, entry.name);

      if (entry.isDirectory()) {
        scanDirectory(fullPath, relativePath);
      } else if (entry.isFile() && entry.name.endsWith('.png')) {
        if (isDisabledViewportScreenshot(entry.name)) return;
        const match = entry.name.match(/step-(\d+)-(.+)\.png/);
        if (match) {
          const stepNumber = parseInt(match[1]);
          let stepName = match[2];
          let route = '';

          const metaPath = fullPath.replace(/\.png$/i, '.meta.json');
          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
              if (meta.snapshotName) {
                stepName = String(meta.snapshotName);
                route = meta.state ? String(meta.state) : '';
              }
            } catch {
              /* ignore */
            }
          }

          if (!route) {
            const routeMatch = stepName.match(/^(.+)__(.+)$/);
            if (routeMatch) {
              stepName = routeMatch[1];
              route = routeMatch[2];
            }
          }

          if (isLoginScreenshotCandidate(entry.name, route)) {
            console.log(`    ⚠️  跳过登录页截图，避免污染对比数据: ${entry.name}`);
            return;
          }

          if (!result.has(stepNumber)) {
            result.set(stepNumber, []);
          }

          const browserMatch =
            fullPath.match(/run-(chromium|webkit|firefox|safari|edge)-/i) ||
            fullPath.match(/-(chrome|firefox|safari|edge|webkit|chromium)-/i);
          let browser = browserMatch ? browserMatch[1].toLowerCase() : 'unknown';

          if (browser === 'chromium') {
            browser = 'chrome';
          }
          if (browser === 'unknown' && type === 'optimized') {
            browser = 'chrome';
          }

          const dateMatch = currentDir.match(/^(\d{4}-\d{2}-\d{2})_/);
          const date = dateMatch ? dateMatch[1] : path.basename(currentDir);

          const displayTimestamp = formatDisplayTimestampFromRunDir(path.basename(currentDir));

          result.get(stepNumber)!.push({
            path: fullPath,
            // 输出 HTML 位于 results/ 下，直接基于 fullPath 计算相对路径，避免重复拼接导致路径错误
            relativePath: path.relative(outputDir, fullPath).replaceAll(path.sep, '/'),
            timestamp: path.basename(currentDir),
            date,
            displayTimestamp,
            type,
            stepName,
            browser,
            route
          } as ScreenshotInfo);
        } else {
          console.log(`    ⚠️  文件名不匹配: ${entry.name}`);
        }
      }
    });
  }

  console.log(`📁 开始递归扫描目录: ${dir}`);
  scanDirectory(dir, relativeDir);

  console.log(`✅ ${type} 目录扫描完成: ${result.size} 个步骤`);
  return result;
}
