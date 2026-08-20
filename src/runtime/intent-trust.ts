import fs from 'fs';
import path from 'path';
import type { IntentTrustLevel } from '../types/test-intent.js';

export const INTENT_TRUST_VERSION = 1 as const;

const TRUST_DIR = path.join('results', 'history', 'intent-trust');

export interface IntentTrustRecord {
  version: typeof INTENT_TRUST_VERSION;
  intentKey: string;
  intentPath?: string;
  name: string;
  reviewRequired?: boolean;
  /** 人设（来自 YAML） */
  trustLevel?: IntentTrustLevel;
  /** 根据运行统计建议 */
  suggestedTrustLevel: IntentTrustLevel;
  runs: number;
  passed: number;
  failed: number;
  healedRuns: number;
  consecutivePass: number;
  consecutiveFail: number;
  healRate: number;
  lastPassed?: boolean;
  lastHealed?: boolean;
  lastRunAt: string;
  alerts: string[];
  updatedAt: string;
}

export interface IntentTrustUpdateInput {
  intentKey: string;
  intentPath?: string;
  name: string;
  reviewRequired?: boolean;
  trustLevel?: IntentTrustLevel;
  passed: boolean;
  healed: boolean;
  at?: string;
}

function safeKey(key: string): string {
  return (
    key
      .trim()
      .replace(/[^\w\u4e00-\u9fa5./-]+/g, '-')
      .replace(/\/+/g, '__')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'intent'
  );
}

export function resolveIntentKey(opts: {
  scriptKey?: string;
  intentPath?: string;
  name: string;
}): string {
  if (opts.scriptKey?.trim()) return opts.scriptKey.trim();
  if (opts.intentPath?.trim()) {
    const rel = path.relative(process.cwd(), path.resolve(opts.intentPath)).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..')) return rel;
    return opts.intentPath.trim();
  }
  return opts.name;
}

function recordPath(intentKey: string): string {
  return path.join(TRUST_DIR, `${safeKey(intentKey)}.json`);
}

export function loadIntentTrust(intentKey: string): IntentTrustRecord | null {
  const file = recordPath(intentKey);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as IntentTrustRecord;
  } catch {
    return null;
  }
}

export function computeSuggestedTrust(rec: {
  consecutivePass: number;
  consecutiveFail: number;
  healRate: number;
  runs: number;
  failed: number;
}): IntentTrustLevel {
  if (rec.consecutiveFail >= 2 || (rec.runs >= 3 && rec.healRate >= 0.3)) {
    return 'watch';
  }
  if (rec.consecutivePass >= 10 && rec.healRate < 0.15 && rec.failed === 0) {
    return 'stable';
  }
  if (rec.consecutivePass >= 10 && rec.healRate < 0.15) {
    return 'stable';
  }
  return 'trial';
}

export function buildAlerts(rec: IntentTrustRecord): string[] {
  const alerts: string[] = [];
  if (rec.suggestedTrustLevel === 'watch') {
    alerts.push('频繁失败或自愈，建议降权并人工复查 YAML');
  }
  if (rec.healRate >= 0.3 && rec.runs >= 3) {
    alerts.push(`自愈率 ${(rec.healRate * 100).toFixed(0)}%，定位器可能过脆`);
  }
  if (rec.reviewRequired) {
    alerts.push('reviewRequired=true：合并前须人审');
  }
  if (rec.trustLevel === 'stable' && rec.suggestedTrustLevel === 'watch') {
    alerts.push('人设 stable 与建议 watch 冲突，请复查');
  }
  return alerts;
}

export function recordIntentTrustRun(input: IntentTrustUpdateInput): IntentTrustRecord {
  const prev = loadIntentTrust(input.intentKey);
  const at = input.at || new Date().toISOString();
  const runs = (prev?.runs || 0) + 1;
  const passed = (prev?.passed || 0) + (input.passed ? 1 : 0);
  const failed = (prev?.failed || 0) + (input.passed ? 0 : 1);
  const healedRuns = (prev?.healedRuns || 0) + (input.healed ? 1 : 0);
  const consecutivePass = input.passed ? (prev?.consecutivePass || 0) + 1 : 0;
  const consecutiveFail = input.passed ? 0 : (prev?.consecutiveFail || 0) + 1;
  const healRate = runs > 0 ? healedRuns / runs : 0;

  const draft: IntentTrustRecord = {
    version: INTENT_TRUST_VERSION,
    intentKey: input.intentKey,
    intentPath: input.intentPath || prev?.intentPath,
    name: input.name,
    reviewRequired: input.reviewRequired ?? prev?.reviewRequired,
    trustLevel: input.trustLevel ?? prev?.trustLevel,
    suggestedTrustLevel: 'trial',
    runs,
    passed,
    failed,
    healedRuns,
    consecutivePass,
    consecutiveFail,
    healRate,
    lastPassed: input.passed,
    lastHealed: input.healed,
    lastRunAt: at,
    alerts: [],
    updatedAt: at,
  };
  draft.suggestedTrustLevel = computeSuggestedTrust(draft);
  draft.alerts = buildAlerts(draft);

  fs.mkdirSync(TRUST_DIR, { recursive: true });
  fs.writeFileSync(recordPath(input.intentKey), `${JSON.stringify(draft, null, 2)}\n`, 'utf-8');
  return draft;
}

export function listIntentTrustRecords(dir = TRUST_DIR): IntentTrustRecord[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf-8')) as IntentTrustRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is IntentTrustRecord => Boolean(r?.intentKey))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function formatTrustReportMarkdown(records: IntentTrustRecord[]): string {
  const lines = ['## Intent 可信度报告', '', `| 用例 | 人设 | 建议 | 通过 | 自愈率 | 告警 |`, `|---|---|---|---|---|---|`];
  if (!records.length) {
    lines.push('', '_暂无记录（先跑 `npm run intent:run`）_');
    return lines.join('\n');
  }
  for (const r of records) {
    const alert = r.alerts.length ? r.alerts.join('；') : '—';
    lines.push(
      `| ${r.name || r.intentKey} | ${r.trustLevel || '—'} | ${r.suggestedTrustLevel} | ${r.passed}/${r.runs} | ${(r.healRate * 100).toFixed(0)}% | ${alert} |`,
    );
  }
  const watches = records.filter((r) => r.suggestedTrustLevel === 'watch' || r.alerts.length);
  if (watches.length) {
    lines.push('', '### 需关注', ...watches.map((r) => `- ${r.intentKey}: ${r.alerts.join('；') || 'watch'}`));
  }
  return lines.join('\n');
}
