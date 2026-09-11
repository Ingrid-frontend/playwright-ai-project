import fs from 'fs';
import path from 'path';
import type { CoverageStats } from './coverage-stats.js';
import type { CustomerReportModel } from './customer-report-model.js';

export type CustomerBucketSummary = {
  label: '需修复' | '影响体验' | '可忽略' | '未判定';
  steps: number;
  groups?: number;
};

/**
 * 客户报告机器可读摘要。
 * passRate 语义：完全一致占比 = passSteps / comparedSteps，不含可忽略。
 */
export type CustomerReportSummary = {
  generatedAt: string;
  countingUnit: 'step';
  countingNote: string;
  buckets: {
    blocking: CustomerBucketSummary;
    degraded: CustomerBucketSummary;
    benign: CustomerBucketSummary;
    uncovered: CustomerBucketSummary;
  };
  passSteps: number;
  comparedSteps: number;
  expectedSteps: number;
  /** 完全一致占比。破坏性变更：旧值 = (passSteps + benignSteps) / comparedSteps */
  passRate: number;
  passRateLabel: '完全一致占比';
  passRateFormula: 'passSteps / comparedSteps';
  nonBlockingRate: number;
  nonBlockingRateLabel: '非阻断占比';
  nonBlockingRateFormula: '(passSteps + benignSteps) / comparedSteps';
  shipAdvice: string;
  verdict: CoverageStats['verdict'];
  verdictLabel: string;
};

export function buildCustomerReportSummary(model: CustomerReportModel): CustomerReportSummary {
  const c = model.coverage;
  return {
    generatedAt: model.generatedAt,
    countingUnit: 'step',
    countingNote:
      '首屏四个数字按步骤计数。问题清单按根因归并：同一变化影响多步只列一个问题，并同时写出影响步数。',
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
    passSteps: c.passSteps,
    comparedSteps: c.comparedSteps,
    expectedSteps: c.expectedSteps,
    passRate: c.passRate,
    passRateLabel: '完全一致占比',
    passRateFormula: 'passSteps / comparedSteps',
    nonBlockingRate: c.nonBlockingRate,
    nonBlockingRateLabel: '非阻断占比',
    nonBlockingRateFormula: '(passSteps + benignSteps) / comparedSteps',
    shipAdvice: c.shipAdvice,
    verdict: c.verdict,
    verdictLabel: c.verdictLabel,
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
