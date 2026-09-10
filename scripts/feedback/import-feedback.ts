#!/usr/bin/env tsx
/**
 * 从飞书「UI 细节例外」表或本地 manual-feedback.json 导入规则，闭环到自动回归。
 *
 * npm run feedback:import
 * npm run feedback:import -- --dry-run
 * npm run feedback:import -- --local-only
 * npm run feedback:import -- --feishu-only
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { BitableClient } from '../feishu/bitable-client.js';
import { FEEDBACK_FIELDS, loadBitableRuntimeConfig } from '../feishu/bitable-schema.js';
import { fieldText } from '../feishu/write-feedback-bitable.js';
import {
  MANUAL_FEEDBACK_FILE,
  parseAssignees,
  readManualFeedbackList,
  type ManualFeedbackEntry,
} from '../report/ui-feedback-doc.js';
import type { AuditRuleEntry } from '../report/ui-audit-rules.js';

dotenv.config();

const RULES_PATH = path.join('config', 'ui-audit-rules.json');
const REGRESSION_PATH = path.join('config', 'ui-regression.json');
const IMPORT_LOG = 'results/feedback-import-log.json';
const FIELD_MAP_PATH = path.join('config', 'feedback-import.json');

type FieldMapConfig = {
  fields?: Partial<typeof FEEDBACK_FIELDS> & {
    description?: string;
    reporter?: string;
    pageUrl?: string;
    route?: string;
    selector?: string;
    xpath?: string;
    status?: string;
    env?: string;
  };
  importOnlyStatus?: string[];
  defaultScript?: string;
};

type ImportItem = {
  id: string;
  reporter: string;
  description: string;
  url?: string;
  route?: string;
  selector?: string;
  env?: string;
  status?: string;
};

function loadFieldMap(): FieldMapConfig {
  if (!fs.existsSync(FIELD_MAP_PATH)) {
    return {
      fields: {
        description: FEEDBACK_FIELDS.description,
        reporter: FEEDBACK_FIELDS.reporter,
        pageUrl: FEEDBACK_FIELDS.pageUrl,
        route: FEEDBACK_FIELDS.route,
        selector: FEEDBACK_FIELDS.selector,
        xpath: FEEDBACK_FIELDS.xpath,
        status: FEEDBACK_FIELDS.status,
        env: FEEDBACK_FIELDS.env,
      },
      importOnlyStatus: ['待处理', 'open', '处理中'],
      defaultScript: 'flows/request-flow',
    };
  }
  try {
    return JSON.parse(fs.readFileSync(FIELD_MAP_PATH, 'utf-8')) as FieldMapConfig;
  } catch {
    return {};
  }
}

function readField(record: Record<string, unknown>, fieldName?: string): string {
  if (!fieldName) return '';
  return fieldText(record[fieldName]);
}

function guessScriptKey(item: ImportItem, defaultScript: string): string {
  const route = item.route || item.url || '';
  if (/request|申请/.test(route)) return 'flows/request-flow';
  if (/approv|审批/.test(route)) return 'intent/dev';
  if (item.description.includes('申请')) return 'flows/request-flow';
  if (item.description.includes('审批')) return 'intent/dev';
  return defaultScript;
}

function buildExpectLine(item: ImportItem): string {
  const assignees = parseAssignees(item.description);
  const text = item.description.replace(/@\S+/g, '').trim();
  const who = assignees.length ? `@${assignees.join(' @')} ` : '';
  return `${who}${text}`.trim();
}

function mergeAuditRules(existing: AuditRuleEntry[], item: ImportItem, scriptKey: string): AuditRuleEntry[] {
  const expectLine = buildExpectLine(item);
  if (!expectLine) return existing;
  const idx = existing.findIndex((r) => r.script === scriptKey && !r.step);
  if (idx >= 0) {
    const rule = existing[idx]!;
    const expects = rule.expect ?? [];
    if (!expects.includes(expectLine)) {
      rule.expect = [...expects, expectLine];
    }
    return existing;
  }
  return [...existing, { script: scriptKey, expect: [expectLine] }];
}

function mergeStructureCheck(
  regression: Record<string, unknown>,
  item: ImportItem,
  scriptKey: string,
): boolean {
  if (!item.selector) return false;
  const sc = regression.structureChecks as { items?: Array<{ key: string; selector: string; script?: string; required?: boolean }> } | undefined;
  if (!sc?.items) return false;
  const key = `feedback-${item.id.slice(-8)}`;
  if (sc.items.some((i) => i.key === key)) return false;
  sc.items.push({
    key,
    selector: item.selector,
    script: scriptKey,
    required: false,
  });
  return true;
}

async function loadFromFeishu(map: FieldMapConfig): Promise<ImportItem[]> {
  const config = loadBitableRuntimeConfig();
  if (!config?.feedbackTableId) {
    console.log('ℹ️  未配置 feedbackTableId，跳过飞书读取');
    return [];
  }
  const client = new BitableClient(config);
  const records = await client.listRecords(config.feedbackTableId);
  const f = map.fields || {};
  const statusFilter = map.importOnlyStatus;
  const out: ImportItem[] = [];
  for (const rec of records) {
    const fields = rec.fields || {};
    const status = readField(fields, f.status);
    if (statusFilter?.length && status && !statusFilter.includes(status)) continue;
    const description = readField(fields, f.description);
    if (!description) continue;
    out.push({
      id: readField(fields, FEEDBACK_FIELDS.feedbackId) || rec.record_id,
      reporter: readField(fields, f.reporter),
      description,
      url: readField(fields, f.pageUrl),
      route: readField(fields, f.route),
      selector: readField(fields, f.selector),
      env: readField(fields, f.env),
      status,
    });
  }
  return out;
}

function loadFromLocal(): ImportItem[] {
  return readManualFeedbackList().map((e: ManualFeedbackEntry) => ({
    id: e.id,
    reporter: e.reporter,
    description: e.description,
    url: e.url,
    route: e.url,
    selector: e.selector,
    env: e.env,
    status: '待处理',
  }));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const localOnly = process.argv.includes('--local-only');
  const feishuOnly = process.argv.includes('--feishu-only');
  const map = loadFieldMap();
  const defaultScript = map.defaultScript || 'flows/request-flow';

  const items: ImportItem[] = [];
  if (!feishuOnly) items.push(...loadFromLocal());
  if (!localOnly) items.push(...(await loadFromFeishu(map)));

  const seen = new Set<string>();
  const unique = items.filter((i) => {
    const k = `${i.description}|${i.selector || ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (!unique.length) {
    console.log('ℹ️  无待导入的 UI 反馈');
    return;
  }

  let rules: AuditRuleEntry[] = [];
  if (fs.existsSync(RULES_PATH)) {
    try {
      const json = JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8')) as { rules?: AuditRuleEntry[] };
      rules = Array.isArray(json.rules) ? [...json.rules] : [];
    } catch {
      rules = [];
    }
  }

  let regression: Record<string, unknown> = {};
  if (fs.existsSync(REGRESSION_PATH)) {
    try {
      regression = JSON.parse(fs.readFileSync(REGRESSION_PATH, 'utf-8')) as Record<string, unknown>;
    } catch {
      regression = {};
    }
  }
  if (!regression.structureChecks) {
    regression.structureChecks = { enabled: true, items: [] };
  }

  const log: Array<{ id: string; scriptKey: string; expect: string; structureAdded: boolean }> = [];
  for (const item of unique) {
    const scriptKey = guessScriptKey(item, defaultScript);
    const beforeLen = rules.length;
    rules = mergeAuditRules(rules, item, scriptKey);
    const structureAdded = mergeStructureCheck(regression, item, scriptKey);
    log.push({
      id: item.id,
      scriptKey,
      expect: buildExpectLine(item),
      structureAdded,
    });
    if (rules.length === beforeLen && !structureAdded) {
      console.log(`  ⏭️  已存在: ${item.id.slice(0, 12)}…`);
    } else {
      console.log(`  ✅ 导入 ${item.id.slice(0, 12)}… → ${scriptKey}`);
    }
  }

  if (dryRun) {
    console.log(`\n[dry-run] 将更新 ${log.length} 条 → ui-audit-rules + structureChecks`);
    return;
  }

  fs.writeFileSync(RULES_PATH, JSON.stringify({ rules }, null, 2) + '\n', 'utf-8');
  fs.writeFileSync(REGRESSION_PATH, JSON.stringify(regression, null, 2) + '\n', 'utf-8');
  fs.mkdirSync(path.dirname(IMPORT_LOG), { recursive: true });
  fs.writeFileSync(
    IMPORT_LOG,
    JSON.stringify({ importedAt: new Date().toISOString(), count: log.length, items: log }, null, 2),
    'utf-8',
  );
  console.log(`\n✅ 已导入 ${log.length} 条反馈 → ${RULES_PATH} / ${REGRESSION_PATH}`);
  console.log(`   日志: ${IMPORT_LOG}`);
}

main().catch((e) => {
  console.error('❌ feedback:import 失败:', e instanceof Error ? e.message : e);
  process.exit(1);
});
