import fs from 'fs';
import path from 'path';

/**
 * 把 AI 审计（ui-audit）结论注入客户报告。
 *
 * 背景：像素回归报告与 AI 审计报告此前各自独立出结论，同一页面可能出现
 * 「像素层说轻微变化，AI 层说有遮挡导致无法阅读」的矛盾。本模块把 AI 审计的
 * 业务语义描述按 scriptKey + stepName 精确匹配进客户报告模型，作为「影响说明」
 * 展示，让两份报告在交付物层面合并成一份结论。
 */

export type AuditInsight = {
  severity: string;
  type: string;
  description: string;
};

export type AuditInjection = {
  insights: AuditInsight[];
  /** 步骤级审计结论，用于状态映射 */
  verdict: 'pass' | 'review' | 'fail' | 'skipped' | string;
};

/** AI 审计 verdict → 客户报告 impactTier 的映射（消除双报告口径冲突的唯一映射表） */
export function auditVerdictToImpactTier(verdict: string): 'blocking' | 'degraded' | 'benign' {
  if (verdict === 'fail') return 'blocking';
  if (verdict === 'review') return 'degraded';
  return 'benign';
}

type AuditSummaryStep = {
  scriptKey?: string;
  stepName?: string;
  verdict?: string;
  issues?: Array<{ severity?: string; type?: string; description?: string }>;
};

type AuditSummary = {
  scriptKey?: string;
  runId?: string;
  runTs?: string;
  steps?: AuditSummaryStep[];
};

/** 收集一个 scriptKey 的所有可用审计 run（当前实现直接扫全部 summary，按 scriptKey 分组） */
function collectAuditSummaries(auditRoot: string): Map<string, AuditSummary[]> {
  const byScript = new Map<string, AuditSummary[]>();
  const runsDir = path.join(auditRoot, 'runs');
  if (fs.existsSync(runsDir)) {
    for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const summaryPath = path.join(runsDir, entry.name, 'summary.json');
      if (!fs.existsSync(summaryPath)) continue;
      try {
        const s = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as AuditSummary;
        if (!s.scriptKey || !Array.isArray(s.steps)) continue;
        const list = byScript.get(s.scriptKey) || [];
        list.push(s);
        byScript.set(s.scriptKey, list);
      } catch {
        /* 单个 run 摘要损坏跳过 */
      }
    }
  }
  return byScript;
}

function severityRank(sev: string): number {
  if (sev === 'blocker') return 3;
  if (sev === 'warning') return 2;
  if (sev === 'info') return 1;
  return 0;
}

/** 过滤降级说明与 noise，只保留对客户有价值的描述 */
function cleanDescription(description: string): boolean {
  return !description.includes('已降级为规则分析')
    && !description.includes('mock 模式无法')
    && !description.includes('请启用 AI 视觉');
}

/**
 * stepName 归一化索引键。
 * 两侧格式不同：
 * - 审计侧（ui-audit.ts deriveStep）：`request-search · normal · main request`（__ → ' · '）
 * - 报告侧（compare-screenshots-scan）：`request-search`（route 拆分）或 `request-search__normal__main_request`
 * 统一取第一段（` · ` / `__` 之前），空串/unknown 返回 null 不参与匹配。
 */
export function stepNameIndexKey(stepName: string): string | null {
  const short = stepName.split(/[·_]{2}/)[0]?.trim() || stepName.trim();
  const key = short.toLowerCase();
  if (!key || key === 'unknown') return null;
  return key;
}

export function readAuditInsights(
  auditRoot = path.join('results', 'ui-audit'),
): Map<string, AuditInjection> {
  /** key: `${scriptKey}::${stepName}` */
  const map = new Map<string, AuditInjection>();
  if (!fs.existsSync(auditRoot)) return map;

  const summariesByScript = collectAuditSummaries(auditRoot);
  // 顶层 latest summary 也算（ui-audit.ts 每次都会写）
  const latestPath = path.join(auditRoot, 'summary.json');
  if (fs.existsSync(latestPath)) {
    try {
      const s = JSON.parse(fs.readFileSync(latestPath, 'utf8')) as AuditSummary;
      if (s.scriptKey && Array.isArray(s.steps)) {
        const list = summariesByScript.get(s.scriptKey) || [];
        // 去重：runs/ 已有同 runId 的就不再重复计入
        if (!list.some((x) => x.runId && x.runId === s.runId)) {
          list.push(s);
          summariesByScript.set(s.scriptKey, list);
        }
      }
    } catch {
      /* ignore */
    }
  }

  for (const [scriptKey, summaries] of summariesByScript) {
    // 每个 scriptKey 取最新一份（按 runId/runTs 字符串排序，时间戳后缀单调）
    const sorted = [...summaries].sort((a, b) =>
      String(b.runId || b.runTs || '').localeCompare(String(a.runId || a.runTs || '')),
    );
    const latest = sorted[0];
    if (!latest) continue;
    for (const step of latest.steps || []) {
      if (!step.stepName) continue;
      // 同一 stepName 全格式都索引：短名 + 全名（报告侧两种格式都可能用到）
      const keys = new Set<string>();
      for (const name of [step.stepName, ...stepNameVariants(step.stepName)]) {
        keys.add(`${scriptKey}::${name}`);
      }
      const issues = (step.issues || [])
        .filter(
          (i) =>
            (i.severity === 'blocker' || i.severity === 'warning') &&
            i.description &&
            cleanDescription(i.description),
        )
        .sort((a, b) => severityRank(String(b.severity)) - severityRank(String(a.severity)))
        .map((i) => ({
          severity: String(i.severity || 'info'),
          type: String(i.type || 'other'),
          description: String(i.description || ''),
        }));
      for (const key of keys) {
        if (!map.has(key)) {
          map.set(key, {
            insights: issues,
            verdict: String(step.verdict || 'skipped'),
          });
        }
      }
    }
  }
  return map;
}

/** stepName 的两种已知格式互转：`a · b · c` ↔ `a__b__c`，短名 `a` 单独成键 */
function stepNameVariants(stepName: string): string[] {
  const out = new Set<string>();
  out.add(stepName);
  const dotParts = stepName.split(' · ');
  const usParts = stepName.split('__');
  if (dotParts.length > 1) {
    // `a · b · c` → `a__b__c`（每段内部空格转下划线）
    out.add(dotParts.map((p) => p.trim().replace(/\s+/g, '_')).join('__'));
    out.add(dotParts[0]!.trim());
  } else if (usParts.length > 1) {
    // `a__b__c` → `a · b · c`（段内下划线转空格）
    out.add(usParts.map((p) => p.replace(/_/g, ' ')).join(' · '));
    out.add(usParts[0]!.trim());
  }
  return [...out].filter((s) => s && s !== 'unknown');
}

/** 注入键：与模型的 pageKey 中 stepName 部分保持一致（短名 + 全名双格式） */
export function auditKey(scriptKey: string, stepName: string): string {
  return `${scriptKey}::${stepName}`;
}
