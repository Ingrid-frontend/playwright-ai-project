import {
  significantRegions,
  type CoverageSlot,
  type CoverageStats,
  type CoverageStatus,
} from './coverage-stats.js';
import { isActionableNature, natureLabel, type ChangeNature } from './change-nature.js';
import { buildPlainDescription } from './customer-report-plain.js';
import { friendlyScriptLabel, friendlyStepLabel } from './customer-report-naming.js';

export type CustomerStatus = CoverageStatus;

/** 报告上的一个标注框 */
export type CustomerRegion = {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  /** 变化性质，用于红框着色与图例 */
  nature?: ChangeNature;
  natureLabel: string;
  /** true 表示需要客户处理；位移/渲染差异为 false */
  actionable: boolean;
};

export type CustomerBrowserCard = {
  browser: 'chrome' | 'webkit' | string;
  browserLabel: string;
  verdict: CustomerStatus;
  verdictLabel: string;
  difference: number;
  differenceLabel: string;
  baselinePath?: string;
  currentPath?: string;
  overlayPath?: string;
  plainText: string;
  /** 判定依据，直接展示给客户，避免「为什么这算衰退」的疑问 */
  reason: string;
  regions: CustomerRegion[];
  /** 需要处理的区域数，用于图例与「仅位移」提示 */
  actionableRegions: number;
  /** 全部变化都只是位移/渲染差异 */
  benignOnly: boolean;
  /** 位移量描述，如 `9px`，用于速览清单直接说明「只是挪了位置」 */
  shiftLabel?: string;
  imageWidth?: number;
  imageHeight?: number;
};

export type CustomerPageCard = {
  pageKey: string;
  pageTitle: string;
  scriptKey: string;
  /** 客户可读的业务流程名，替代内部脚本路径 */
  scriptLabel: string;
  /** 客户可读的步骤名，替代内部 stepName */
  stepLabel: string;
  stepNumber: number;
  stepName: string;
  browsers: CustomerBrowserCard[];
  worstStatus: CustomerStatus;
  /** before / skipped 过程截图，不作为验收结论 */
  processOnly: boolean;
  /** 同源变化的聚合键，用于把同一根因的多个步骤合成一组 */
  clusterKey: string;
  maxDifference: number;
};

/** 同一根因在多个步骤重复出现时聚成一组，首屏只显示代表页 */
export type CustomerIssueGroup = {
  groupKey: string;
  /** 页内锚点 id，供首屏速览清单跳转到证据卡 */
  anchorId: string;
  title: string;
  status: Exclude<CustomerStatus, 'uncovered'>;
  representative: CustomerPageCard;
  others: CustomerPageCard[];
  affectedSteps: number;
  scriptKeys: string[];
  /** 客户可读的业务流程名列表 */
  scriptLabels: string[];
  reason: string;
  maxDifferenceLabel: string;
  /** 该组内需要处理的区域总数；为 0 表示只有位移/渲染差异 */
  actionableRegions: number;
  /** 位移量描述，如 `9px`，仅位移类差异有值 */
  shiftLabel?: string;
};

export type CustomerReportModel = {
  generatedAt: string;
  coverage: CoverageStats;
  pages: CustomerPageCard[];
  regressions: CustomerPageCard[];
  minors: CustomerPageCard[];
  passes: CustomerPageCard[];
  uncovered: CustomerPageCard[];
  /** 需要处理的问题：按根因聚合，首屏速览与明细共用同一份 */
  regressionGroups: CustomerIssueGroup[];
  /** 轻微变化分组，默认折叠 */
  minorGroups: CustomerIssueGroup[];
};

function browserLabel(browser: string): string {
  const b = browser.toLowerCase();
  if (b === 'webkit' || b === 'safari') return 'WebKit';
  if (b === 'firefox') return 'Firefox';
  return 'Chrome';
}

function verdictLabel(status: CustomerStatus): string {
  if (status === 'pass') return '通过';
  if (status === 'minor') return '轻微变化';
  if (status === 'regress') return '明显衰退';
  return '未检测';
}

function worstStatus(statuses: CustomerStatus[]): CustomerStatus {
  if (statuses.includes('regress')) return 'regress';
  if (statuses.includes('minor')) return 'minor';
  if (statuses.includes('uncovered')) return 'uncovered';
  return 'pass';
}

function toBrowserCard(slot: CoverageSlot): CustomerBrowserCard {
  const difference = slot.difference ?? 0;
  const all = significantRegions(slot.regions, slot.regionsWidth, slot.regionsHeight);
  // 需要处理的区域优先占用有限的标注位
  const significant = [...all]
    .sort((a, b) => {
      const aa = !a.nature || isActionableNature(a.nature) ? 0 : 1;
      const bb = !b.nature || isActionableNature(b.nature) ? 0 : 1;
      return aa - bb;
    })
    .slice(0, 6);
  const regions: CustomerRegion[] = significant.map((r) => {
    const actionable = !r.nature || isActionableNature(r.nature);
    return {
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      label: `${r.w}x${r.h}`,
      nature: r.nature,
      natureLabel: r.nature ? natureLabel(r.nature) : '内容变化',
      actionable,
    };
  });
  const actionableCount = regions.filter((r) => r.actionable).length;
  return {
    browser: slot.browser,
    browserLabel: browserLabel(slot.browser),
    verdict: slot.status,
    verdictLabel: verdictLabel(slot.status),
    difference,
    differenceLabel: `${(difference * 100).toFixed(2)}%`,
    baselinePath: slot.baselinePath,
    currentPath: slot.currentPath,
    overlayPath: slot.overlayPath,
    plainText: buildPlainDescription(slot),
    reason: slot.evidence?.reason || '',
    regions,
    actionableRegions: actionableCount,
    benignOnly: regions.length > 0 && actionableCount === 0,
    shiftLabel: slot.evidence?.shiftLabel,
    imageWidth: slot.regionsWidth,
    imageHeight: slot.regionsHeight,
  };
}

/**
 * 同源变化指纹：同一个全局改动（如头部高度、字体）会在多个步骤产生几乎相同的
 * 差异量与差异区位置。按「脚本 + 差异量档位 + 主变化区网格位置」聚合，
 * 让报告呈现「1 处根因影响 4 个步骤」而不是 4 张重复卡片。
 */
function clusterKeyFor(slot: CoverageSlot): string {
  const bucket = Math.round((slot.difference ?? 0) * 2000); // 0.05% 一档
  const top = significantRegions(slot.regions, slot.regionsWidth, slot.regionsHeight)[0];
  const zone = top ? `${Math.round(top.x / 64)}-${Math.round(top.y / 64)}-${Math.round(top.w / 64)}x${Math.round(top.h / 64)}` : 'none';
  return `${slot.scriptKey}::${bucket}::${zone}`;
}

function groupIssues(pages: CustomerPageCard[], anchorPrefix: string): CustomerIssueGroup[] {
  const buckets = new Map<string, CustomerPageCard[]>();
  for (const page of pages) {
    if (!buckets.has(page.clusterKey)) buckets.set(page.clusterKey, []);
    buckets.get(page.clusterKey)!.push(page);
  }

  const groups: CustomerIssueGroup[] = [];
  for (const [groupKey, list] of buckets) {
    // 优先用正式验收步骤当代表页，过程截图排在后面
    const sorted = [...list].sort((a, b) => {
      if (a.processOnly !== b.processOnly) return a.processOnly ? 1 : -1;
      if (b.maxDifference !== a.maxDifference) return b.maxDifference - a.maxDifference;
      return a.stepNumber - b.stepNumber;
    });
    const representative = sorted[0]!;
    const primary = representative.browsers.find((b) => b.verdict === representative.worstStatus);
    groups.push({
      groupKey,
      anchorId: '',
      title: representative.pageTitle,
      status: representative.worstStatus === 'uncovered' ? 'minor' : representative.worstStatus,
      representative,
      others: sorted.slice(1),
      affectedSteps: sorted.length,
      scriptKeys: [...new Set(sorted.map((p) => p.scriptKey))],
      scriptLabels: [...new Set(sorted.map((p) => p.scriptLabel))],
      reason: primary?.reason || '',
      maxDifferenceLabel: `${(Math.max(...sorted.map((p) => p.maxDifference)) * 100).toFixed(2)}%`,
      actionableRegions: Math.max(
        0,
        ...sorted.flatMap((p) => p.browsers.map((b) => b.actionableRegions)),
      ),
      shiftLabel: sorted
        .flatMap((p) => p.browsers.map((b) => b.shiftLabel))
        .find((s): s is string => Boolean(s)),
    });
  }

  groups.sort((a, b) => {
    const da = Math.max(...a.others.concat(a.representative).map((p) => p.maxDifference));
    const db = Math.max(...b.others.concat(b.representative).map((p) => p.maxDifference));
    if (db !== da) return db - da;
    return b.affectedSteps - a.affectedSteps;
  });
  groups.forEach((g, i) => {
    g.anchorId = `${anchorPrefix}-${i + 1}`;
  });
  return groups;
}

export function buildCustomerReportModel(coverage: CoverageStats, generatedAt?: string): CustomerReportModel {
  const groups = new Map<string, CoverageSlot[]>();
  for (const slot of coverage.slots) {
    const pageKey = `${slot.scriptKey}::${slot.stepNumber}::${slot.stepName}`;
    if (!groups.has(pageKey)) groups.set(pageKey, []);
    groups.get(pageKey)!.push(slot);
  }

  const pages: CustomerPageCard[] = [];
  for (const [pageKey, slots] of groups) {
    const first = slots[0]!;
    const browsers = slots
      .map(toBrowserCard)
      .sort((a, b) => a.browserLabel.localeCompare(b.browserLabel));
    pages.push({
      pageKey,
      pageTitle: friendlyStepLabel(first.pageTitle),
      scriptKey: first.scriptKey,
      scriptLabel: friendlyScriptLabel(first.scriptKey),
      stepLabel: friendlyStepLabel(first.stepName),
      stepNumber: first.stepNumber,
      stepName: first.stepName,
      browsers,
      worstStatus: worstStatus(slots.map((s) => s.status)),
      processOnly: slots.every((s) => s.processOnly),
      clusterKey: clusterKeyFor(
        slots.reduce((worst, s) => ((s.difference ?? 0) > (worst.difference ?? 0) ? s : worst), first),
      ),
      maxDifference: Math.max(...slots.map((s) => s.difference ?? 0)),
    });
  }

  pages.sort((a, b) => {
    if (a.scriptKey !== b.scriptKey) return a.scriptKey.localeCompare(b.scriptKey);
    return a.stepNumber - b.stepNumber;
  });

  const regressions = pages.filter((p) => p.worstStatus === 'regress');
  const minors = pages.filter((p) => p.worstStatus === 'minor');
  const passes = pages.filter((p) => p.worstStatus === 'pass');
  const uncovered = pages.filter((p) => p.worstStatus === 'uncovered');
  return {
    generatedAt: generatedAt ?? new Date().toLocaleString('zh-CN', { hour12: false }),
    coverage,
    pages,
    regressions,
    minors,
    passes,
    uncovered,
    regressionGroups: groupIssues(regressions, 'issue'),
    minorGroups: groupIssues(minors, 'minor'),
  };
}
