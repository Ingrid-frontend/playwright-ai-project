import { significantRegions, type CoverageSlot, type CoverageStats } from './coverage-stats.js';
import { isActionableNature, natureLabel } from './change-nature.js';
import { regionZoneLabel } from './customer-report-naming.js';
import type { CustomerReportModel } from './customer-report-model.js';

export type ShipAdvice = 'fix' | 'confirm' | 'ship' | 'baseline';

export function deriveShipAdvice(coverage: CoverageStats): { advice: ShipAdvice; label: string } {
  if (coverage.comparedSteps === 0) {
    return { advice: 'baseline', label: '尚无有效对比，需先建立验收基线' };
  }
  if (coverage.regressSteps > 0) {
    return { advice: 'fix', label: '建议修复后再验收' };
  }
  const uncoveredRatio = coverage.uncoveredSteps / Math.max(1, coverage.expectedSteps);
  if (uncoveredRatio > 0.5) {
    return { advice: 'baseline', label: '检测覆盖不足，建议补充验收基线' };
  }
  if (coverage.minorSteps > 0) {
    return { advice: 'confirm', label: '可发版，建议确认轻微变化' };
  }
  return { advice: 'ship', label: '可以发版' };
}

export function buildActionItems(model: CustomerReportModel): string[] {
  const items: string[] = [];
  for (const g of model.regressionGroups) {
    items.push(`修复「${g.title}」：${g.reason || '检测到与验收基线不一致'}`);
  }
  const meaningfulUncovered = model.uncovered.filter((p) => !p.processOnly).length;
  if (model.coverage.uncoveredSteps > model.coverage.comparedSteps * 0.3 && meaningfulUncovered > 0) {
    items.push(`为 ${meaningfulUncovered} 个核心页面建立验收基线，提升检测覆盖率`);
  }
  if (model.minorGroups.length > 0 && model.regressionGroups.length === 0) {
    items.push(`确认 ${model.minorGroups.length} 处轻微变化是否接受（多为位置偏移或字体渲染差异）`);
  }
  if (model.regressionGroups.length === 0 && model.minorGroups.length === 0 && model.coverage.comparedSteps > 0) {
    items.push('本次未发现需要修复的问题，可按计划发版');
  }
  return items.slice(0, 5);
}

export function buildPlainDescription(slot: CoverageSlot, width?: number, height?: number): string {
  if (slot.status === 'uncovered') {
    return '尚无验收基线，本步骤未纳入像素对比';
  }
  if (slot.sizeMismatch) {
    return '截图尺寸与验收基线不一致，无法可靠对比';
  }
  const difference = slot.difference ?? 0;
  const pct = (difference * 100).toFixed(2);
  const imgW = width || slot.regionsWidth;
  const imgH = height || slot.regionsHeight;
  // 与判定口径保持一致：滚动条条带、low 噪声都不写进客户文案
  const regions = significantRegions(slot.regions, imgW, imgH);

  if (slot.status === 'pass') {
    return difference <= 0 ? '与验收基线一致' : `与验收基线基本一致（差异 ${pct}%，可忽略）`;
  }
  if (regions.length === 0) {
    return slot.status === 'minor'
      ? `差异 ${pct}%，分散在文字边缘，未发现成块变化`
      : `整页差异 ${pct}%，但未定位到集中变化区`;
  }

  // 全是位移/渲染差异时，说清「内容一致」，避免客户误以为页面坏了
  const shift = slot.evidence?.shiftLabel;
  if (slot.status === 'minor' && slot.evidence?.actionableRegions === 0) {
    return shift
      ? `内容与验收基线完全一致，整体位置平移了 ${shift}（整页差异 ${pct}%）`
      : `内容与验收基线一致，仅字体渲染存在细微差异（整页差异 ${pct}%）`;
  }

  // 需要处理的卡片先说实质变化，位移/渲染差异往后排
  const ordered = [...regions].sort((a, b) => {
    const aa = !a.nature || isActionableNature(a.nature) ? 0 : 1;
    const bb = !b.nature || isActionableNature(b.nature) ? 0 : 1;
    return aa - bb;
  });
  const parts = ordered.slice(0, 3).map((r) => {
    const zone = regionZoneLabel(r, imgW, imgH);
    const what = r.nature ? natureLabel(r.nature) : '内容变化';
    return `${zone} ${r.w}x${r.h}（${what}）`;
  });
  const lead = slot.status === 'regress' ? '需要修复' : '无需处理';
  return `${lead}：${parts.join('、')}（整页差异 ${pct}%）`;
}
