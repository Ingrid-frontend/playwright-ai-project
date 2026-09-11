/**
 * 客户报告机器可读摘要：飞书 / actionItems / 投递清单共用同一份三部分文案。
 */
import fs from 'fs';
import path from 'path';
import type { CoverageStats, ImpactTier } from './coverage-stats.js';
import type { CustomerIssueGroup, CustomerReportModel } from './customer-report-model.js';
import {
  formatActionItemText,
  impactTierLabel,
  type CustomerThreePartCopy,
} from './customer-report-copy.js';

export type CustomerActionItem = {
  id: string;
  title: string;
  impactTier: ImpactTier;
  label: string;
  where: string;
  change: string;
  impact: string;
  reason: string;
  text: string;
  affectedSteps: number;
  scriptLabels: string[];
  auditAttached: boolean;
};

export type CustomerBucketSummary = {
  label: '需修复' | '影响体验' | '可忽略' | '未判定';
  steps: number;
  groups?: number;
};

export type CustomerReportSummary = {
  generatedAt: string;
  countingUnit: 'step';
  shipAdvice: string;
  verdict: CoverageStats['verdict'];
  verdictLabel: string;
  buckets: {
    blocking: CustomerBucketSummary;
    degraded: CustomerBucketSummary;
    benign: CustomerBucketSummary;
    uncovered: CustomerBucketSummary;
  };
  /** 需修复 + 影响体验，飞书待办用 */
  actionItems: CustomerActionItem[];
  /** 与 actionItems 相同，兼容投递清单字段名 */
  items: CustomerActionItem[];
  /** 可忽略项，默认不进飞书待办 */
  benignItems: CustomerActionItem[];
};

function copyOf(group: CustomerIssueGroup): CustomerThreePartCopy {
  return (
    group.customerCopy || {
      where: group.title,
      change: group.reason,
      impact: group.impactTier === 'benign' ? '' : '影响待确认',
      reason: group.reason,
      source: 'pixel',
      auditAttached: false,
    }
  );
}

function toActionItem(group: CustomerIssueGroup): CustomerActionItem {
  const copy = copyOf(group);
  return {
    id: group.anchorId || group.groupKey,
    title: group.title,
    impactTier: group.impactTier,
    label: impactTierLabel(group.impactTier),
    where: copy.where,
    change: copy.change,
    impact: copy.impact,
    reason: copy.reason,
    text: formatActionItemText(group.title, copy, group.impactTier),
    affectedSteps: group.affectedSteps,
    scriptLabels: group.scriptLabels,
    auditAttached: copy.auditAttached,
  };
}

export function buildCustomerReportSummary(model: CustomerReportModel): CustomerReportSummary {
  const c = model.coverage;
  const actionItems = [...model.regressionGroups, ...model.degradedGroups].map(toActionItem);
  const benignItems = model.benignGroups.map(toActionItem);
  return {
    generatedAt: model.generatedAt,
    countingUnit: 'step',
    shipAdvice: c.shipAdvice,
    verdict: c.verdict,
    verdictLabel: c.verdictLabel,
    buckets: {
      blocking: {
        label: '需修复',
        steps: c.regressSteps,
        groups: model.regressionGroups.length,
      },
      degraded: {
        label: '影响体验',
        steps: c.degradedSteps,
        groups: model.degradedGroups.length,
      },
      benign: {
        label: '可忽略',
        steps: c.benignSteps,
        groups: model.benignGroups.length,
      },
      uncovered: {
        label: '未判定',
        steps: c.uncoveredSteps,
      },
    },
    actionItems,
    items: actionItems,
    benignItems,
  };
}

export function customerSummaryOutputPath(htmlPath: string): string {
  const abs = path.resolve(htmlPath);
  const dir = path.dirname(abs);
  const base = path.basename(abs, path.extname(abs));
  if (base === 'ui-regression-customer') {
    return path.join(dir, 'customer-report-summary.json');
  }
  return path.join(dir, `${base}-summary.json`);
}

export function writeCustomerReportSummary(model: CustomerReportModel, htmlPath: string): string {
  const out = customerSummaryOutputPath(htmlPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(buildCustomerReportSummary(model), null, 2)}\n`, 'utf-8');
  return out;
}

export function readCustomerReportSummary(htmlPath?: string): CustomerReportSummary | null {
  const candidates = [
    htmlPath ? customerSummaryOutputPath(htmlPath) : '',
    path.join('results', 'customer-report-summary.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as CustomerReportSummary;
    } catch {
      continue;
    }
  }
  return null;
}
