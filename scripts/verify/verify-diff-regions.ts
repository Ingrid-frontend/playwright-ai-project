/**
 * 用真实基线/当前截图对验证区域聚类：确认差异区不再退化为整页框。
 * 用法: npx tsx scripts/verify/verify-diff-regions.ts [issueIndex]
 */
import fs from 'fs';
import path from 'path';
import { compareImagesWithDiff } from '../report/image-diff.js';

async function main() {
  const idx = Number(process.argv[2] || 0);
  const issuesPath = path.resolve('results/ui-issues.json');
  if (!fs.existsSync(issuesPath)) {
    console.error('缺少 results/ui-issues.json，请先运行 npm run compare-screenshots');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(issuesPath, 'utf-8')) as {
    issues?: Array<{ baselinePath?: string; currentPath?: string; stepName?: string }>;
  };
  const issue = (data.issues || [])[idx];
  if (!issue?.baselinePath || !issue?.currentPath) {
    console.error(`issues[${idx}] 缺少基线或当前截图路径`);
    process.exit(1);
  }

  const resolveFromResults = (p: string) => path.resolve('results', p);
  const img1 = resolveFromResults(issue.baselinePath);
  const img2 = resolveFromResults(issue.currentPath);
  for (const p of [img1, img2]) {
    if (!fs.existsSync(p)) {
      console.error(`图片不存在: ${p}`);
      process.exit(1);
    }
  }

  const outDir = path.resolve('results/tmp-verify');
  fs.mkdirSync(outDir, { recursive: true });
  const result = await compareImagesWithDiff(img1, img2, path.join(outDir, 'diff.png'), 0.1, {
    includeAA: false,
  });

  const total = (result.width || 0) * (result.height || 0);
  const regions = result.regions || [];
  console.log(`step: ${issue.stepName}`);
  console.log(`size: ${result.width}x${result.height}  difference: ${(result.difference * 100).toFixed(3)}%`);
  console.log(`regions: ${regions.length}`);
  for (const r of regions.slice(0, 8)) {
    console.log(
      `  [${r.severity}] x=${r.x} y=${r.y} ${r.w}x${r.h} pixels=${r.pixels} ratio=${(r.ratio * 100).toFixed(3)}%`,
    );
  }
  const fullPage = regions.some((r) => r.w >= (result.width || 0) && r.h >= (result.height || 0));
  console.log(`全页误判: ${fullPage ? '是（仍有 bug）' : '否'}`);
  console.log(`区域像素合计占比: ${((regions.reduce((s, r) => s + r.pixels, 0) / total) * 100).toFixed(3)}%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
