/**
 * 把 Layer 1 AI UI 审计结论匹配到像素回归卡片。
 * 产物缺失时安静降级，报告期不再调模型。
 */
import fs from 'fs';
import path from 'path';
import type { AuditIssue, AuditVerdict } from './ui-audit-schema.js';

export const DEFAULT_UI_AUDIT_SUMMARY = path.join('results', 'ui-audit', 'summary.json');

export type UiAuditStepFinding = {
  scriptKey: string;
  stepName: string;
  stepNumber?: number;
  verdict: AuditVerdict | string;
  issues: AuditIssue[];
};

export type MatchedAuditFinding = {
  scriptKey: string;
  stepName: string;
  stepNumber?: number;
  verdict: string;
  /** 最值得写入客户文案的一条描述 */
  description: string;
  type?: string;
  severity?: string;
};

export type UiAuditIndex = {
  sourcePath: string;
  steps: UiAuditStepFinding[];
};

const SEVERITY_RANK: Record<string, number> = {
  blocker: 4,
  warning: 3,
  noise: 2,
  info: 1,
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
}

function readIssue(raw: unknown): AuditIssue | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const description = String(obj.description ?? '').trim();
  if (!description) return null;
  return {
    id: String(obj.id || ''),
    type: (String(obj.type || 'other') as AuditIssue['type']) || 'other',
    severity: (String(obj.severity || 'warning') as AuditIssue['severity']) || 'warning',
    selector: String(obj.selector ?? ''),
    bbox: null,
    description,
    confidence: Number(obj.confidence) || 0,
  };
}

function isPlaceholderIssue(issue: AuditIssue): boolean {
  const d = issue.description;
  return (
    issue.severity === 'info' ||
    /缺少可判定信号|mock 模式无法给出结论|未提供描述/.test(d)
  );
}

function pickBestIssue(issues: AuditIssue[]): AuditIssue | undefined {
  const usable = issues.filter((i) => !isPlaceholderIssue(i));
  if (!usable.length) return undefined;
  return [...usable].sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity] ?? 0;
    const sb = SEVERITY_RANK[b.severity] ?? 0;
    if (sb !== sa) return sb - sa;
    return (b.confidence || 0) - (a.confidence || 0);
  })[0];
}

export function parseUiAuditSummary(raw: unknown, sourcePath = ''): UiAuditIndex {
  const obj = asRecord(raw) || {};
  const stepsRaw = Array.isArray(obj.steps) ? obj.steps : [];
  const steps: UiAuditStepFinding[] = [];
  for (const item of stepsRaw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const issues = (Array.isArray(rec.issues) ? rec.issues : [])
      .map(readIssue)
      .filter((i): i is AuditIssue => Boolean(i));
    steps.push({
      scriptKey: String(rec.scriptKey || ''),
      stepName: String(rec.stepName || ''),
      stepNumber: Number.isFinite(Number(rec.stepNumber)) ? Number(rec.stepNumber) : undefined,
      verdict: String(rec.verdict || ''),
      issues,
    });
  }
  return { sourcePath, steps };
}

export function loadUiAuditIndex(summaryPath = DEFAULT_UI_AUDIT_SUMMARY): UiAuditIndex | null {
  const abs = path.resolve(summaryPath);
  if (!fs.existsSync(abs)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(abs, 'utf-8'));
    return parseUiAuditSummary(raw, abs);
  } catch {
    return null;
  }
}

export function normalizeMatchKey(value: string): string {
  return String(value || '')
    .replace(/-(after|before|skipped)\b/gi, ' ')
    .replace(/__[\w-]+/g, ' ')
    .replace(/[·•]/g, ' ')
    .replace(/[_/\\-]+/g, ' ')
    .replace(/\bmain\s+\w+\s*$/i, ' ')
    .replace(/\d{6,8}/g, ' ')
    .replace(/\d{4}-\d{2}-\d{2}([_T ]\d{2}[-:]\d{2}[-:]\d{2})?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function scriptAffinity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 40;
  if (a.includes(b) || b.includes(a)) return 28;
  const as = a.split(' ').filter((s) => s.length > 1);
  const bs = new Set(b.split(' ').filter((s) => s.length > 1));
  const overlap = as.filter((s) => bs.has(s)).length;
  if (overlap >= 2) return 18;
  if (overlap === 1) return 8;
  return 0;
}

function stepAffinity(pixel: { stepName: string; stepNumber?: number; pageTitle?: string }, audit: UiAuditStepFinding): number {
  let score = 0;
  if (
    pixel.stepNumber != null &&
    audit.stepNumber != null &&
    pixel.stepNumber === audit.stepNumber
  ) {
    score += 50;
  }
  const pixelStep = normalizeMatchKey(pixel.stepName);
  const auditStep = normalizeMatchKey(audit.stepName);
  if (pixelStep && auditStep) {
    if (pixelStep === auditStep) score += 40;
    else if (pixelStep.includes(auditStep) || auditStep.includes(pixelStep)) score += 28;
  }
  const page = normalizeMatchKey(pixel.pageTitle || '');
  if (page && auditStep && (page === auditStep || page.includes(auditStep) || auditStep.includes(page))) {
    score += 16;
  }
  return score;
}

export function matchAuditFinding(
  pixel: { scriptKey: string; stepName: string; stepNumber?: number; pageTitle?: string },
  index: UiAuditIndex | null | undefined,
): MatchedAuditFinding | undefined {
  if (!index?.steps.length) return undefined;
  const pixelScript = normalizeMatchKey(pixel.scriptKey);
  let best: { score: number; step: UiAuditStepFinding; issue: AuditIssue } | undefined;

  for (const step of index.steps) {
    const issue = pickBestIssue(step.issues);
    if (!issue) continue;
    const stepScore = stepAffinity(pixel, step);
    if (stepScore < 28) continue;
    const scriptScore = scriptAffinity(pixelScript, normalizeMatchKey(step.scriptKey));
    // 步骤对上即可；脚本完全对不上时略降权，但仍允许同一次交付内的短脚本名
    const score = stepScore + scriptScore;
    if (score < 40) continue;
    if (!best || score > best.score) best = { score, step, issue };
  }

  if (!best) return undefined;
  return {
    scriptKey: best.step.scriptKey,
    stepName: best.step.stepName,
    stepNumber: best.step.stepNumber,
    verdict: String(best.step.verdict || ''),
    description: best.issue.description,
    type: best.issue.type,
    severity: best.issue.severity,
  };
}
