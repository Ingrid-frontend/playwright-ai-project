import fs from 'fs';
import path from 'path';
import type { CustomerReportModel, CustomerBrowserCard, CustomerPageCard } from './customer-report-model.js';
import { hasVisibleDifference } from './customer-report-model.js';
import { buildCustomerReportSummary, type CustomerReportSummary } from './customer-report-summary.js';

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

export type DeliveryPayload = {
  version: 1;
  generatedAt: string;
  releaseTag?: string;
  envLabel?: string;
  headline: string;
  shipAdvice: string;
  shipAdviceLabel: string;
  stats: {
    expectedSteps: number;
    comparedSteps: number;
    uncoveredSteps: number;
    passSteps: number;
    minorSteps: number;
    regressSteps: number;
    passRate: number;
    coveragePct: number;
  };
  actionItems: string[];
  items: DeliveryItem[];
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

/**
 * 挑选需要交付证据图的条目：
 * 优先「需要修复」分组，其次「无需处理」分组；
 * 两者都为空（本次无差异）时，退回已对比的页面作为「验过什么」的凭证，
 * 避免客户收到一份没有任何证据图的空报告。
 */
export function collectDeliveryPages(model: CustomerReportModel, maxItems: number): CustomerPageCard[] {
  const fromGroups = [
    ...model.regressionGroups.map((g) => g.representative),
    ...model.minorGroups.map((g) => g.representative),
  ];
  if (fromGroups.length > 0) return fromGroups.slice(0, maxItems);

  const fallback = model.pages
    .filter((p) => !p.processOnly && p.worstStatus !== 'uncovered')
    .sort((a, b) => b.maxDifference - a.maxDifference);
  return fallback.slice(0, maxItems);
}

export function buildCustomerDeliveryPayload(
  model: CustomerReportModel,
  opts?: { maxItems?: number; summary?: CustomerReportSummary },
): DeliveryPayload {
  const maxItems = opts?.maxItems ?? 20;
  const s = opts?.summary ?? buildCustomerReportSummary(model);
  const c = model.coverage;
  const coveragePct = c.expectedSteps > 0 ? Math.round((c.comparedSteps / c.expectedSteps) * 100) : 0;

  const pages = collectDeliveryPages(model, maxItems);
  const items: DeliveryItem[] = pages.map((page) => {
    const card = pickCard(page);
    const kind = kindOf(page);
    const group =
      kind === 'regress'
        ? model.regressionGroups.find((g) => g.representative.pageKey === page.pageKey)
        : model.minorGroups.find((g) => g.representative.pageKey === page.pageKey);
    return {
      key: `${page.pageKey}::${s.generatedAt}`,
      dedupeKey: page.pageKey,
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

  return {
    version: 1,
    generatedAt: s.generatedAt,
    releaseTag: s.releaseTag,
    envLabel: s.envLabel,
    headline: s.headline,
    shipAdvice: s.shipAdvice,
    shipAdviceLabel: s.shipAdviceLabel,
    stats: {
      expectedSteps: c.expectedSteps,
      comparedSteps: c.comparedSteps,
      uncoveredSteps: c.uncoveredSteps,
      passSteps: c.passSteps,
      minorSteps: c.minorSteps,
      regressSteps: c.regressSteps,
      passRate: c.passRate,
      coveragePct,
    },
    actionItems: model.actionItems,
    items,
  };
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
    return JSON.parse(fs.readFileSync(abs, 'utf-8')) as DeliveryPayload;
  } catch {
    return null;
  }
}

/** 把交付载荷里的相对路径还原成本地绝对路径（相对 results/ 解析） */
export function resolveDeliveryImagePath(relPath: string): string {
  if (path.isAbsolute(relPath)) return relPath;
  return path.resolve('results', relPath);
}
