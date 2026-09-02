import { significantRegions, type CoverageSlot, type CoverageStats } from './coverage-stats.js';
import { isActionableNature, natureLabel } from './change-nature.js';
import { regionZoneLabel } from './customer-report-naming.js';
import type { CustomerReportModel } from './customer-report-model.js';

export type FeedbackRegisterCard = {
  verdict: string;
  plainText: string;
  benignOnly?: boolean;
  actionableRegions?: number;
  shiftLabel?: string;
  regions?: Array<{ actionable: boolean; natureLabel: string; x?: number; y?: number; w?: number; h?: number }>;
  imageWidth?: number;
  imageHeight?: number;
};

function natureToPlain(label: string): string {
  const map: Record<string, string> = {
    新增内容: '多了新内容',
    内容缺失: '少了部分内容',
    内容变化: '内容有变化',
    位置偏移: '位置有偏移',
    渲染差异: '显示效果有差别',
  };
  return map[label] || label;
}

function stripTechnicalNoise(text: string): string {
  return text
    .replace(/（整页差异 [\d.]+%）/g, '')
    .replace(/整页差异 [\d.]+%[，,]?/g, '')
    .replace(/与验收基线/g, '与上次验收标准')
    .replace(/验收基线/g, '上次验收标准')
    .replace(/仅字体渲染存在细微差异/g, '仅显示效果有细微差别')
    .replace(/字体渲染\/抗锯齿[^，。]*/g, '显示效果有细微差别')
    .replace(/字体渲染[^，。]*/g, '显示效果有细微差别')
    .replace(/无需处理：/g, '')
    .replace(/需要修复：/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 客户报告「登记问题」用的单行描述，避免内部判定术语 */
export function buildFeedbackRegisterDescription(
  card: FeedbackRegisterCard,
  opts: { stepLabel: string; browserLabel: string },
): string {
  const head = `【${opts.stepLabel}·${opts.browserLabel}】`;
  const actionable = (card.regions || []).filter((r) => r.actionable);

  if (card.verdict === 'minor') {
    if (card.benignOnly || (card.actionableRegions ?? 0) === 0) {
      if (card.shiftLabel) {
        return `${head}页面内容和上次验收一致，整体位置偏移约 ${card.shiftLabel}，不影响使用`;
      }
      return `${head}页面内容和上次验收一致，仅显示效果有细微差别，不影响使用`;
    }
    const top = actionable[0];
    if (top) {
      const zone = regionZoneLabel(top, card.imageWidth || 0, card.imageHeight || 0);
      const what = natureToPlain(top.natureLabel);
      if (actionable.length === 1) {
        return `${head}${zone}${what}，变化较小，建议确认是否接受`;
      }
      return `${head}页面有 ${actionable.length} 处轻微变化（如${zone}${what}），建议确认是否接受`;
    }
    const body = stripTechnicalNoise(card.plainText);
    return `${head}${body || '页面有轻微变化，建议确认是否接受'}`;
  }

  if (card.verdict === 'regress') {
    if (actionable.length === 1) {
      const r = actionable[0];
      const zone = regionZoneLabel(r, card.imageWidth || 0, card.imageHeight || 0);
      return `${head}${zone}${natureToPlain(r.natureLabel)}，与上次验收标准不一致，需要修复`;
    }
    if (actionable.length > 1) {
      const bits = actionable.slice(0, 2).map((r) => {
        const zone = regionZoneLabel(r, card.imageWidth || 0, card.imageHeight || 0);
        return `${zone}${natureToPlain(r.natureLabel)}`;
      });
      const more = actionable.length > 2 ? `等 ${actionable.length} 处` : '';
      return `${head}页面${bits.join('、')}${more}与上次验收标准不一致，需要修复`;
    }
    const body = stripTechnicalNoise(card.plainText);
    return `${head}${body || '页面与上次验收标准不一致'}，需要修复`;
  }

  return `${head}${stripTechnicalNoise(card.plainText) || '发现页面变化'}`;
}

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
