#!/usr/bin/env tsx
/**
 * 将 flow 运行记录追加到当周飞书周报（每周一篇，不清空历史）。
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fetchWithRetry } from './feishu-utils.js';
import type { FlowId, FlowRunManifest } from '../../src/utils/flow-run-report.js';
import { flowLabel, readLastRun } from '../../src/utils/flow-run-report.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const INDEX_REL = 'results/feishu-docs/weekly-index.json';
const DOCS_DIR = 'results/feishu-docs';

type FeishuConfig = { appId: string; appSecret: string };

type WeekEntry = { documentId: string; url: string; weekKey: string };

function weekKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  const utc = new Date(Date.UTC(y, m - 1, d));
  const day = utc.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + diff);
  return utc.toISOString().slice(0, 10);
}

function loadConfig(): FeishuConfig {
  let appId = process.env.FEISHU_APP_ID?.trim() || '';
  let appSecret = process.env.FEISHU_APP_SECRET?.trim() || '';
  if (!appId || !appSecret) {
    try {
      const cfg = JSON.parse(fs.readFileSync('feishu-config.json', 'utf-8')) as FeishuConfig;
      appId = appId || cfg.appId || '';
      appSecret = appSecret || cfg.appSecret || '';
    } catch {
      /* ignore */
    }
  }
  return { appId, appSecret };
}

async function getToken(config: FeishuConfig): Promise<string> {
  const res = await fetchWithRetry('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`token: ${data.msg}`);
  return data.tenant_access_token as string;
}

async function createDocument(token: string, title: string, folderToken?: string): Promise<string> {
  const body: Record<string, string> = { title };
  if (folderToken) body.folder_token = folderToken;
  const res = await fetchWithRetry('https://open.feishu.cn/open-apis/docx/v1/documents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`创建文档: ${data.msg}`);
  return data.data.document.document_id as string;
}

async function addBlocks(token: string, docId: string, blocks: object[]): Promise<void> {
  if (!blocks.length) return;
  const batchSize = 20;
  for (let i = 0; i < blocks.length; i += batchSize) {
    const batch = blocks.slice(i, i + batchSize);
    const children_id = batch.map((_, j) => `b${i + j}`);
    const payload = {
      index: -1,
      children_id,
      descendants: batch.map((b, j) => ({ block_id: `b${i + j}`, ...b })),
    };
    const res = await fetchWithRetry(
      `https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks/${docId}/descendant`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    const data = await res.json();
    if (data.code !== 0) console.log(`⚠️  追加块失败: ${data.msg}`);
    if (i + batchSize < blocks.length) await new Promise((r) => setTimeout(r, 120));
  }
}

function textBlock(content: string, heading?: number): object {
  const el = { text_run: { content } };
  if (heading === 1) return { block_type: 3, heading1: { elements: [el] } };
  if (heading === 2) return { block_type: 4, heading2: { elements: [el] } };
  return { block_type: 2, text: { elements: [el] } };
}

function loadIndex(): Record<string, Record<string, WeekEntry>> {
  const p = path.join(process.cwd(), INDEX_REL);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, Record<string, WeekEntry>>;
  } catch {
    return {};
  }
}

function saveIndex(index: Record<string, Record<string, WeekEntry>>): void {
  const dir = path.join(process.cwd(), DOCS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), INDEX_REL), JSON.stringify(index, null, 2), 'utf-8');
}

function buildRunBlocks(run: FlowRunManifest): object[] {
  const status = run.ok ? '✅ 通过' : '❌ 失败';
  const when = new Date(run.finishedAt || run.startedAt).toLocaleString('zh-CN', { hour12: false });
  const blocks: object[] = [];
  blocks.push(textBlock(`── ${when} · ${run.env} ──`, 2));
  blocks.push(textBlock(`状态：${status}`));
  blocks.push(textBlock(`用例：${run.spec || '-'}`));
  blocks.push(textBlock(`耗时：${run.durationSec ?? '-'}s · 通过/失败：${run.passed ?? 0}/${run.failed ?? 0}`));
  if ((run as { apiFailureCount?: number }).apiFailureCount) {
    blocks.push(textBlock(`接口报错：${(run as { apiFailureCount?: number }).apiFailureCount} 条`));
  }
  const reportBase = (process.env.FEISHU_REPORT_URL || '').trim().replace(/\/$/, '');
  if (reportBase && run.playwrightReportRel) {
    blocks.push(textBlock(`Playwright：${reportBase}/repo-report/${run.playwrightReportRel}`));
  }
  if (run.failures?.length) {
    const msg = run.failures
      .slice(0, 3)
      .map((f) => `${f.title || '用例'}: ${(f.message || '').slice(0, 120)}`)
      .join('\n');
    blocks.push(textBlock(`失败摘要：${msg}`));
  }
  return blocks;
}

async function main(): Promise<void> {
  const flowId = (process.argv.find((a) => a.startsWith('--flow='))?.slice(7) || 'request-flow') as FlowId;
  const run = readLastRun(flowId);
  if (!run) {
    console.log('无 flow 运行记录，跳过周报');
    return;
  }

  const config = loadConfig();
  if (!config.appId || !config.appSecret) {
    console.log('未配置飞书应用，跳过周报');
    return;
  }

  const wk = weekKey();
  const index = loadIndex();
  const flowIndex = index[flowId] || {};
  let entry = flowIndex[wk];

  const token = await getToken(config);
  const folderToken = process.env.FEISHU_DOC_FOLDER_TOKEN?.trim() || '';

  if (!entry) {
    const title = `${flowLabel(flowId)} · ${run.env} · 周报 ${wk}`;
    console.log(`创建周报: ${title}`);
    const docId = await createDocument(token, title, folderToken || undefined);
    const url = `https://feishu.cn/docx/${docId}`;
    entry = { documentId: docId, url, weekKey: wk };
    flowIndex[wk] = entry;
    index[flowId] = flowIndex;
    saveIndex(index);
    const blocks = [textBlock(`${flowLabel(flowId)} 周报（${wk}）`, 1), textBlock(`环境：${run.env}`)];
    await addBlocks(token, docId, blocks);
  }

  const blocks = buildRunBlocks(run);
  await addBlocks(token, entry.documentId, blocks);

  const dir = path.join(process.cwd(), DOCS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${flowId}-week-url.txt`), entry.url, 'utf-8');
  fs.writeFileSync(path.join(process.cwd(), 'results/feishu-doc-url.txt'), entry.url, 'utf-8');

  console.log(`周报已追加: ${entry.url}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(0);
});
