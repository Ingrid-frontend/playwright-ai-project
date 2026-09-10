import path from 'path';
import type { DiffRegion, ImageComparison } from './image-diff.js';
import { isActionableNature, type ChangeNature } from './change-nature.js';
import type { ScreenshotInfo } from './compare-screenshots-utils.js';
import { sortScreenshotsByRunTime } from './compare-screenshots-utils.js';
import { resolveCustomerReportConfig } from './ui-regression-config.js';
import { regionZoneLabel } from './customer-report-naming.js';
import { detectPageStateDrift, readStepMeta, type PageStateDriftResult } from './page-state-drift.js';

/**
 * 客户口径的四档判定：
 * - pass      与验收基线一致（含可忽略的渲染抖动）
 * - minor     有变化但范围很小，通常是字体渲染/滚动条/时间戳，仅告知
 * - regress   明显衰退，需要处理
 * - uncovered 无验收基线，未做对比
 */
export type CoverageStatus = 'pass' | 'minor' | 'regress' | 'uncovered';

/**
 * 客户可见的业务影响档位（与内部四档 status 解耦）：
 * - blocking 阻断：内容真的变了且达到阻断阈值，需修复后才能验收（对应 status=regress）
 * - degraded 影响体验：内容确实有变化但范围小，操作仍可完成，建议修复、可协商延期
 * - benign   可忽略：内容本身没变（整体位移/渲染差异/测试数据漂移），不需要客户处理
 *
 * 三者之和 = 已对比步骤数。引入它的原因：此前只有 regress / minor 两档，
 * 「表格最后一行被遮挡无法点击」与「整体平移 9px」同为 minor，严重度被抹平。
 */
export type ImpactTier = 'blocking' | 'degraded' | 'benign';

export const IMPACT_TIER_LABEL: Record<ImpactTier, string> = {
  blocking: '需要修复',
  degraded: '影响体验',
  benign: '可忽略',
};

export const IMPACT_TIER_ORDER: Record<ImpactTier, number> = {
  blocking: 3,
  degraded: 2,
  benign: 1,
};

export interface DiffEvidence {
  /** 触发当前判定的原因，用于报告直接展示 */
  reason: string;
  /** 客户可见的业务影响档位，由判定分支直接给出，避免展示层二次猜测 */
  impactTier: ImpactTier;
  /** 最大差异块（已排除 low 噪声） */
  topRegionPixels: number;
  topRegionWidth: number;
  topRegionHeight: number;
  significantRegions: number;
  /** 其中属于「内容真的变了」的区域数；位移/渲染差异不计入 */
  actionableRegions: number;
  /** 主导变化性质，用于报告标签与红框着色 */
  dominantNature?: ChangeNature;
  /** 位移量描述，如 `6px`，仅当主导性质为位移时有值 */
  shiftLabel?: string;
  /** 页面状态漂移（侧栏/列表数据变化），已降级为无需处理 */
  stateDrift?: boolean;
}

export interface CoverageSlot {
  scriptKey: string;
  stepNumber: number;
  stepName: string;
  browser: string;
  status: CoverageStatus;
  difference?: number;
  compareKind?: string;
  baselinePath?: string;
  currentPath?: string;
  overlayPath?: string;
  diffImagePath?: string;
  regions?: ImageComparison['regions'];
  sizeMismatch?: boolean;
  pageTitle: string;
  /** 对比图尺寸，用于把差异区换算成「页面上部/右侧」等方位描述 */
  regionsWidth?: number;
  regionsHeight?: number;
  /** before / skipped 等过程截图，不作为验收结论 */
  processOnly: boolean;
  evidence?: DiffEvidence;
}

export interface CoverageStats {
  expectedSteps: number;
  comparedSteps: number;
  uncoveredSteps: number;
  passSteps: number;
  minorSteps: number;
  regressSteps: number;
  /** minorSteps 的拆分：内容确实有变化但未阻断操作（建议修复、可协商延期） */
  degradedSteps: number;
  /** minorSteps 的拆分：内容本身没变（位移/渲染/数据漂移），不需要客户处理；不含完全一致步骤 */
  benignSteps: number;
  /**
   * (passSteps + benignSteps) / comparedSteps。
   * 注意：分子只含「完全没有实质变化」的步骤。此前的实现把全部 minor 计入分子，
   * 导致 26 处差异也能显示 100% 通过率，属于口径粉饰。
   */
  passRate: number;
  verdict: 'pass' | 'attention' | 'regress' | 'insufficient_coverage';
  verdictLabel: string;
  slots: CoverageSlot[];
}

/** 从 slot 取业务影响档位；无证据数据时按 status 保守回落 */
export function impactTierOf(slot: CoverageSlot): ImpactTier {
  if (slot.evidence?.impactTier) return slot.evidence.impactTier;
  if (slot.status === 'regress') return 'blocking';
  if (slot.status === 'pass' || slot.status === 'uncovered') return 'benign';
  return 'degraded';
}

function isBaselineKind(kind?: string): boolean {
  return kind === 'golden' || kind === 'last-green';
}

/** before / skipped / action 类中间态截图：可用于排查，但不作为验收结论 */
export function isProcessOnlyStep(stepName: string, metaState?: string): boolean {
  const state = String(metaState || '').toLowerCase();
  if (state === 'before' || state === 'skipped') return true;
  return /-(before|skipped)(__|$)/i.test(String(stepName || ''));
}

/**
 * 贴近右/下边缘的窄长条通常是滚动条出现/消失，属于内容高度变化的副作用，
 * 不是客户关心的 UI 衰退，判定时剔除。
 */
function isScrollbarRegion(
  r: DiffRegion,
  width: number | undefined,
  height: number | undefined,
  maxThickness: number,
): boolean {
  if (!width || !height) return false;
  const nearRight = r.x + r.w >= width - maxThickness;
  const nearBottom = r.y + r.h >= height - maxThickness;
  const isVerticalBar = r.w <= maxThickness && r.h >= height * 0.3;
  const isHorizontalBar = r.h <= maxThickness && r.w >= width * 0.3;
  return (nearRight && isVerticalBar) || (nearBottom && isHorizontalBar);
}

function filterScrollbarRegions(
  regions: DiffRegion[],
  width: number | undefined,
  height: number | undefined,
  cfg: ReturnType<typeof resolveCustomerReportConfig>,
): DiffRegion[] {
  return regions.filter(
    (r) =>
      !cfg.ignoreScrollbarRegions ||
      !isScrollbarRegion(r, width, height, cfg.scrollbarMaxThickness),
  );
}

/** 过滤掉噪声区域，返回真正值得客户看的变化块 */
export function significantRegions(
  regions: DiffRegion[] | undefined,
  width?: number,
  height?: number,
  cfg = resolveCustomerReportConfig(),
): DiffRegion[] {
  return filterScrollbarRegions(regions || [], width, height, cfg)
    .filter((r) => r.severity !== 'low')
    .sort((a, b) => b.pixels - a.pixels);
}

/**
 * 报告标注用区域：判定仍走 significantRegions；
 * 展示时若仅有 low 级差异也回退标出，避免「像素差异有亮点但标注变化空白」。
 */
export function displayRegions(
  regions: DiffRegion[] | undefined,
  width?: number,
  height?: number,
  difference = 0,
  cfg = resolveCustomerReportConfig(),
  limit = 6,
): DiffRegion[] {
  const significant = significantRegions(regions, width, height, cfg);
  if (significant.length > 0) return significant.slice(0, limit);
  if (difference <= 0) return [];
  return filterScrollbarRegions(regions || [], width, height, cfg)
    .sort((a, b) => b.pixels - a.pixels)
    .slice(0, limit);
}

/** 变化性质未知时（旧缓存 / 未识别）保守当作实质变化，避免悄悄降级真实衰退 */
function isActionableRegion(r: DiffRegion): boolean {
  return !r.nature || isActionableNature(r.nature);
}

/** 客户可读的变化动词短语，替代内部「内容变化/位置偏移」等名词，避免「一块区域内容变化」这种拗口表达 */
function natureVerb(nature?: ChangeNature): string {
  switch (nature) {
    case 'appeared':
      return '新增了内容';
    case 'vanished':
      return '缺少了内容';
    case 'content':
      return '内容发生了变化';
    case 'shifted':
      return '位置发生偏移';
    case 'rendering':
      return '显示效果有差别';
    default:
      return '内容发生了变化';
  }
}

function shiftLabelOf(regions: DiffRegion[]): string | undefined {
  const shifts = regions
    .filter((r) => r.nature === 'shifted')
    .map((r) => Math.max(Math.abs(r.shiftX ?? 0), Math.abs(r.shiftY ?? 0)))
    .filter((n) => n > 0);
  if (shifts.length === 0) return undefined;
  return `${Math.max(...shifts)}px`;
}

/**
 * 客户口径分级：以「变化性质」为第一依据，「成块面积」为第二依据。
 *
 * 关键点：像素差异量无法区分「内容真的变了」和「同样内容挪了几像素」。
 * 后者对客户没有任何风险，回读原图对齐后残差接近 0 即可证明，
 * 所以只有 appeared / vanished / content 这三类性质才允许标红。
 * 整页占比只作为放大信号，不能单独把位移或渲染差异升级为衰退。
 */
export function classifyDifference(
  difference: number,
  regions: ImageComparison['regions'],
  cfg = resolveCustomerReportConfig(),
  size?: { width?: number; height?: number },
  pageStateDrift?: PageStateDriftResult,
): { status: Exclude<CoverageStatus, 'uncovered'>; evidence: DiffEvidence } {
  const significant = significantRegions(regions, size?.width, size?.height, cfg);
  const actionable = significant.filter(isActionableRegion);
  const top = actionable[0] ?? significant[0];
  // 保守默认值：任何分支都必须显式覆写，遗漏时按「影响体验」而非「可忽略」处理
  const evidence: DiffEvidence = {
    reason: '',
    impactTier: 'degraded',
    topRegionPixels: top?.pixels ?? 0,
    topRegionWidth: top?.w ?? 0,
    topRegionHeight: top?.h ?? 0,
    significantRegions: significant.length,
    actionableRegions: actionable.length,
    dominantNature: top?.nature,
  };

  if (difference <= 0) {
    evidence.reason = '与验收基线完全一致';
    evidence.impactTier = 'benign';
    return { status: 'pass', evidence };
  }
  // 没有区域数据（旧缓存 / 仅算了占比的对比）时无法做证据判定，退回占比口径，
  // 宁可标红也不要把真实衰退悄悄降级。
  if (!regions) {
    if (difference >= cfg.majorRatio) {
      evidence.reason = `页面整体有明显差异（约 ${(difference * 100).toFixed(2)}%）`;
      evidence.impactTier = 'blocking';
      return { status: 'regress', evidence };
    }
    evidence.reason =
      difference < cfg.identicalRatio
        ? '仅有极细微的显示差别，可忽略'
        : `页面整体有轻微差异（约 ${(difference * 100).toFixed(2)}%）`;
    evidence.impactTier = difference < cfg.identicalRatio ? 'benign' : 'degraded';
    return { status: difference < cfg.identicalRatio ? 'pass' : 'minor', evidence };
  }
  if (significant.length === 0) {
    evidence.reason =
      difference < cfg.identicalRatio
        ? '仅有极细微的显示差别，可忽略'
        : '差异很小，未发现明显的内容变化';
    evidence.impactTier = 'benign';
    return { status: difference < cfg.identicalRatio ? 'pass' : 'minor', evidence };
  }

  // 所有成块变化都只是位移或渲染差异：内容本身没变，客户无需处理
  if (actionable.length === 0) {
    const shift = shiftLabelOf(significant);
    evidence.shiftLabel = shift;
    const where = regionZoneLabel(significant[0]!, size?.width, size?.height);
    evidence.reason = shift
      ? `${where}的内容没变，只是整体挪了约 ${shift}，无需处理`
      : `${where}的显示效果有细微差别，内容没变，无需处理`;
    evidence.impactTier = 'benign';
    return { status: 'minor', evidence };
  }

  const bigBlock = top.pixels >= cfg.majorRegionPixels;
  const wideBlock = top.w >= cfg.majorRegionMinWidth && top.h >= cfg.majorRegionMinHeight;
  const where = regionZoneLabel(top, size?.width, size?.height);

  const downgradeDrift = (reason: string): { status: 'minor'; evidence: DiffEvidence } => {
    evidence.reason = reason;
    evidence.stateDrift = true;
    evidence.impactTier = 'benign';
    return { status: 'minor', evidence };
  };

  if (pageStateDrift?.drift) {
    return downgradeDrift(pageStateDrift.reason || '页面状态与基线不一致，差异多为环境数据漂移');
  }

  if (bigBlock) {
    evidence.reason = `${where}有一大块区域${natureVerb(top.nature)}`;
    evidence.impactTier = 'blocking';
    return { status: 'regress', evidence };
  }
  if (wideBlock) {
    evidence.reason = `${where}整块区域${natureVerb(top.nature)}`;
    evidence.impactTier = 'blocking';
    return { status: 'regress', evidence };
  }
  const multiSpotMin = cfg.multiSpotRegressRatio ?? 0.01;
  if (difference >= cfg.majorRatio && actionable.length >= 3 && difference >= multiSpotMin) {
    evidence.reason = `页面有 ${actionable.length} 处内容变化，最大在${where}`;
    evidence.impactTier = 'blocking';
    return { status: 'regress', evidence };
  }

  // 内容确实变了，但没到阻断阈值：与「只是挪了位置」区分开，避免严重度被抹平
  evidence.reason = `页面有 ${actionable.length} 处小范围内容变化，最大在${where}，不影响整体布局`;
  evidence.impactTier = 'degraded';
  return { status: 'minor', evidence };
}

function pickLatestPerBrowserStep(shots: ScreenshotInfo[]): ScreenshotInfo[] {
  const groups = new Map<string, ScreenshotInfo[]>();
  for (const s of shots) {
    const browser = s.browser || 'chrome';
    const key = `${s.stepName}::${browser}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const out: ScreenshotInfo[] = [];
  for (const list of groups.values()) {
    const sorted = sortScreenshotsByRunTime(list);
    const latest = sorted[sorted.length - 1];
    if (latest) out.push(latest);
  }
  return out;
}

function pageTitleFromStep(stepName: string, scriptKey: string): string {
  const i = stepName.indexOf('__');
  if (i > 0) return stepName.slice(0, i);
  if (stepName && stepName !== 'step') return stepName;
  const base = scriptKey.split('/').pop() || scriptKey;
  return base;
}

function findBaselineComp(
  comps: ImageComparison[] | undefined,
  slot: ScreenshotInfo,
): ImageComparison | undefined {
  const list = (comps || []).filter((c) => isBaselineKind(c.compareKind));
  const browser = slot.browser || 'chrome';
  const base = path.basename(slot.path);
  return list.find(
    (c) =>
      (c.browser || 'chrome') === browser &&
      (c.image2Path === slot.relativePath || path.basename(c.image2Path || '') === base),
  );
}

export function buildCoverageStats(
  testDirComparisons: Array<{
    testDir: string;
    comparisons: Array<{
      stepNumber: number;
      optimizedScreenshots?: ScreenshotInfo[];
      baselineComparisons?: ImageComparison[];
    }>;
  }>,
  opts?: { warningRatio?: number },
): CoverageStats {
  const cfg = resolveCustomerReportConfig();
  if (typeof opts?.warningRatio === 'number') cfg.majorRatio = opts.warningRatio;
  const slots: CoverageSlot[] = [];

  for (const tdc of testDirComparisons) {
    for (const comp of tdc.comparisons) {
      const latestSlots = pickLatestPerBrowserStep(comp.optimizedScreenshots || []);
      for (const shot of latestSlots) {
        const browser = shot.browser || 'chrome';
        const hit = findBaselineComp(comp.baselineComparisons, shot);
        const pageTitle = pageTitleFromStep(shot.stepName, tdc.testDir);
        const processOnly = isProcessOnlyStep(shot.stepName, shot.route);
        if (!hit) {
          slots.push({
            scriptKey: tdc.testDir,
            stepNumber: comp.stepNumber,
            stepName: shot.stepName,
            browser,
            status: 'uncovered',
            currentPath: shot.relativePath,
            pageTitle,
            processOnly,
          });
          continue;
        }
        const difference = hit.difference ?? 0;
        const size = { width: hit.width, height: hit.height };
        const pageStateDrift = detectPageStateDrift({
          baselineMeta: readStepMeta(hit.image1Path),
          currentMeta: readStepMeta(hit.image2Path),
          regions: hit.regions,
          ...size,
        });
        const { status, evidence } = classifyDifference(difference, hit.regions, cfg, size, pageStateDrift);
        slots.push({
          scriptKey: tdc.testDir,
          stepNumber: comp.stepNumber,
          stepName: shot.stepName,
          browser,
          status,
          difference,
          compareKind: hit.compareKind,
          baselinePath: hit.image1Path,
          currentPath: hit.image2Path,
          overlayPath: hit.overlayImagePath,
          diffImagePath: hit.diffImagePath,
          regions: hit.regions,
          sizeMismatch: hit.sizeMismatch,
          pageTitle,
          regionsWidth: hit.width,
          regionsHeight: hit.height,
          processOnly,
          evidence,
        });
      }
    }
  }

  const expectedSteps = slots.length;
  const uncoveredSteps = slots.filter((s) => s.status === 'uncovered').length;
  const passSteps = slots.filter((s) => s.status === 'pass').length;
  const minorSteps = slots.filter((s) => s.status === 'minor').length;
  const regressSteps = slots.filter((s) => s.status === 'regress').length;
  const comparedSteps = passSteps + minorSteps + regressSteps;
  // 三档之和 === comparedSteps：blocking=regressSteps，degraded+benign=minorSteps
  const benignSteps = slots.filter(
    (s) => s.status === 'minor' && impactTierOf(s) === 'benign',
  ).length;
  const degradedSteps = minorSteps - benignSteps;
  // 只把「完全没有实质变化」的步骤计入分子（完全一致 + 内容未变的可忽略差异），
  // 避免 26 处差异仍显示 100% 通过率这种口径粉饰
  const passRate = comparedSteps > 0 ? (passSteps + benignSteps) / comparedSteps : 0;

  let verdict: CoverageStats['verdict'];
  let verdictLabel: string;
  if (regressSteps > 0) {
    verdict = 'regress';
    verdictLabel = `发现 ${regressSteps} 处需要处理的 UI 衰退`;
  } else if (comparedSteps === 0) {
    verdict = 'insufficient_coverage';
    verdictLabel = '覆盖不足，无法判定全部通过';
  } else if (expectedSteps === 0) {
    verdict = 'insufficient_coverage';
    verdictLabel = '无可检测步骤';
  } else if (minorSteps > 0) {
    verdict = 'attention';
    verdictLabel =
      degradedSteps > 0
        ? `存在 ${minorSteps} 处差异（${degradedSteps} 处内容确实有变化），建议人工确认`
        : `存在 ${minorSteps} 处可忽略差异（内容未变），建议人工确认`;
  } else {
    verdict = 'pass';
    verdictLabel = '未发现 UI 衰退';
  }

  return {
    expectedSteps,
    comparedSteps,
    uncoveredSteps,
    passSteps,
    minorSteps,
    regressSteps,
    degradedSteps,
    benignSteps,
    passRate,
    verdict,
    verdictLabel,
    slots,
  };
}
