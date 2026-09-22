import {
  displayRegions,
  impactTierOf,
  type CoverageSlot,
  type CoverageStats,
  type CoverageStatus,
  type ImpactTier,
} from './coverage-stats.js';
import { isActionableNature, natureLabel, type ChangeNature } from './change-nature.js';
import { buildActionItems, buildPlainDescription, deriveShipAdvice, type ShipAdvice } from './customer-report-plain.js';
import { friendlyScriptLabel, friendlyStepLabel, extractEnvLabel, extractEnvId, envLabelFromId, envIdSortKey } from './customer-report-naming.js';
import type { ScriptRunMeta, ScriptRunHistoryEntry } from './customer-report-run-meta.js';
import { auditVerdictToImpactTier, type AuditInsight, type AuditInjection } from './customer-report-audit-inject.js';
import {
  buildRegressionDisplay,
  type CustomerRegressionDisplayItem,
} from './customer-report-bundle.js';

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
  /** 客户可见的业务影响档位，与判定分支同源 */
  impactTier: ImpactTier;
  /** 全部变化都只是位移/渲染差异 */
  benignOnly: boolean;
  /** 位移量描述，如 `9px`，用于速览清单直接说明「只是挪了位置」 */
  shiftLabel?: string;
  imageWidth?: number;
  imageHeight?: number;
  /** 页面状态漂移说明，用于并排对比黄条提示 */
  stateDriftReason?: string;
  /** AI 审计（ui-audit）注入的业务语义影响说明，与像素结论同卡展示 */
  auditInsights?: AuditInsight[];
  /** AI 审计步骤结论，用于与像素结论做统一状态映射 */
  auditVerdict?: string;
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
  /**
   * 该页面实际参与比对的步骤数（跨浏览器会 >1）。
   * 统计口径对齐的关键：CoverageStats 的 minorSteps/regressSteps 是 slot（步骤）级，
   * 此前分组却按页面计数，导致「分组步数合计 24」与「轻微变化 26」对不上账。
   */
  slotCount: number;
  /** 该页面的业务影响档位 */
  impactTier: ImpactTier;
  /** AI 审计注入的影响说明（取组内代表页） */
  auditInsights?: AuditInsight[];
  /** AI 审计步骤结论（取组内最差） */
  auditVerdict?: string;
};

/** 与报告展示一致：四舍五入到 0.00% 的差异不展示对比图 */
export function hasVisibleDifference(difference: number): boolean {
  return difference > 0 && (difference * 100).toFixed(2) !== '0.00';
}

/** 有像素差异、值得展示对比图的步骤（排除零差异 pass 与未建基线） */
export function isDiffPage(page: CustomerPageCard): boolean {
  return !page.processOnly && page.worstStatus !== 'uncovered' && hasVisibleDifference(page.maxDifference);
}

/** 同一根因在多个步骤重复出现时聚成一组，首屏只显示代表页 */
export type EnvCoverageSummary = {
  envId: string;
  envLabel: string;
  regressSteps: number;
  minorSteps: number;
  passSteps: number;
  comparedSteps: number;
  expectedSteps: number;
  uncoveredSteps: number;
};

export type IncompleteScriptNote = {
  scriptKey: string;
  scriptLabel: string;
  detail: string;
};

export type CustomerReportBatchMeta = {
  batchId: string;
  expectedRunCount: number;
  completedRunCount: number;
  failedRunCount: number;
  skippedRunCount: number;
  flowLabels: string[];
  envLabels: string[];
  audit: {
    runCount: number;
    total: number;
    pass: number;
    review: number;
    fail: number;
    skipped: number;
    issueTotal: number;
    observationTotal: number;
    degradedSteps: number;
  };
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
  /** 受影响的**步骤**数（与 CoverageStats 的 minorSteps/regressSteps 同口径，非页面数） */
  affectedSteps: number;
  scriptKeys: string[];
  /** 客户可读的业务流程名列表 */
  scriptLabels: string[];
  reason: string;
  maxDifferenceLabel: string;
  /** 该组内需要处理的区域总数；为 0 表示只有位移/渲染差异 */
  actionableRegions: number;
  /** 客户可见的业务影响档位，用于首屏三档分组与排序 */
  impactTier: ImpactTier;
  /** 组内统一的变化性质标签，与 reason 同源，避免「内容变化」与「位置偏移」并存 */
  natureLabel: string;
  /** 位移量描述，如 `9px`，仅位移类差异有值 */
  shiftLabel?: string;
  /** AI 审计注入的影响说明（取代表页） */
  auditInsights?: AuditInsight[];
  /** AI 审计步骤结论（取组内最差） */
  auditVerdict?: string;
};

export type CustomerReportModel = {
  generatedAt: string;
  /** 各业务流程脚本最近一次运行元信息（开始时间等） */
  scriptRuns: Map<string, ScriptRunMeta>;
  /** 各脚本历次 run 与验收基线的对比汇总 */
  runHistory: Map<string, ScriptRunHistoryEntry[]>;
  coverage: CoverageStats;
  pages: CustomerPageCard[];
  regressions: CustomerPageCard[];
  minors: CustomerPageCard[];
  passes: CustomerPageCard[];
  uncovered: CustomerPageCard[];
  /** 需要处理的问题：按步骤聚合，统计与对账用 */
  regressionGroups: CustomerIssueGroup[];
  /** 首屏与证据 Tab 展示：公共布局类问题合并为一条，各步骤仍保留独立对比 */
  regressionDisplay: CustomerRegressionDisplayItem[];
  /** 轻微变化分组，默认折叠 */
  minorGroups: CustomerIssueGroup[];
  /** 发版建议：fix / confirm / ship / baseline */
  shipAdvice: ShipAdvice;
  shipAdviceLabel: string;
  /** 首屏建议操作，3~5 条 */
  actionItems: string[];
  /** 数字对账，确保分组步数与统计口径一致 */
  accounting: StepAccounting;
  /** 单环境报告的环境身份（不能从仅多环境才有的 envSummaries 推断） */
  envId?: string;
  /** 报告头环境名 */
  envLabel?: string;
  /** 多环境时分环境统计 */
  envSummaries?: EnvCoverageSummary[];
  /** 最新 run 未完成、主结论已回退到上一轮完整 run */
  incompleteScripts?: IncompleteScriptNote[];
  /** 发版版本号 */
  releaseTag?: string;
  reportScope?: 'golden' | 'all';
  reportBatch?: CustomerReportBatchMeta;
};

/**
 * 数字对账：统计口径（步骤级）与问题分组（根因级）必须能对上账。
 * 此前同一份首屏出现 26 / 16 / 24 三个数字却无人解释，客户第一屏就失去信任。
 * 差额必须显式展示去处，不允许静默消失。
 */
export type StepAccounting = {
  /** 统计口径下「有差异」的步骤数（regressSteps + minorSteps） */
  changedSteps: number;
  /** 已进入问题分组的步骤数 */
  groupedSteps: number;
  /** 未进入分组的步骤数 */
  ungroupedSteps: number;
  /** 差额原因；为空表示完全对账 */
  ungroupedReason: string;
};

export type CustomerReportMeta = {
  releaseTag?: string;
  envLabel?: string;
  /** golden=仅 Golden 回归；all=含流程调试截图 */
  reportScope?: 'golden' | 'all';
  reportBatch?: CustomerReportBatchMeta;
};

function browserLabel(browser: string): string {
  const b = browser.toLowerCase();
  if (b === 'webkit' || b === 'safari') return 'WebKit';
  if (b === 'firefox') return 'Firefox';
  return 'Chrome';
}

function verdictLabel(status: CustomerStatus): string {
  if (status === 'pass') return '通过';
  if (status === 'minor') return '无需处理';
  if (status === 'regress') return '需要修复';
  return '待建基线';
}

/**
 * 区域未识别出变化性质时，回落到该步骤的主导性质；仍未知则用中性词。
 * 此前一律写「内容变化」，与「只是整体挪了约 9px」的结论文案直接打架。
 */
function resolveRegionNatureLabel(nature?: ChangeNature, dominant?: ChangeNature): string {
  const picked = nature || dominant;
  return picked ? natureLabel(picked) : '有变化';
}

function worstStatus(statuses: CustomerStatus[]): CustomerStatus {
  if (statuses.includes('regress')) return 'regress';
  if (statuses.includes('minor')) return 'minor';
  if (statuses.includes('uncovered')) return 'uncovered';
  return 'pass';
}

const TIER_RANK: Record<ImpactTier, number> = { benign: 1, degraded: 2, blocking: 3 };

function mergeImpactTier(a: ImpactTier, b: ImpactTier): ImpactTier {
  return TIER_RANK[b] > TIER_RANK[a] ? b : a;
}

function toBrowserCard(slot: CoverageSlot): CustomerBrowserCard {
  const difference = slot.difference ?? 0;
  const all = displayRegions(slot.regions, slot.regionsWidth, slot.regionsHeight, difference);
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
      natureLabel: resolveRegionNatureLabel(r.nature, slot.evidence?.dominantNature),
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
    impactTier: impactTierOf(slot),
    benignOnly: regions.length > 0 && actionableCount === 0,
    shiftLabel: slot.evidence?.shiftLabel,
    imageWidth: slot.regionsWidth,
    imageHeight: slot.regionsHeight,
    stateDriftReason: slot.evidence?.stateDrift ? slot.evidence.reason : undefined,
  };
}

function groupIssues(pages: CustomerPageCard[], anchorPrefix: string): CustomerIssueGroup[] {
  const buckets = new Map<string, CustomerPageCard[]>();
  for (const page of pages) {
    if (!buckets.has(page.clusterKey)) buckets.set(page.clusterKey, []);
    buckets.get(page.clusterKey)!.push(page);
  }

  const groups: CustomerIssueGroup[] = [];
  for (const [groupKey, list] of buckets) {
    // 优先用正式验收步骤当代表页，过程截图排在后面；有 AI 审计说明的优先展示
    const sorted = [...list].sort((a, b) => {
      if (a.processOnly !== b.processOnly) return a.processOnly ? 1 : -1;
      const hasAuditA = a.auditInsights?.length ? 0 : 1;
      const hasAuditB = b.auditInsights?.length ? 0 : 1;
      if (hasAuditA !== hasAuditB) return hasAuditA - hasAuditB;
      if (b.maxDifference !== a.maxDifference) return b.maxDifference - a.maxDifference;
      return a.stepNumber - b.stepNumber;
    });
    const representative = sorted[0]!;
    const primary = representative.browsers.find((b) => b.verdict === representative.worstStatus);
    const members = sorted;
    // 步骤级计数：多浏览器的同一页面会产生多个 slot，必须按 slot 求和才能与统计口径对账
    const affectedSteps = members.reduce((sum, p) => sum + p.slotCount, 0);
    const impactTier = members.reduce<ImpactTier>((worst, p) => {
      const rank = { benign: 1, degraded: 2, blocking: 3 } as const;
      return rank[p.impactTier] > rank[worst] ? p.impactTier : worst;
    }, 'benign');
    const actionableRegions = Math.max(
      0,
      ...members.flatMap((p) => p.browsers.map((b) => b.actionableRegions)),
    );
    const shiftLabel = members
      .flatMap((p) => p.browsers.map((b) => b.shiftLabel))
      .find((s): s is string => Boolean(s));
    const dominantNature = primary?.regions.find((r) => r.actionable)?.nature
      ?? primary?.regions[0]?.nature
      ?? representative.browsers[0]?.regions[0]?.nature;
    const natureLabel =
      actionableRegions === 0
        ? shiftLabel
          ? '位置偏移'
          : '显示差异'
        : resolveRegionNatureLabel(dominantNature);
    // AI 审计注入：组内任一成员有审计说明即继承（代表页优先，其次成员）
    const auditSource =
      members.find((p) => p.auditInsights?.length && p === representative) ??
      members.find((p) => p.auditInsights?.length);
    const auditVerdictRank: Record<string, number> = { fail: 3, review: 2, pass: 1, skipped: 0 };
    const auditVerdict = members
      .map((p) => p.auditVerdict)
      .filter(Boolean)
      .sort((a, b) => (auditVerdictRank[String(b)] ?? 0) - (auditVerdictRank[String(a)] ?? 0))[0];
    const groupImpactTier = auditVerdict
      ? mergeImpactTier(impactTier, auditVerdictToImpactTier(String(auditVerdict)))
      : impactTier;
    groups.push({
      groupKey,
      anchorId: '',
      title: representative.pageTitle,
      status: representative.worstStatus === 'uncovered' ? 'minor' : representative.worstStatus,
      representative,
      others: sorted.slice(1),
      affectedSteps,
      scriptKeys: [...new Set(sorted.map((p) => p.scriptKey))],
      scriptLabels: [...new Set(sorted.map((p) => p.scriptLabel))],
      reason: primary?.reason || '',
      maxDifferenceLabel: `${(Math.max(...sorted.map((p) => p.maxDifference)) * 100).toFixed(2)}%`,
      actionableRegions,
      impactTier: groupImpactTier,
      natureLabel,
      shiftLabel,
      auditInsights: auditSource?.auditInsights,
      auditVerdict,
    });
  }

  groups.sort((a, b) => {
    const rank = { benign: 1, degraded: 2, blocking: 3 } as const;
    if (rank[b.impactTier] !== rank[a.impactTier]) return rank[b.impactTier] - rank[a.impactTier];
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

export function buildPageCardsFromCoverage(coverage: CoverageStats): CustomerPageCard[] {
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
      clusterKey: pageKey,
      maxDifference: Math.max(...slots.map((s) => s.difference ?? 0)),
      slotCount: slots.length,
      impactTier: slots.reduce<ImpactTier>((worst, s) => {
        const rank = { benign: 1, degraded: 2, blocking: 3 } as const;
        return rank[impactTierOf(s)] > rank[worst] ? impactTierOf(s) : worst;
      }, 'benign'),
    });
  }

  pages.sort((a, b) => {
    if (a.scriptKey !== b.scriptKey) return a.scriptKey.localeCompare(b.scriptKey);
    return a.stepNumber - b.stepNumber;
  });
  return pages;
}

function buildEnvSummaries(slots: CoverageSlot[]): EnvCoverageSummary[] {
  const groups = new Map<string, CoverageSlot[]>();
  for (const slot of slots) {
    const envId = extractEnvId(slot.scriptKey) || '_';
    if (!groups.has(envId)) groups.set(envId, []);
    groups.get(envId)!.push(slot);
  }
  return [...groups.entries()]
    .sort((a, b) => envIdSortKey(a[0]) - envIdSortKey(b[0]))
    .map(([envId, list]) => ({
      envId,
      envLabel: envId === '_' ? '未标环境' : envLabelFromId(envId),
      regressSteps: list.filter((s) => s.status === 'regress').length,
      minorSteps: list.filter((s) => s.status === 'minor').length,
      passSteps: list.filter((s) => s.status === 'pass').length,
      comparedSteps: list.filter((s) => s.status !== 'uncovered').length,
      expectedSteps: list.length,
      uncoveredSteps: list.filter((s) => s.status === 'uncovered').length,
    }));
}

/** 对账：分组步数合计与统计口径的差额必须可解释 */
function buildStepAccounting(
  coverage: CoverageStats,
  groups: CustomerIssueGroup[],
): StepAccounting {
  const changedSteps = coverage.regressSteps + coverage.minorSteps;
  const groupedSteps = groups.reduce((sum, g) => sum + g.affectedSteps, 0);
  const ungroupedSteps = Math.max(0, changedSteps - groupedSteps);
  const ungroupedReason =
    ungroupedSteps > 0
      ? `${ungroupedSteps} 步差异极小（显示 0.00%），未单列证据，已计入上方步骤统计`
      : '';
  return { changedSteps, groupedSteps, ungroupedSteps, ungroupedReason };
}

function buildIncompleteScripts(
  runHistory: Map<string, ScriptRunHistoryEntry[]>,
  usedRunIds: Map<string, string>,
): IncompleteScriptNote[] {
  const out: IncompleteScriptNote[] = [];
  for (const [scriptKey, rows] of runHistory) {
    const latest = rows.find((r) => r.isLatest);
    if (!latest?.incomplete) continue;
    const used = usedRunIds.get(scriptKey);
    const detail = used && used !== latest.runId ? `最新 run 未完成，结论基于上一轮完整 run` : '最新 run 未完成';
    out.push({ scriptKey, scriptLabel: friendlyScriptLabel(scriptKey), detail });
  }
  return out;
}

export function buildCustomerReportModel(
  coverage: CoverageStats,
  generatedAt?: string,
  scriptRuns: Map<string, ScriptRunMeta> = new Map(),
  runHistory: Map<string, ScriptRunHistoryEntry[]> = new Map(),
  meta?: CustomerReportMeta,
  usedRunIds: Map<string, string> = new Map(),
  auditInsights: Map<string, AuditInjection> = new Map(),
): CustomerReportModel {
  const pages = buildPageCardsFromCoverage(coverage);
  // AI 审计注入：按 scriptKey::stepName 精确匹配（模型侧只读，不改变像素判定）
  // 审计侧 scriptKey 已 strip flows/ 前缀，模型侧带前缀，需归一化后匹配
  const normalizeKey = (k: string) => k.replace(/^flows\//, '');
  const auditLookup = new Map<string, AuditInjection>();
  for (const [k, v] of auditInsights) auditLookup.set(normalizeKey(k), v);
  for (const page of pages) {
    const hit = auditLookup.get(`${normalizeKey(page.scriptKey)}::${page.stepName}`);
    if (!hit) continue;
    if (hit.insights.length > 0) page.auditInsights = hit.insights;
    if (hit.verdict) {
      page.auditVerdict = hit.verdict;
      const auditTier = auditVerdictToImpactTier(hit.verdict);
      page.impactTier = mergeImpactTier(page.impactTier, auditTier);
      for (const browser of page.browsers) {
        browser.impactTier = mergeImpactTier(browser.impactTier, auditTier);
      }
    }
  }

  const regressions = pages.filter((p) => p.worstStatus === 'regress');
  const minors = pages.filter((p) => p.worstStatus === 'minor' && hasVisibleDifference(p.maxDifference));
  const passes = pages.filter((p) => p.worstStatus === 'pass');
  const uncovered = pages.filter((p) => p.worstStatus === 'uncovered');
  const regressionGroups = groupIssues(regressions, 'issue');
  const regressionDisplay = buildRegressionDisplay(regressionGroups, pages);
  const minorGroups = groupIssues(minors, 'minor');
  const scriptKeys = [...new Set(coverage.slots.map((s) => s.scriptKey))];
  const envSummaries = buildEnvSummaries(coverage.slots);
  const incompleteScripts = buildIncompleteScripts(runHistory, usedRunIds);
  const model: CustomerReportModel = {
    generatedAt: generatedAt ?? new Date().toLocaleString('zh-CN', { hour12: false }),
    scriptRuns,
    runHistory,
    coverage,
    pages,
    regressions,
    minors,
    passes,
    uncovered,
    regressionGroups,
    regressionDisplay,
    minorGroups,
    shipAdvice: 'ship',
    shipAdviceLabel: '',
    actionItems: [],
    accounting: buildStepAccounting(coverage, [...regressionGroups, ...minorGroups]),
    envId: envSummaries.length === 1 && envSummaries[0]!.envId !== '_' ? envSummaries[0]!.envId : undefined,
    envLabel: meta?.envLabel || extractEnvLabel(scriptKeys) || undefined,
    envSummaries: envSummaries.length > 1 ? envSummaries : undefined,
    incompleteScripts: incompleteScripts.length ? incompleteScripts : undefined,
    releaseTag: meta?.releaseTag || undefined,
    reportScope: meta?.reportScope || 'golden',
    reportBatch: meta?.reportBatch,
  };
  const { advice, label } = deriveShipAdvice(coverage);
  model.shipAdvice = advice;
  model.shipAdviceLabel = label;
  model.actionItems = buildActionItems(model);
  return model;
}
