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

/** 差异区坐标缺失时不报错，退回笼统方位描述 */
function safeZone(
  r: { x?: number; y?: number; w?: number; h?: number },
  width?: number,
  height?: number,
): string {
  const { x, y, w, h } = r;
  if (x === undefined || y === undefined || w === undefined || h === undefined) return '页面局部';
  return regionZoneLabel({ x, y, w, h }, width, height);
}

export function stripTechnicalNoise(text: string): string {
  return text
    .replace(/（整页差异 [\d.]+%）/g, '')
    .replace(/整页差异 [\d.]+%[，,]?/g, '')
    .replace(/与验收基线/g, '与上次验收标准')
    .replace(/验收基线/g, '上次验收标准')
    .replace(/仅字体渲染存在细微差异/g, '仅显示效果有细微差别')
    .replace(/字体渲染\/抗锯齿[^，。]*/g, '显示效果有细微差别')
    .replace(/字体渲染[^，。]*/g, '显示效果有细微差别')
    .replace(/样式回归/g, '界面变化')
    .replace(/监控区域/g, '主要区域')
    .replace(/渲染抖动/g, '显示效果差别')
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
        return `${head}页面内容和上次验收一致，整体位置偏移约 ${card.shiftLabel}，无需处理`;
      }
      return `${head}页面内容和上次验收一致，仅显示效果有细微差别，无需处理`;
    }
    const top = actionable[0];
    if (top) {
      const zone = safeZone(top, card.imageWidth || 0, card.imageHeight || 0);
      const what = natureToPlain(top.natureLabel);
      if (actionable.length === 1) {
        return `${head}${zone}${what}，变化较小，内容与上次验收一致，无需处理`;
      }
      return `${head}页面有 ${actionable.length} 处细微差异（如${zone}${what}），内容与上次验收一致，无需处理`;
    }
    const body = stripTechnicalNoise(card.plainText);
    return `${head}${body || '页面有细微差异，内容与上次验收一致，无需处理'}`;
  }

  if (card.verdict === 'regress') {
    if (actionable.length === 1) {
      const r = actionable[0];
      const zone = safeZone(r, card.imageWidth || 0, card.imageHeight || 0);
      return `${head}${zone}${natureToPlain(r.natureLabel)}，与上次验收标准不一致，需要修复`;
    }
    if (actionable.length > 1) {
      const bits = actionable.slice(0, 2).map((r) => {
        const zone = safeZone(r, card.imageWidth || 0, card.imageHeight || 0);
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

/**
 * 未覆盖步骤占比达到该值即视为「覆盖不足」：即使已检测部分全部通过，
 * 结论也不给绿色，发版建议降级为「补基线」，避免「35% 没测却说可发版」误导客户。
 */
export const COVERAGE_GAP_RATIO = 0.3;

/**
 * 统一结论标题口径。HTML 报告与摘要 JSON 必须共用这一份，
 * 否则会出现飞书消息与网页各说各话的结论打架。
 *
 * 标题动词必须与 deriveShipAdvice 的动作一致：此前标题写「无需处理」、
 * 副标题又写「建议业务确认」，同一屏自相矛盾。
 */
export function buildHeadline(coverage: CoverageStats, regressionGroupCount: number): string {
  const c = coverage;
  if (c.regressSteps > 0) return `发现 ${regressionGroupCount} 个问题需要修复`;
  if (c.minorSteps > 0) {
    const { advice } = deriveShipAdvice(c);
    if (advice === 'baseline') {
      return `检测覆盖不足：${c.uncoveredSteps} 步未建基线，建议补基线后再验收`;
    }
    const detail =
      c.degradedSteps > 0
        ? `${c.minorSteps} 处差异，其中 ${c.degradedSteps} 处内容确实有变化`
        : `${c.minorSteps} 处可忽略差异，页面内容未变`;
    return `存在 ${detail}，建议确认后发布`;
  }
  if (c.comparedSteps === 0) return '本次无有效对比，无法给出结论';
  if (c.uncoveredSteps > 0) return `已检测 ${c.comparedSteps} 步全部通过，${c.uncoveredSteps} 步未建基线`;
  return '本次未发现需要修复的问题';
}

export function deriveShipAdvice(coverage: CoverageStats): { advice: ShipAdvice; label: string } {
  if (coverage.comparedSteps === 0) {
    return { advice: 'baseline', label: '尚无有效对比，需先建立验收基线' };
  }
  if (coverage.regressSteps > 0) {
    return { advice: 'fix', label: '建议修复后再验收' };
  }
  const uncoveredRatio = coverage.uncoveredSteps / Math.max(1, coverage.expectedSteps);
  if (uncoveredRatio >= COVERAGE_GAP_RATIO) {
    return { advice: 'baseline', label: '检测覆盖不足，建议补充验收基线后再验收' };
  }
  if (coverage.minorSteps > 0) {
    return { advice: 'confirm', label: '未发现阻断问题，建议确认可接受差异后发布' };
  }
  if (coverage.uncoveredSteps > 0) {
    return {
      advice: 'ship',
      label: `已对比 ${coverage.comparedSteps} 步未发现问题；另有 ${coverage.uncoveredSteps} 步缺少基线，建议补齐后确认`,
    };
  }
  return { advice: 'ship', label: '可以发版' };
}

export function buildActionItems(model: CustomerReportModel): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  const c = model.coverage;
  for (const entry of model.regressionDisplay) {
    const item =
      entry.kind === 'shared'
        ? `修复「${entry.title}」：${entry.reason || '公共布局与验收基线不一致'}（涉及：${entry.stepTitles.join('、')}）`
        : `修复「${entry.group.title}」：${entry.group.reason || '检测到与验收基线不一致'}`;
    if (!seen.has(item)) {
      seen.add(item);
      items.push(item);
    }
  }
  const meaningfulUncovered = model.uncovered.filter((p) => !p.processOnly).length;
  const uncoveredRatio =
    model.coverage.expectedSteps > 0 ? model.coverage.uncoveredSteps / model.coverage.expectedSteps : 0;
  const needsBaseline = uncoveredRatio >= COVERAGE_GAP_RATIO && meaningfulUncovered > 0;
  if (model.regressionGroups.length === 0 && c.minorSteps > 0) {
    const degradedGroups = model.minorGroups.filter((g) => g.impactTier === 'degraded');
    const benignGroups = model.minorGroups.filter((g) => g.impactTier === 'benign');
    if (degradedGroups.length > 0) {
      const sampleReason = degradedGroups[0]?.reason || '';
      const hasListData = sampleReason.includes('列表') || sampleReason.includes('数据');
      const context = hasListData ? '（多为列表数据或内容更新）' : '';
      items.push(
        `${c.degradedSteps} 步内容确实有变化但未阻断操作（按根因归为 ${degradedGroups.length} 个问题）${context}，建议评估后修复`,
      );
    }
    if (benignGroups.length > 0) {
      items.push(`${c.benignSteps} 步仅为位置偏移或显示效果差异，内容未变，无需处理`);
    }
    if (model.accounting.ungroupedSteps > 0) {
      items.push(`另有 ${model.accounting.ungroupedSteps} 步差异极小未单列证据（已计入上方步骤统计）`);
    }
  }
  if (needsBaseline) {
    items.push(`检测覆盖不足，建议优先为 ${meaningfulUncovered} 个核心页面建立验收基线`);
  } else if (model.regressionGroups.length === 0 && c.comparedSteps > 0) {
    if (c.degradedSteps > 0 && c.degradedSteps <= 3) {
      items.push('本次未发现阻断问题；少量内容变化建议业务确认后发布');
    } else if (c.degradedSteps > 3) {
      items.push(`本次未发现阻断问题；${c.degradedSteps} 处内容变化建议分批确认后发布`);
    } else {
      items.push('本次未发现需要修复的问题，可按计划发版');
    }
  }
  return items.slice(0, 5);
}

export function buildPlainDescription(slot: CoverageSlot, width?: number, height?: number): string {
  if (slot.status === 'uncovered') {
    return '尚未建立验收基线，本步骤未纳入对比';
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
      ? `差异 ${pct}%，分散在文字边缘，未发现明显变化`
      : `页面差异 ${pct}%，但未定位到集中变化区`;
  }

  // 全是位移/渲染差异时，说清「内容一致」，避免客户误以为页面坏了
  const shift = slot.evidence?.shiftLabel;
  if (slot.status === 'minor' && slot.evidence?.actionableRegions === 0) {
    return shift
      ? `内容与验收基线完全一致，整体位置挪了约 ${shift}（页面差异 ${pct}%）`
      : `内容与验收基线一致，仅显示效果有细微差别（页面差异 ${pct}%）`;
  }
  if (slot.status === 'minor' && slot.evidence?.stateDrift) {
    const base = stripTechnicalNoise(
      slot.evidence.reason || '页面布局与基线一致，差异多为数据或显示效果导致',
    );
    return `${base}（页面差异 ${pct}%）`;
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
    return `${zone}${what}`;
  });
  const uniqueParts = [...new Set(parts)];
  const lead = slot.status === 'regress' ? '需要修复' : '无需处理';
  return `${lead}：${uniqueParts.join('、')}（页面差异 ${pct}%）`;
}
