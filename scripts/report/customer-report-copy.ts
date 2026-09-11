/**
 * 客户报告三部分业务文案：哪里 → 变成什么 → 影响谁。
 * 只做展示层拼装，不改像素判定口径。
 */
import { type ChangeNature } from './change-nature.js';
import type { ImpactTier } from './coverage-stats.js';
import { regionZoneLabel } from './customer-report-naming.js';
import type { MatchedAuditFinding } from './customer-report-audit.js';

export type CustomerThreePartCopy = {
  where: string;
  change: string;
  impact: string;
  reason: string;
  source: 'audit' | 'pixel' | 'mixed';
  auditAttached: boolean;
};

const IMPACT_PENDING = '影响待确认';

const JARGON_REPLACEMENTS: Array<[RegExp, string]> = [
  [/监控区域/g, '页面区域'],
  [/样式回归/g, '样式变化'],
  [/Golden\s*基线/gi, '已验收画面'],
  [/\bGolden\b/gi, ''],
  [/pixelmatch/gi, ''],
  [/\bblocker\b/gi, ''],
  [/\bseverity\b/gi, ''],
  [/\bsidecar\b/gi, ''],
  [/\bbbox\b/gi, ''],
  [/Layer\s*[12]/gi, ''],
  [/mock\s*模式/gi, ''],
];

export function stripCustomerJargon(text: string): string {
  let out = String(text || '');
  for (const [re, repl] of JARGON_REPLACEMENTS) out = out.replace(re, repl);
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([，。；、])/g, '$1').trim();
}

export function formatThreePartReason(parts: {
  where?: string;
  change?: string;
  impact?: string;
}): string {
  const lines: string[] = [];
  const where = String(parts.where || '').trim();
  const change = String(parts.change || '').trim();
  const impact = String(parts.impact || '').trim();
  if (where) lines.push(`【哪里】${where}`);
  if (change) lines.push(`【变成什么】${change}`);
  if (impact) lines.push(`【影响】${impact}`);
  return lines.join('\n');
}

function zoneOf(
  region: { x: number; y: number; w: number; h: number } | undefined,
  width?: number,
  height?: number,
): string {
  if (!region) return '';
  return regionZoneLabel(region, width, height);
}

export function pixelChangeSummary(input: {
  nature?: ChangeNature;
  zone?: string;
  width?: number;
  height?: number;
  shiftLabel?: string;
}): string {
  const zone = input.zone || '该区域';
  const size =
    input.width && input.height && input.width > 0 && input.height > 0
      ? `（约 ${input.width}×${input.height}）`
      : '';
  switch (input.nature) {
    case 'appeared':
      return `${zone}相对已验收画面新增了一块可见内容${size}`;
    case 'vanished':
      return `${zone}相对已验收画面原有内容缺失${size}`;
    case 'content':
      return `${zone}内容与已验收画面不一致，不是单纯挪位置${size}`;
    case 'shifted':
      return input.shiftLabel
        ? `${zone}同样内容整体平移了 ${input.shiftLabel}，逐像素比对后内容一致`
        : `${zone}同样内容发生了位置偏移，逐像素比对后内容一致`;
    case 'rendering':
      return `${zone}仅有字体渲染/抗锯齿级别差异，内容未变`;
    default:
      return `${zone}出现成块视觉差异${size}，具体变化待确认`;
  }
}

function looksLikeVaguePixelTemplate(text: string): boolean {
  const t = String(text || '');
  return (
    /有一大?块区域/.test(t) && /内容(发生了)?变化|新增了内容|新增内容/.test(t)
  ) || /有一块\s*\d+x\d+\s*的区域(内容变化|新增内容|内容缺失)/.test(t);
}

function auditLooksLikeImpact(text: string): boolean {
  return /无法|看不清|看不全|挡住|遮挡|点不到|点不了|操作|缺失|截断|溢出|被挡|读不全|找不到/.test(
    text,
  );
}

function impactFromNature(_nature?: ChangeNature, auditText?: string): string {
  if (auditText && auditLooksLikeImpact(auditText)) return stripCustomerJargon(auditText);
  return IMPACT_PENDING;
}

export function buildWhereLabel(input: {
  scriptLabel?: string;
  stepLabel?: string;
  pageTitle?: string;
  zone?: string;
}): string {
  const page = input.stepLabel || input.pageTitle || '';
  const parts = [input.scriptLabel, page, input.zone].map((s) => String(s || '').trim()).filter(Boolean);
  const unique: string[] = [];
  for (const p of parts) {
    if (!unique.some((u) => u === p || u.includes(p) || p.includes(u))) unique.push(p);
    else if (!unique.includes(p) && p.length > (unique.find((u) => u.includes(p) || p.includes(u))?.length || 0)) {
      const idx = unique.findIndex((u) => u.includes(p) || p.includes(u));
      if (idx >= 0 && p.length > unique[idx]!.length) unique[idx] = p;
    }
  }
  return unique.join(' · ') || '页面局部';
}

export function buildCustomerIssueCopy(input: {
  impactTier: ImpactTier;
  scriptLabel?: string;
  stepLabel?: string;
  pageTitle?: string;
  nature?: ChangeNature;
  region?: { x: number; y: number; w: number; h: number };
  imageWidth?: number;
  imageHeight?: number;
  shiftLabel?: string;
  pixelReason?: string;
  audit?: MatchedAuditFinding | null;
}): CustomerThreePartCopy {
  const zone = zoneOf(input.region, input.imageWidth, input.imageHeight);
  const where = buildWhereLabel({
    scriptLabel: input.scriptLabel,
    stepLabel: input.stepLabel,
    pageTitle: input.pageTitle,
    zone,
  });

  const pixelChange = pixelChangeSummary({
    nature: input.nature,
    zone: zone || undefined,
    width: input.region?.w,
    height: input.region?.h,
    shiftLabel: input.shiftLabel,
  });

  const auditText = input.audit?.description ? stripCustomerJargon(input.audit.description) : '';
  const auditAttached = Boolean(auditText);
  let change = pixelChange;
  let source: CustomerThreePartCopy['source'] = 'pixel';
  if (auditText) {
    change = auditText;
    source = looksLikeVaguePixelTemplate(pixelChange) || !input.nature ? 'audit' : 'mixed';
  } else if (input.pixelReason && !looksLikeVaguePixelTemplate(input.pixelReason)) {
    const cleaned = stripCustomerJargon(input.pixelReason);
    if (cleaned && !/内容变化$/.test(cleaned)) change = cleaned;
  }

  const benign = input.impactTier === 'benign' || input.impactTier === 'pass';
  let impact = '';
  if (!benign) {
    impact = impactFromNature(input.nature, auditText || undefined);
    if (!impact) impact = IMPACT_PENDING;
  } else if (input.impactTier === 'benign') {
    impact = '不影响功能，建议扫一眼确认是否接受';
  }

  const whereOut = stripCustomerJargon(where);
  const changeOut = stripCustomerJargon(change) || '具体变化待确认';
  const impactOut = stripCustomerJargon(impact);

  return {
    where: whereOut,
    change: changeOut,
    impact: impactOut,
    reason: formatThreePartReason({ where: whereOut, change: changeOut, impact: impactOut }),
    source,
    auditAttached,
  };
}

export function impactTierLabel(tier: ImpactTier): string {
  if (tier === 'blocking') return '需修复';
  if (tier === 'degraded') return '影响体验';
  if (tier === 'benign') return '可忽略';
  if (tier === 'pass') return '完全一致';
  return '未判定';
}

export function actionItemPrefix(tier: ImpactTier): string {
  if (tier === 'blocking') return '修复';
  if (tier === 'degraded') return '确认';
  return '可忽略';
}

/** 飞书/清单用的一行标题 + 三部分正文 */
export function formatActionItemText(title: string, copy: CustomerThreePartCopy, tier: ImpactTier): string {
  const prefix = actionItemPrefix(tier);
  return `${prefix}「${title}」\n${copy.reason}`;
}
