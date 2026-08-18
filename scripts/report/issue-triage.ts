import type { UiIssue, UiIssuesReport } from './ui-issues.js';

export type TriageStatus = 'confirmed' | 'pending' | 'ignored';

export interface TriageSummary {
  confirmed: number;
  pending: number;
  ignored: number;
}

export interface VisualReviewDecision {
  issueId: string;
  verdict: 'approved' | 'rejected';
}

export function resolveTriageStatus(issue: UiIssue): TriageStatus {
  if (issue.compareKind === 'run-drift') return 'ignored';
  if (issue.compareKind === 'style-drift' && issue.severity === 'blocker') return 'confirmed';
  if (issue.review?.verdict === 'ui_bug') return 'confirmed';
  if (issue.review?.verdict === 'likely_noise') return 'ignored';
  if (issue.severity === 'warning') return 'pending';
  if (issue.compareKind === 'structure' && issue.structureType === 'missing-selector') {
    return issue.severity === 'blocker' ? 'pending' : 'ignored';
  }
  if (issue.severity === 'blocker') return 'pending';
  return 'pending';
}

export function attachTriageStatus(issues: UiIssue[], decisions: VisualReviewDecision[] = []): void {
  const map = new Map(decisions.map((d) => [d.issueId, d]));
  for (const issue of issues) {
    const decision = map.get(issue.issueId);
    if (decision?.verdict === 'approved') {
      issue.triageStatus = 'confirmed';
      continue;
    }
    if (decision?.verdict === 'rejected') {
      issue.triageStatus = 'ignored';
      continue;
    }
    issue.triageStatus = resolveTriageStatus(issue);
  }
}

export function summarizeTriage(issues: UiIssue[]): TriageSummary {
  const summary: TriageSummary = { confirmed: 0, pending: 0, ignored: 0 };
  for (const issue of issues) {
    const s = issue.triageStatus || resolveTriageStatus(issue);
    summary[s]++;
  }
  return summary;
}

export function applyTriageToReport(report: UiIssuesReport, decisions: VisualReviewDecision[] = []): void {
  attachTriageStatus(report.issues, decisions);
  const triage = summarizeTriage(report.issues);
  (report.summary as UiIssuesReport['summary'] & { triage?: TriageSummary }).triage = triage;
}
