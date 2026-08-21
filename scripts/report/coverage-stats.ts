import path from 'path';
import type { DiffRegion, ImageComparison } from './image-diff.js';
import { isActionableNature, natureLabel, type ChangeNature } from './change-nature.js';
import type { ScreenshotInfo } from './compare-screenshots-utils.js';
import { sortScreenshotsByRunTime } from './compare-screenshots-utils.js';
import { resolveCustomerReportConfig } from './ui-regression-config.js';
import { regionZoneLabel } from './customer-report-naming.js';

/**
 * 客户口径的四档判定：
 * - pass      与验收基线一致（含可忽略的渲染抖动）
 * - minor     有变化但范围很小，通常是字体渲染/滚动条/时间戳，仅告知
 * - regress   明显衰退，需要处理
 * - uncovered 无验收基线，未做对比
 */
export type CoverageStatus = 'pass' | 'minor' | 'regress' | 'uncovered';

export interface DiffEvidence {
  /** 触发当前判定的原因，用于报告直接展示 */
  reason: string;
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
  /** (passSteps + minorSteps) / comparedSteps；无对比项时为 0 */
  passRate: number;
  verdict: 'pass' | 'attention' | 'regress' | 'insufficient_coverage';
  verdictLabel: string;
  slots: CoverageSlot[];
}

function isBaselineKind(kind?: string): boolean {
  return kind === 'golden' || kind === 'last-green';
}

/** before / skipped / action 类中间态截图：可用于排查，但不作为验收结论 */
export function isProcessOnlyStep(stepName: string): boolean {
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

/** 过滤掉噪声区域，返回真正值得客户看的变化块 */
export function significantRegions(
  regions: DiffRegion[] | undefined,
  width?: number,
  height?: number,
  cfg = resolveCustomerReportConfig(),
): DiffRegion[] {
  return (regions || [])
    .filter((r) => r.severity !== 'low')
    .filter(
      (r) =>
        !cfg.ignoreScrollbarRegions ||
        !isScrollbarRegion(r, width, height, cfg.scrollbarMaxThickness),
    )
    .sort((a, b) => b.pixels - a.pixels);
}

/** 变化性质未知时（旧缓存 / 未识别）保守当作实质变化，避免悄悄降级真实衰退 */
function isActionableRegion(r: DiffRegion): boolean {
  return !r.nature || isActionableNature(r.nature);
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
): { status: Exclude<CoverageStatus, 'uncovered'>; evidence: DiffEvidence } {
  const significant = significantRegions(regions, size?.width, size?.height, cfg);
  const actionable = significant.filter(isActionableRegion);
  const top = actionable[0] ?? significant[0];
  const evidence: DiffEvidence = {
    reason: '',
    topRegionPixels: top?.pixels ?? 0,
    topRegionWidth: top?.w ?? 0,
    topRegionHeight: top?.h ?? 0,
    significantRegions: significant.length,
    actionableRegions: actionable.length,
    dominantNature: top?.nature,
  };

  if (difference <= 0) {
    evidence.reason = '与验收基线完全一致';
    return { status: 'pass', evidence };
  }
  // 没有区域数据（旧缓存 / 仅算了占比的对比）时无法做证据判定，退回占比口径，
  // 宁可标红也不要把真实衰退悄悄降级。
  if (!regions) {
    if (difference >= cfg.majorRatio) {
      evidence.reason = `整页差异 ${(difference * 100).toFixed(2)}%（无区域明细）`;
      return { status: 'regress', evidence };
    }
    evidence.reason =
      difference < cfg.identicalRatio
        ? '仅有可忽略的渲染抖动'
        : `整页差异 ${(difference * 100).toFixed(2)}%，范围很小`;
    return { status: difference < cfg.identicalRatio ? 'pass' : 'minor', evidence };
  }
  if (significant.length === 0) {
    evidence.reason =
      difference < cfg.identicalRatio
        ? '仅有可忽略的渲染抖动'
        : `差异 ${(difference * 100).toFixed(2)}% 全部分散在文字边缘或滚动条，未发现成块变化`;
    return { status: difference < cfg.identicalRatio ? 'pass' : 'minor', evidence };
  }

  // 所有成块变化都只是位移或渲染差异：内容本身没变，客户无需处理
  if (actionable.length === 0) {
    const shift = shiftLabelOf(significant);
    evidence.shiftLabel = shift;
    const where = regionZoneLabel(significant[0]!, size?.width, size?.height);
    evidence.reason = shift
      ? `${where}内容整体平移 ${shift}，逐像素比对后内容完全一致，不是功能问题`
      : `${where}仅有字体渲染/抗锯齿级别的差异，内容未发生变化`;
    return { status: 'minor', evidence };
  }

  const bigBlock = top.pixels >= cfg.majorRegionPixels;
  const wideBlock = top.w >= cfg.majorRegionMinWidth && top.h >= cfg.majorRegionMinHeight;
  const where = regionZoneLabel(top, size?.width, size?.height);
  const what = top.nature ? natureLabel(top.nature) : '内容变化';
  if (bigBlock) {
    evidence.reason = `${where}有一块 ${top.w}x${top.h} 的区域${what}`;
    return { status: 'regress', evidence };
  }
  if (wideBlock) {
    evidence.reason = `${where}整块区域（${top.w}x${top.h}）${what}`;
    return { status: 'regress', evidence };
  }
  if (difference >= cfg.majorRatio && actionable.length >= 3) {
    evidence.reason = `页面有 ${actionable.length} 处内容变化，最大一处在${where}（整页差异 ${(difference * 100).toFixed(2)}%）`;
    return { status: 'regress', evidence };
  }

  evidence.reason = `仅 ${actionable.length} 处小范围${what}，最大一处在${where}（${top.w}x${top.h}），不影响整体布局`;
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
        const processOnly = isProcessOnlyStep(shot.stepName);
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
        const { status, evidence } = classifyDifference(difference, hit.regions, cfg, {
          width: hit.width,
          height: hit.height,
        });
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
  const passRate = comparedSteps > 0 ? (passSteps + minorSteps) / comparedSteps : 0;

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
    verdictLabel = `存在 ${minorSteps} 处轻微变化，建议人工确认`;
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
    passRate,
    verdict,
    verdictLabel,
    slots,
  };
}
