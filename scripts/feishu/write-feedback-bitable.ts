#!/usr/bin/env tsx
/**
 * 将手动 UI 反馈写入飞书多维表（中控 UI 采集反馈表）
 *
 * npm run feishu:feedback-write
 * npm run feishu:feedback-write -- --entry=mf-xxx
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { BitableClient } from '../feishu/bitable-client.js';
import {
  FEEDBACK_FIELDS,
  explainMissingBitableConfig,
  loadBitableRuntimeConfig,
} from '../feishu/bitable-schema.js';
import {
  MANUAL_FEEDBACK_FILE,
  readManualFeedbackList,
  type ManualFeedbackEntry,
} from '../report/ui-feedback-doc.js';

dotenv.config();

function fieldText(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (Array.isArray(raw)) return raw.map(fieldText).filter(Boolean).join(', ');
  if (typeof raw === 'object' && raw && 'text' in raw) return String((raw as { text?: string }).text || '').trim();
  return '';
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function toUrlField(url: string) {
  if (!url || !isHttpUrl(url)) return null;
  return { link: url, text: url };
}

function buildFeedbackFields(entry: ManualFeedbackEntry) {
  const bbox = entry.bbox
    ? `x=${Math.round(entry.bbox.x)},y=${Math.round(entry.bbox.y)},w=${Math.round(entry.bbox.width)},h=${Math.round(entry.bbox.height)}`
    : '';
  const publicBase = process.env.PUBLIC_REPORT_URL || process.env.FEISHU_REPORT_URL || '';
  const aiDocUrl = entry.aiDocPath && publicBase && isHttpUrl(`${publicBase.replace(/\/$/, '')}/${entry.aiDocPath}`)
    ? `${publicBase.replace(/\/$/, '')}/${entry.aiDocPath}`
    : '';
  return {
    [FEEDBACK_FIELDS.feedbackId]: entry.id,
    [FEEDBACK_FIELDS.reporter]: entry.reporter,
    [FEEDBACK_FIELDS.description]: [entry.description, entry.aiDocPath && !aiDocUrl ? `AI文档: ${entry.aiDocPath}` : ''].filter(Boolean).join('\n'),
    [FEEDBACK_FIELDS.env]: entry.env || process.env.PLAYWRIGHT_ENV || '',
    [FEEDBACK_FIELDS.pageUrl]: entry.url && isHttpUrl(entry.url) ? toUrlField(entry.url) : null,
    [FEEDBACK_FIELDS.route]: entry.url || '',
    [FEEDBACK_FIELDS.selector]: entry.selector || '',
    [FEEDBACK_FIELDS.xpath]: entry.xpath || '',
    [FEEDBACK_FIELDS.bbox]: bbox,
    [FEEDBACK_FIELDS.screenshotUrl]: entry.screenshotPath && isHttpUrl(entry.screenshotPath) ? toUrlField(entry.screenshotPath) : null,
    [FEEDBACK_FIELDS.aiDocUrl]: aiDocUrl ? toUrlField(aiDocUrl) : null,
    [FEEDBACK_FIELDS.assignees]: (entry.assignees || []).join(', '),
    [FEEDBACK_FIELDS.status]: '待处理',
    [FEEDBACK_FIELDS.createdAt]: Date.parse(entry.createdAt),
  };
}

export async function writeManualFeedbackToBitable(
  entries?: ManualFeedbackEntry[],
): Promise<{ written: number; skipped: boolean; reason?: string }> {
  const config = loadBitableRuntimeConfig();
  if (!config?.feedbackTableId) {
    return { written: 0, skipped: true, reason: '未配置 FEISHU_BITABLE_FEEDBACK_TABLE_ID / bitable.feedbackTableId' };
  }
  if (!config) {
    return { written: 0, skipped: true, reason: explainMissingBitableConfig() };
  }

  const list = entries ?? readManualFeedbackList();
  if (!list.length) return { written: 0, skipped: false };

  const client = new BitableClient(config);
  let written = 0;
  for (const entry of list) {
    if (entry.feishuRecordId) continue;
    const fields = buildFeedbackFields(entry);
    const result = await client.upsertRecord(
      config.feedbackTableId,
      FEEDBACK_FIELDS.feedbackId,
      entry.id,
      fields,
    );
    entry.feishuRecordId = result.recordId;
    written++;
  }

  if (written > 0 && !entries) {
    const file = path.resolve(MANUAL_FEEDBACK_FILE);
    fs.writeFileSync(
      file,
      JSON.stringify({ updatedAt: new Date().toISOString(), entries: list }, null, 2),
      'utf-8',
    );
  }

  return { written, skipped: false };
}

async function main() {
  const entryArg = process.argv.find((a) => a.startsWith('--entry='))?.slice('--entry='.length);
  const all = readManualFeedbackList();
  const targets = entryArg ? all.filter((e) => e.id === entryArg) : all.filter((e) => !e.feishuRecordId);
  if (!targets.length) {
    console.log('ℹ️  无待写入的手动反馈');
    return;
  }
  const result = await writeManualFeedbackToBitable(targets);
  if (result.skipped) {
    console.log(`ℹ️  跳过飞书反馈表写入：${result.reason}`);
    return;
  }
  console.log(`✅ 已写入 ${result.written} 条手动 UI 反馈到飞书多维表`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

export { fieldText };
