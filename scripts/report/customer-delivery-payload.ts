import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import type { CustomerReportModel, CustomerBrowserCard, CustomerPageCard } from './customer-report-model.js';
import { hasVisibleDifference } from './customer-report-model.js';
import { buildCustomerReportSummary, type CustomerReportSummary } from './customer-report-summary.js';
import { buildDeliveryTrend, type DeliveryTrendSummary } from './customer-delivery-history.js';
import { parseRunMetaFromScreenshotPath } from './compare-screenshots-utils.js';

/**
 * 交付载荷：把 CustomerReportModel 压平成可 JSON 序列化的结构，
 * 供飞书多维表 / 飞书文档交付链路消费（模型里的 Map 无法直接序列化）。
 */
export type DeliveryImageRole = 'baseline' | 'current' | 'diff';

export type DeliveryImage = {
  role: DeliveryImageRole;
  label: string;
  /** 相对 results/ 的路径，与本地 HTML 报告保持一致 */
  relPath: string;
};

export type DeliveryItemKind = 'regress' | 'minor' | 'pass' | 'uncovered';

export type DeliveryItem = {
  /** 唯一键，多维表按它 upsert（含生成时间，用于保留历史） */
  key: string;
  /** 去重键（不含生成时间），用于「同一页面只保留最新一条」模式 */
  dedupeKey: string;
  kind: DeliveryItemKind;
  /** 客户可读的判定 */
  verdictLabel: string;
  title: string;
  scriptLabel: string;
  stepLabel: string;
  stepNumber: number;
  browserLabel: string;
  differenceLabel: string;
  /** 判定依据，客户要看的「为什么」 */
  reason: string;
  /** 一句话人话描述 */
  plainText: string;
  affectedSteps: number;
  /** 是否包含需要客户动手处理的区域 */
  actionable: boolean;
  images: DeliveryImage[];
};

/** 待建基线步骤：客户需要知道「这次没验到什么」 */
export type DeliveryUncoveredStep = {
  title: string;
  scriptLabel: string;
  stepLabel: string;
  stepNumber: number;
};

export type DeliveryPayload = {
  version: 1;
  /** 快照版本：内容结构变化时递增，供下游门禁判断兼容性 */
  snapshotVersion: number;
  /** 完整交付内容和证据文件字节的哈希，内容变化需重新审核 */
  contentHash: string;
  runId: string;
  generatedAt: string;
  /** 稳定交付身份：envId|runId|releaseTag，重试不变，正式修订新建 */
  deliveryId: string;
  /** 交付环境 id（与 --env= 一致） */
  envId?: string;
  /** 是否允许 deliver:feishu --apply（单环境、显式 --env= 时为 true） */
  deliveryReady?: boolean;
  releaseTag?: string;
  /** 交付所属迭代标识（跑交付时 ITERATION 环境变量传入） */
  iteration?: string;
  envLabel?: string;
  /** 源 run 映射：scriptKey → 实际参与比对的 runId，供门禁校验数据新鲜度 */
  sourceRunIds?: Record<string, string>;
  headline: string;
  shipAdvice: string;
  shipAdviceLabel: string;
  stats: {
    expectedSteps: number;
    comparedSteps: number;
    uncoveredSteps: number;
    passSteps: number;
    minorSteps: number;
    /** minorSteps 拆分：内容确有变化但未阻断操作 */
    degradedSteps: number;
    /** minorSteps 拆分：内容未变（位移/渲染/数据漂移），无需处理 */
    benignSteps: number;
    regressSteps: number;
    passRate: number;
    coveragePct: number;
  };
  actionItems: string[];
  items: DeliveryItem[];
  /** 全部问题根因组数（regress + minor），与 items 一致，不与受影响步骤数混算 */
  totalIssueCount: number;
  /** 实际交付的抽样数（pass，无问题时最多 5 项） */
  totalSampleCount: number;
  /** 未建基线、未参与判定的步骤（覆盖率不足时客户最该知道的部分） */
  uncoveredList: DeliveryUncoveredStep[];
  /** 历史趋势：最近 N 次交付的关键指标变化 */
  trend?: DeliveryTrendSummary;
};

export const CUSTOMER_DELIVERY_FILE = 'results/customer-delivery.json';

function pickCard(page: CustomerPageCard): CustomerBrowserCard | undefined {
  return (
    page.browsers.find((b) => b.verdict === page.worstStatus) ??
    page.browsers.find((b) => hasVisibleDifference(b.difference)) ??
    page.browsers[0]
  );
}

function imagesOf(card: CustomerBrowserCard | undefined): DeliveryImage[] {
  if (!card) return [];
  const out: DeliveryImage[] = [];
  if (card.baselinePath) out.push({ role: 'baseline', label: '验收基线', relPath: card.baselinePath });
  if (card.currentPath) out.push({ role: 'current', label: '本次截图', relPath: card.currentPath });
  if (card.overlayPath) out.push({ role: 'diff', label: '差异标注', relPath: card.overlayPath });
  return out;
}

const VERDICT_LABEL: Record<DeliveryItemKind, string> = {
  regress: '需要修复',
  minor: '无需处理',
  pass: '完全一致',
  uncovered: '待建基线',
};

function kindOf(page: CustomerPageCard): DeliveryItemKind {
  if (page.worstStatus === 'regress') return 'regress';
  if (page.worstStatus === 'minor') return 'minor';
  if (page.worstStatus === 'uncovered') return 'uncovered';
  return 'pass';
}

/**
 * 交付到飞书的内容必须去掉内部测试账号。
 * 脚本标签形如「UAT环境 · 申请单流程 · 199702_comic_com」，末段是登录账号，
 * 客户不应看到。按段剔除账号样式片段（邮箱、纯数字、下划线拼接的账号名）。
 */
const ACCOUNT_SEGMENT = /^(?:[\w.+-]+@[\w.-]+|\d{6,}|[a-z0-9]+(?:[_-][a-z0-9]+)+)$/i;

export function sanitizeScriptLabel(label: string): string {
  const segments = label
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = segments.filter((seg) => !ACCOUNT_SEGMENT.test(seg));
  return kept.length > 0 ? kept.join(' · ') : label.trim();
}

/** 无问题项时，最多补充几条「已验证一致」的抽样作为凭证 */
const SAMPLE_LIMIT = 5;

export type DeliveryPageSet = {
  /** 需要客户处理的问题：衰退 + 轻微变化 */
  issues: CustomerPageCard[];
  /** 无问题项时，用于证明「本次验过什么」的抽样（差异最大的已通过项） */
  samples: CustomerPageCard[];
};

/**
 * 挑选交付条目，按性质分为「问题」与「抽样」两类。
 *
 * 关键约定：**有问题时绝不用零差异的「已通过」项凑数**。
 * 此前无衰退时会把所有 pass 页塞进「问题与证据」——客户看到 20 条
 * 「差异 0.00%·可忽略」的伪问题，结论可信度反而被稀释。
 */
export function collectDeliveryPages(model: CustomerReportModel, maxItems: number): DeliveryPageSet {
  const issues = [
    ...model.regressionGroups.map((g) => g.representative),
    ...model.minorGroups.map((g) => g.representative),
  ];

  if (issues.length > 0) return { issues, samples: [] };

  const samples = model.pages
    .filter((p) => !p.processOnly && p.worstStatus === 'pass')
    .sort((a, b) => b.maxDifference - a.maxDifference)
    .slice(0, Math.max(0, Math.min(maxItems, SAMPLE_LIMIT)));

  return { issues: [], samples };
}

function resolveDeliveryRunId(model: CustomerReportModel, override?: string, selectedRunId?: string): string {
  if (override?.trim()) return override.trim();
  if (process.env.TEST_RUN_ID?.trim()) return process.env.TEST_RUN_ID.trim();
  if (process.env.FLOW_REPORT_BATCH_ID?.trim()) return process.env.FLOW_REPORT_BATCH_ID.trim();
  if (selectedRunId) return selectedRunId;
  for (const run of model.scriptRuns.values()) {
    if (run.runId) return run.runId;
  }
  return '';
}

/** v2：完整交付内容及证据字节绑定，旧版部分字段哈希不兼容。 */
export const SNAPSHOT_VERSION = 2;

/** 只排除根级 contentHash 本身；对象键排序保证写入 JSON 再读回后哈希稳定。 */
export function computeContentHash(
  payload: Omit<DeliveryPayload, 'contentHash'> & { contentHash?: string },
): string {
  const { contentHash: _contentHash, ...snapshot } = payload;
  const evidence = [...new Set(payload.items.flatMap((item) => item.images.map((image) => image.relPath)))]
    .sort()
    .map((relPath) => {
      const abs = resolveDeliveryImagePath(relPath);
      try {
        return { relPath, sha256: createHash('sha256').update(fs.readFileSync(abs)).digest('hex') };
      } catch (error) {
        throw new Error(`交付证据不可读: ${abs}`, { cause: error });
      }
    });
  const serialized = JSON.stringify({ snapshot, evidence }, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
    }
    return value;
  });
  return createHash('sha256').update(serialized).digest('hex');
}

/** 生成、审核和 apply 共用，绝不信任载荷自报的哈希。 */
export function assertDeliveryContentHash(payload: DeliveryPayload): string {
  const actual = computeContentHash(payload);
  if (!payload.contentHash || payload.contentHash !== actual) {
    throw new Error('交付内容或证据已变化（contentHash 不匹配），请重新生成并审核');
  }
  return actual;
}

export function buildCustomerDeliveryPayload(
  model: CustomerReportModel,
  opts?: {
    maxItems?: number;
    summary?: CustomerReportSummary;
    runId?: string;
    envId?: string;
    deliveryReady?: boolean;
    sourceRunIds?: Map<string, string>;
  },
): DeliveryPayload {
  const maxItems = opts?.maxItems ?? 20;
  const s = opts?.summary ?? buildCustomerReportSummary(model);
  const runId = resolveDeliveryRunId(model, opts?.runId, opts?.sourceRunIds?.values().next().value);
  const c = model.coverage;
  if (opts?.deliveryReady || opts?.sourceRunIds) {
    for (const slot of c.slots) {
      const selectedRun = opts.sourceRunIds?.get(slot.scriptKey);
      if (!selectedRun || !slot.currentPath ||
          parseRunMetaFromScreenshotPath(slot.currentPath).runTimestamp !== selectedRun) {
        throw new Error(`源运行与比较证据不匹配: ${slot.scriptKey} / ${slot.stepNumber}`);
      }
    }
  }
  const coveragePct = c.expectedSteps > 0 ? Math.round((c.comparedSteps / c.expectedSteps) * 100) : 0;

  const envId = opts?.envId || '';
  const deliveryId = [envId, runId, s.releaseTag || ''].filter(Boolean).join('|');

  const { issues, samples } = collectDeliveryPages(model, maxItems);
  const pages = [...issues, ...samples];
  const totalIssueCount = issues.length;
  const totalSampleCount = samples.length;
  const items: DeliveryItem[] = pages.map((page) => {
    const card = pickCard(page);
    const kind = kindOf(page);
    const group =
      kind === 'regress'
        ? model.regressionGroups.find((g) => g.representative.pageKey === page.pageKey)
        : model.minorGroups.find((g) => g.representative.pageKey === page.pageKey);
    return {
      key: `${deliveryId}::${page.pageKey}`,
      dedupeKey: `${deliveryId}::${page.pageKey}`,
      kind,
      verdictLabel: VERDICT_LABEL[kind],
      title: page.pageTitle,
      scriptLabel: sanitizeScriptLabel(page.scriptLabel),
      stepLabel: page.stepLabel,
      stepNumber: page.stepNumber,
      browserLabel: card?.browserLabel ?? '',
      differenceLabel: card?.differenceLabel ?? '0.00%',
      reason: card?.reason || (kind === 'uncovered' ? '未建立验收基线，本次未参与比对' : ''),
      plainText: card?.plainText ?? '',
      affectedSteps: group?.affectedSteps ?? 1,
      // 只有被判为「需要修复」的项才算要客户动手，pass 的微小差异不算
      actionable: kind === 'regress' && (card?.actionableRegions ?? 0) > 0,
      images: imagesOf(card),
    };
  });

  const stats: DeliveryPayload['stats'] = {
    expectedSteps: c.expectedSteps,
    comparedSteps: c.comparedSteps,
    uncoveredSteps: c.uncoveredSteps,
    passSteps: c.passSteps,
    minorSteps: c.minorSteps,
    degradedSteps: c.degradedSteps,
    benignSteps: c.benignSteps,
    regressSteps: c.regressSteps,
    passRate: c.passRate,
    coveragePct,
  };
  const sourceRunIds = opts?.sourceRunIds
    ? Object.fromEntries(opts.sourceRunIds)
    : undefined;
  const trendEnv = opts?.envId || model.envId;
  const trend = trendEnv ? buildDeliveryTrend(trendEnv) : undefined;

  const payload: Omit<DeliveryPayload, 'contentHash'> = {
    version: 1,
    snapshotVersion: SNAPSHOT_VERSION,
    runId,
    generatedAt: s.generatedAt,
    deliveryId,
    envId: opts?.envId || undefined,
    deliveryReady: opts?.deliveryReady === true,
    releaseTag: s.releaseTag,
    iteration: s.iteration,
    envLabel: s.envLabel,
    sourceRunIds,
    headline: s.headline,
    shipAdvice: s.shipAdvice,
    shipAdviceLabel: s.shipAdviceLabel,
    stats,
    actionItems: model.actionItems,
    items,
    totalIssueCount,
    totalSampleCount,
    uncoveredList: model.uncovered
      .filter((p) => !p.processOnly)
      .map((p) => ({
        title: p.pageTitle,
        scriptLabel: sanitizeScriptLabel(p.scriptLabel),
        stepLabel: p.stepLabel,
        stepNumber: p.stepNumber,
      })),
    trend,
  };
  return { ...payload, contentHash: computeContentHash(payload) };
}

export function writeCustomerDeliveryPayload(
  payload: DeliveryPayload,
  filePath = CUSTOMER_DELIVERY_FILE,
): void {
  const abs = path.resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(payload, null, 2), 'utf-8');
}

export function readCustomerDeliveryPayload(
  filePath = CUSTOMER_DELIVERY_FILE,
): DeliveryPayload | null {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf-8')) as DeliveryPayload;
    // 新快照必须原样校验，不能在读取时补默认值改变已审核的内容。
    if (parsed.snapshotVersion === SNAPSHOT_VERSION) return parsed;
    if (!parsed.runId) parsed.runId = '';
    if (parsed.deliveryReady === undefined) parsed.deliveryReady = false;
    if (!parsed.envId) parsed.envId = '';
    if (!parsed.deliveryId) parsed.deliveryId = [parsed.envId, parsed.runId, parsed.releaseTag || ''].filter(Boolean).join('|') || `legacy-${parsed.generatedAt}`;
    if (parsed.totalIssueCount === undefined) {
      parsed.totalIssueCount = parsed.items.filter((i) => i.kind === 'regress' || i.kind === 'minor').length;
    }
    if (parsed.totalSampleCount === undefined) {
      parsed.totalSampleCount = parsed.items.filter((i) => i.kind === 'pass').length;
    }
    if (!parsed.snapshotVersion) parsed.snapshotVersion = 0;
    if (!parsed.contentHash) parsed.contentHash = '';
    return parsed;
  } catch (error) {
    throw new Error(`交付载荷读取失败: ${abs}`, { cause: error });
  }
}

/** 把交付载荷里的相对路径还原成本地绝对路径（相对 results/ 解析） */
export function resolveDeliveryImagePath(relPath: string): string {
  if (path.isAbsolute(relPath)) return relPath;
  return path.resolve('results', relPath);
}
