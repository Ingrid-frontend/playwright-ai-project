import type { UiIssueSeverity } from './ui-issues.js';

/** Layer 1（AI 单图审计）问题类型 */
export type AuditIssueType =
  | 'overflow'
  | 'occlusion'
  | 'truncation'
  | 'layout'
  | 'whitespace'
  | 'component'
  | 'missing-element'
  | 'console'
  | 'design-mismatch'
  | 'other';

/** 三态结论：不再只有 通过/失败。skipped = 缺少判定依据，未做有效审计 */
export type AuditVerdict = 'pass' | 'review' | 'fail' | 'skipped';

export interface AuditBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AuditIssue {
  id: string;
  type: AuditIssueType;
  /** 复用项目既有 severity 术语，便于与 gate/报告体系对齐 */
  severity: UiIssueSeverity;
  selector: string;
  /** 视口坐标系下的问题区域；无法定位时为 null */
  bbox: AuditBBox | null;
  description: string;
  confidence: number;
}

export interface AuditResult {
  /** 0-100 健康分 */
  score: number;
  verdict: AuditVerdict;
  issues: AuditIssue[];
  /** mock=规则推断，ai=视觉模型，error=分析失败 */
  source: 'mock' | 'ai' | 'error';
  /** 本步是否实际用上了 Figma 双图对比 */
  baseline?: 'none' | 'figma';
}

const ISSUE_TYPES = new Set<AuditIssueType>([
  'overflow',
  'occlusion',
  'truncation',
  'layout',
  'whitespace',
  'component',
  'missing-element',
  'console',
  'design-mismatch',
  'other',
]);

/** AI 可能返回 high/medium/low，统一映射到项目术语 */
const SEVERITY_ALIAS: Record<string, UiIssueSeverity> = {
  high: 'blocker',
  blocker: 'blocker',
  critical: 'blocker',
  medium: 'warning',
  warning: 'warning',
  low: 'noise',
  noise: 'noise',
  minor: 'noise',
  info: 'info',
};

const SEVERITY_WEIGHT: Record<UiIssueSeverity, number> = {
  blocker: 25,
  warning: 12,
  noise: 4,
  info: 0,
};

export function normalizeSeverity(raw: unknown): UiIssueSeverity {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase();
  return SEVERITY_ALIAS[key] ?? 'warning';
}

export function normalizeIssueType(raw: unknown): AuditIssueType {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase() as AuditIssueType;
  return ISSUE_TYPES.has(key) ? key : 'other';
}

/**
 * 三态结论推导：blocker → fail；仅 warning/noise → review；无问题 → pass。
 * 纯 info 不影响结论。
 */
export function verdictFromIssues(issues: AuditIssue[]): AuditVerdict {
  if (issues.some((i) => i.severity === 'blocker')) return 'fail';
  if (issues.some((i) => i.severity === 'warning' || i.severity === 'noise')) return 'review';
  return 'pass';
}

export function normalizeBBox(raw: unknown): AuditBBox | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const x = Number(b.x);
  const y = Number(b.y);
  const width = Number(b.width);
  const height = Number(b.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 把模型/规则的原始输出收敛为可信结构；缺字段自动补齐 */
export function normalizeAuditResult(
  raw: unknown,
  source: AuditResult['source'] = 'ai',
): AuditResult {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawIssues = Array.isArray(obj.issues) ? obj.issues : [];

  const issues: AuditIssue[] = rawIssues
    .filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === 'object')
    .map((i, index) => ({
      id: String(i.id || `uia-${index + 1}`),
      type: normalizeIssueType(i.type),
      severity: normalizeSeverity(i.severity),
      selector: String(i.selector ?? '').slice(0, 200),
      bbox: normalizeBBox(i.bbox),
      description: String(i.description ?? '未提供描述').slice(0, 300),
      confidence: clamp(Number(i.confidence) || 0.6, 0, 1),
    }));

  const verdict = ((): AuditVerdict => {
    const v = String(obj.verdict ?? '').toLowerCase();
    if (v === 'pass' || v === 'review' || v === 'fail' || v === 'skipped') return v;
    return verdictFromIssues(issues);
  })();

  const score = ((): number => {
    const s = Number(obj.score);
    if (Number.isFinite(s)) return clamp(Math.round(s), 0, 100);
    const penalty = issues.reduce((sum, i) => sum + SEVERITY_WEIGHT[i.severity], 0);
    return clamp(100 - penalty, 0, 100);
  })();

  return { score, verdict, issues, source };
}

export function validateAuditResult(result: AuditResult): string[] {
  const errors: string[] = [];
  if (!['pass', 'review', 'fail', 'skipped'].includes(result.verdict)) {
    errors.push(`非法 verdict: ${result.verdict}`);
  }
  if (!Number.isFinite(result.score) || result.score < 0 || result.score > 100) {
    errors.push(`非法 score: ${result.score}`);
  }
  if (!Array.isArray(result.issues)) errors.push('issues 必须是数组');
  return errors;
}
