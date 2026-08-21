/**
 * 差异性质探针：对每个差异区，读取基线/当前的真实像素，判断这块变化到底是什么。
 *
 * 目的是回答「差异不大却标红」是否属于误判：
 * - shift    : 区域内容整体位移（同样的图形挪了几像素），常见于布局微调，不是内容错误
 * - textEdge : 只有笔画边缘变化，字形轮廓一致，属于字体渲染/抗锯齿
 * - content  : 区域内真的出现/消失/替换了内容（客户要看的衰退）
 * - appear/vanish: 一侧几乎空白，另一侧有内容
 *
 * 用法: npx tsx scripts/verify/probe-change-nature.ts
 */
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import {
  getAllScreenshots,
  generateTestComparisons,
  type TestDirComparisons,
} from '../report/compare-screenshots-engine.js';
import { discoverScriptScanTargets } from '../report/compare-screenshots-scan.js';
import { buildCoverageStats } from '../report/coverage-stats.js';

type Px = { r: number; g: number; b: number };

function readPng(p: string): PNG | null {
  try {
    return PNG.sync.read(fs.readFileSync(p));
  } catch {
    return null;
  }
}

function at(png: PNG, x: number, y: number): Px {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return { r: 255, g: 255, b: 255 };
  const i = (png.width * y + x) << 2;
  return { r: png.data[i]!, g: png.data[i + 1]!, b: png.data[i + 2]! };
}

function lum(p: Px): number {
  return 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
}

/** 区域内「有墨」的像素比例：用于判断一侧是否空白 */
function inkRatio(png: PNG, r: { x: number; y: number; w: number; h: number }): number {
  let ink = 0;
  let total = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      total++;
      if (lum(at(png, x, y)) < 235) ink++;
    }
  }
  return total > 0 ? ink / total : 0;
}

/** 平均绝对差 */
function mad(
  a: PNG,
  b: PNG,
  r: { x: number; y: number; w: number; h: number },
  dx = 0,
  dy = 0,
): number {
  let sum = 0;
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const pa = at(a, x, y);
      const pb = at(b, x + dx, y + dy);
      sum += Math.abs(lum(pa) - lum(pb));
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** 在 ±maxShift 内找最优位移，返回 (bestMad, dx, dy) */
function bestShift(
  a: PNG,
  b: PNG,
  r: { x: number; y: number; w: number; h: number },
  maxShift = 6,
): { mad: number; dx: number; dy: number } {
  let best = { mad: Infinity, dx: 0, dy: 0 };
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      const m = mad(a, b, r, dx, dy);
      if (m < best.mad) best = { mad: m, dx, dy };
    }
  }
  return best;
}

async function main() {
  const targets = discoverScriptScanTargets('screenshots');
  const testDirComparisons: TestDirComparisons[] = [];
  for (const { testDir, scriptPath } of targets) {
    const shots = getAllScreenshots(scriptPath, 'optimized', 'results/tmp.html');
    if (shots.size === 0) continue;
    testDirComparisons.push({
      testDir,
      comparisons: await generateTestComparisons(testDir, shots, 'results/tmp.html'),
    });
  }

  const coverage = buildCoverageStats(testDirComparisons);
  const interesting = coverage.slots.filter(
    (s) => (s.status === 'regress' || s.status === 'minor') && s.regions?.length,
  );

  console.log(`\n=== 差异性质探针（${interesting.length} 个有差异的步骤）===\n`);
  for (const slot of interesting) {
    const base = slot.baselinePath ? readPng(path.resolve('results', slot.baselinePath)) : null;
    const cur = slot.currentPath ? readPng(path.resolve('results', slot.currentPath)) : null;
    if (!base || !cur) {
      console.log(`[skip] ${slot.stepName} 读图失败`);
      continue;
    }
    console.log(
      `--- ${slot.pageTitle} / ${slot.stepName} [${slot.status}] 差异 ${((slot.difference || 0) * 100).toFixed(2)}%`,
    );
    const regions = (slot.regions || []).filter((r) => r.severity !== 'low').slice(0, 6);
    for (const r of regions) {
      const inkA = inkRatio(base, r);
      const inkB = inkRatio(cur, r);
      const m0 = mad(base, cur, r);
      const bs = bestShift(base, cur, r);
      const shiftGain = m0 > 0 ? 1 - bs.mad / m0 : 0;

      let nature = 'content';
      if (inkA < 0.01 && inkB > 0.05) nature = 'appear';
      else if (inkB < 0.01 && inkA > 0.05) nature = 'vanish';
      else if ((bs.dx !== 0 || bs.dy !== 0) && shiftGain > 0.55 && bs.mad < 12) nature = 'shift';
      else if (m0 < 18 && Math.abs(inkA - inkB) < 0.04) nature = 'textEdge';

      console.log(
        `    ${r.w}x${r.h}@${r.x},${r.y} pixels=${r.pixels} | ink ${inkA.toFixed(3)}->${inkB.toFixed(3)} | mad ${m0.toFixed(1)} | bestShift d=(${bs.dx},${bs.dy}) mad=${bs.mad.toFixed(1)} gain=${(shiftGain * 100).toFixed(0)}% => probe:${nature} | engine:${r.nature ?? '未识别'}`,
      );
    }
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
