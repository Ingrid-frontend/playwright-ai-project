import fs from 'fs';
import type { UiIssuesReport } from './ui-issues-index.js';

const CANDIDATES = ['results/ui-issues.json', 'results/flow-ui-issues.json'];

export function resolveIssuesSource(explicitSource?: string): string | null {
  const forced = explicitSource?.trim() || process.env.UI_ISSUES_SOURCE?.trim();
  if (forced) return fs.existsSync(forced) ? forced : null;
  return (
    CANDIDATES
      .filter((f) => fs.existsSync(f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null
  );
}

export function readIssuesReport(explicitSource?: string): UiIssuesReport | null {
  const file = resolveIssuesSource(explicitSource);
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as UiIssuesReport;
  } catch {
    return null;
  }
}

export function isFlowIssuesSource(source: string | null): boolean {
  return Boolean(source?.includes('flow-ui-issues'));
}
