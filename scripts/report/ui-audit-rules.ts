import fs from 'fs';
import path from 'path';
import {
  normalizeAuditResult,
  verdictFromIssues,
  type AuditIssueType,
  type AuditResult,
} from './ui-audit-schema.js';

export interface AuditRuleEntry {
  /** 匹配 scriptKey 子串 */
  script: string;
  /** 可选：匹配 step 名/步号 */
  step?: string;
  /** 注入 prompt：明确哪些不算缺陷 */
  expect?: string[];
  /** 丢弃 confidence 低于此值的 noise / warning（后处理兜底；blocker 不丢） */
  dropNoiseBelow?: number;
  /** 丢弃匹配类型（不含 info） */
  dropTypes?: AuditIssueType[];
  /** 描述含任一子串则丢弃（不含 info） */
  dropPatterns?: string[];
}

interface AuditRulesConfig {
  rules?: AuditRuleEntry[];
}

const DEFAULT_CONFIG = path.join('config', 'ui-audit-rules.json');

export function loadAuditRules(configPath = DEFAULT_CONFIG): AuditRuleEntry[] {
  const abs = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(abs)) return [];
  try {
    const json = JSON.parse(fs.readFileSync(abs, 'utf-8')) as AuditRulesConfig;
    return Array.isArray(json.rules) ? json.rules.filter((r) => r && r.script) : [];
  } catch {
    return [];
  }
}

/** 合并同一 script 下多条规则（全局 + step 专用） */
function mergeAuditRules(rules: AuditRuleEntry[]): AuditRuleEntry {
  const dropBelow = rules
    .map((r) => r.dropNoiseBelow)
    .filter((n): n is number => n != null && Number.isFinite(n));
  return {
    script: rules[0].script,
    expect: [...new Set(rules.flatMap((r) => r.expect ?? []))],
    dropPatterns: [...new Set(rules.flatMap((r) => r.dropPatterns ?? []))],
    dropTypes: [...new Set(rules.flatMap((r) => r.dropTypes ?? []))],
    dropNoiseBelow: dropBelow.length > 0 ? Math.min(...dropBelow) : undefined,
  };
}

/** script 子串匹配；无 step 的规则对该 script 下所有步骤生效 */
export function matchAuditRules(
  rules: AuditRuleEntry[],
  scriptKey: string,
  stepName: string,
  stepNumber?: number,
): AuditRuleEntry[] {
  const script = String(scriptKey || '');
  const step = String(stepName || '');
  const num = stepNumber != null ? String(stepNumber) : '';
  const out: AuditRuleEntry[] = [];
  for (const item of rules) {
    if (!script.includes(item.script) && item.script !== script) continue;
    if (!item.step) {
      out.push(item);
      continue;
    }
    if (item.step === num || step.includes(item.step) || `step-${item.step}` === step) {
      out.push(item);
    }
  }
  return out;
}

export function resolveAuditRule(
  scriptKey: string,
  stepName: string,
  stepNumber?: number,
  configPath?: string,
): AuditRuleEntry | null {
  const matched = matchAuditRules(
    loadAuditRules(configPath),
    scriptKey,
    stepName,
    stepNumber,
  );
  if (matched.length === 0) return null;
  return mergeAuditRules(matched);
}

/** 按业务白名单过滤误报，并重新计算 verdict / score */
export function applyAuditRules(result: AuditResult, rule: AuditRuleEntry | null): AuditResult {
  if (!rule || result.verdict === 'skipped') return result;

  let issues = result.issues;
  const dropNoiseBelow = rule.dropNoiseBelow;
  if (dropNoiseBelow != null && Number.isFinite(dropNoiseBelow)) {
    issues = issues.filter((i) => {
      if (i.severity === 'info' || i.severity === 'blocker') return true;
      if (i.severity !== 'noise' && i.severity !== 'warning') return true;
      return i.confidence >= dropNoiseBelow;
    });
  }

  const dropTypes = rule.dropTypes ?? [];
  if (dropTypes.length > 0) {
    issues = issues.filter((i) => i.severity === 'info' || !dropTypes.includes(i.type));
  }

  const dropPatterns = rule.dropPatterns ?? [];
  if (dropPatterns.length > 0) {
    issues = issues.filter(
      (i) =>
        i.severity === 'info' ||
        !dropPatterns.some((p) => p && i.description.includes(p)),
    );
  }

  return normalizeAuditResult(
    { issues, verdict: verdictFromIssues(issues) },
    result.source,
  );
}
