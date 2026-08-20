import type { UiIssue, UiIssueSeverity, UiIssuesReport } from './ui-issues.js';
import { resolveAiReviewConfig } from './ui-regression-config.js';
import { applyAiReviews, canRunAiVisionReview } from './ui-issue-ai-review.js';

export type ReviewVerdict = 'ui_bug' | 'likely_noise' | 'unstable' | 'needs_human';

export interface UiIssueReview {
  verdict: ReviewVerdict;
  reason: string;
  confidence: number;
  source: 'rule' | 'ai';
}

export interface ReviewSummary {
  uiBug: number;
  likelyNoise: number;
  unstable: number;
  needsHuman: number;
  reviewed: number;
  aiUpdated?: number;
}

const SEV_RANK: Record<UiIssueSeverity, number> = {
  blocker: 4,
  warning: 3,
  noise: 2,
  info: 1,
};

function stepKey(issue: UiIssue): string {
  const label = issue.stepName.replace(/-before$/i, '').replace(/-after$/i, '').replace(/-skipped$/i, '').trim();
  return `${issue.scriptKey}|${issue.stepNumber}|${label}|${issue.browser}`;
}

function meetsMinSeverity(severity: UiIssueSeverity, min: 'warning' | 'blocker'): boolean {
  if (min === 'blocker') return severity === 'blocker';
  return severity === 'blocker' || severity === 'warning';
}

function ruleReview(issue: UiIssue, peers: UiIssue[]): UiIssueReview {
  const structureTypes = peers
    .filter((p) => p.compareKind === 'structure')
    .map((p) => p.structureType)
    .filter(Boolean);

  if (structureTypes.includes('missing-selector')) {
    return {
      verdict: 'ui_bug',
      reason: '关键选择器缺失，疑似页面结构/入口异常',
      confidence: 0.9,
      source: 'rule',
    };
  }
  if (structureTypes.includes('bbox-drift')) {
    return {
      verdict: 'ui_bug',
      reason: '关键区域布局偏移超阈值，疑似 UI 布局问题',
      confidence: issue.severity === 'blocker' ? 0.85 : 0.7,
      source: 'rule',
    };
  }
  if (structureTypes.includes('horizontal-overflow')) {
    return {
      verdict: 'ui_bug',
      reason: '检测到横向溢出',
      confidence: 0.75,
      source: 'rule',
    };
  }

  const kinds = new Set(peers.map((p) => p.compareKind));
  const hasGolden = kinds.has('golden') || kinds.has('last-green');
  const hasRunDrift = kinds.has('run-drift');
  const hasCross = kinds.has('cross-browser');
  const hasStructure = kinds.has('structure');

  if (hasRunDrift && !hasGolden && !hasStructure) {
    return {
      verdict: 'unstable',
      reason: '仅运行间差异，未见基线回归；优先排查闪动/数据不稳定',
      confidence: 0.7,
      source: 'rule',
    };
  }

  if (hasCross && !hasGolden && !hasStructure && !hasRunDrift) {
    return {
      verdict: 'likely_noise',
      reason: '仅跨浏览器渲染差异，通常非业务 UI 缺陷',
      confidence: 0.65,
      source: 'rule',
    };
  }

  if (issue.sizeMismatch && issue.difference >= 0.005) {
    return {
      verdict: 'needs_human',
      reason: '截图尺寸不一致且差异较大，需人工确认布局是否变化',
      confidence: 0.6,
      source: 'rule',
    };
  }

  if (hasStructure && issue.compareKind !== 'structure') {
    return {
      verdict: 'ui_bug',
      reason: '同一步骤同时存在像素差异与结构告警',
      confidence: 0.8,
      source: 'rule',
    };
  }

  if (hasGolden && issue.severity === 'blocker') {
    return {
      verdict: 'needs_human',
      reason: '相对基线出现严重像素差异，需结合 diff 图确认',
      confidence: 0.55,
      source: 'rule',
    };
  }

  if (hasGolden) {
    return {
      verdict: 'needs_human',
      reason: '相对基线有可感知差异，建议人工查看 diff',
      confidence: 0.5,
      source: 'rule',
    };
  }

  return {
    verdict: 'needs_human',
    reason: '请结合 diff 图人工确认',
    confidence: 0.4,
    source: 'rule',
  };
}

export function summarizeReviews(issues: UiIssue[]): ReviewSummary {
  const summary: ReviewSummary = {
    uiBug: 0,
    likelyNoise: 0,
    unstable: 0,
    needsHuman: 0,
    reviewed: 0,
  };
  for (const issue of issues) {
    if (!issue.review) continue;
    summary.reviewed++;
    if (issue.review.verdict === 'ui_bug') summary.uiBug++;
    else if (issue.review.verdict === 'likely_noise') summary.likelyNoise++;
    else if (issue.review.verdict === 'unstable') summary.unstable++;
    else summary.needsHuman++;
  }
  return summary;
}

/** 对 warning+ 问题做规则复审；aiReview.enabled 且有 ANTHROPIC_API_KEY 时用 Vision 覆盖 */
export async function attachIssueReviews(report: UiIssuesReport): Promise<ReviewSummary> {
  const cfg = resolveAiReviewConfig();
  const candidates = report.issues
    .filter((i) => meetsMinSeverity(i.severity, cfg.minSeverity))
    .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.difference - a.difference)
    .slice(0, Math.max(1, cfg.maxItems));

  const peerMap = new Map<string, UiIssue[]>();
  for (const issue of report.issues) {
    const key = stepKey(issue);
    if (!peerMap.has(key)) peerMap.set(key, []);
    peerMap.get(key)!.push(issue);
  }

  const reviewedIds = new Set(candidates.map((c) => c.issueId));
  for (const issue of report.issues) {
    if (!reviewedIds.has(issue.issueId)) continue;
    const peers = peerMap.get(stepKey(issue)) || [issue];
    issue.review = ruleReview(issue, peers);
  }

  let aiUpdated = 0;
  if (cfg.enabled) {
    if (!canRunAiVisionReview()) {
      console.log('ℹ️  aiReview.enabled=true，但未配置 ANTHROPIC_API_KEY，跳过 Vision 复审');
    } else if (candidates.length > 0) {
      console.log(`🤖 Vision 复审中（最多 ${candidates.length} 条）…`);
      aiUpdated = await applyAiReviews(candidates);
      console.log(`   Vision 已更新 ${aiUpdated} 条判定`);
    }
  }

  const summary = summarizeReviews(report.issues);
  summary.aiUpdated = aiUpdated;
  report.summary.review = summary;
  return summary;
}
