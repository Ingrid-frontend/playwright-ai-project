#!/usr/bin/env tsx
/**
 * 读取测试结果数据 → 创建/更新飞书报告文档 → 保存文档链接
 *
 * 自动集成到通知流程：发卡片前执行此脚本，卡片即可引用文档链接。
 *
 * 用法:
 *   FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx npx tsx scripts/feishu/update-feishu-report.ts
 *
 * 也可以将 FEISHU_APP_ID / FEISHU_APP_SECRET 写入 .env 或 feishu-config.json
 *
 * 依赖:
 *   results/ui-issues.json  — 由 compare-screenshots 生成
 *   results/history/        — 历史快照与趋势
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fetchWithRetry } from './feishu-utils.js';

dotenv.config();

const SENSITIVE = process.env.ENABLE_SENSITIVE_LOGS === '1';

const DOC_TITLE = 'Playwright 自动化测试报告';
const DOC_URL_FILE = 'results/feishu-doc-url.txt';
const HISTORY_DIR = 'results/history';
const ISSUES_FILE = 'results/ui-issues.json';
const SCREENSHOTS_BASE = process.cwd();

interface FeishuConfig {
  appId: string;
  appSecret: string;
}

/* ── API 封装 ── */

async function getAccessToken(config: FeishuConfig): Promise<string> {
  const res = await fetchWithRetry('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`获取 token 失败: ${data.msg}`);
  return data.tenant_access_token;
}

async function createDocument(token: string): Promise<string> {
  const res = await fetchWithRetry('https://open.feishu.cn/open-apis/docx/v1/documents', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: DOC_TITLE }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`创建文档失败: ${data.msg}`);
  return data.data.document.document_id;
}

async function getDocumentBlocks(token: string, docId: string): Promise<string[]> {
  const res = await fetchWithRetry(`https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) return [];
  return (data.data?.items || []).map((i: any) => i.block_id);
}

async function clearDocument(token: string, docId: string): Promise<void> {
  const blockIds = await getDocumentBlocks(token, docId);
  const rootId = blockIds[0];
  const children = blockIds.slice(1);
  if (children.length === 0) return;
  // 飞书 API 要求保留根 block，只能删子 block
  for (let i = 0; i < children.length; i += 50) {
    const batch = children.slice(i, i + 50);
    await fetchWithRetry(`https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks/${rootId}/children/batch_delete`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ children_to_delete: batch }),
    }).catch(() => {});
  }
}

async function addBlocks(token: string, docId: string, blocks: any[]): Promise<void> {
  if (blocks.length === 0) return;
  const rootId = docId;
  // 飞书 API：批量添加至根节点
  const batchSize = 20;
  for (let i = 0; i < blocks.length; i += batchSize) {
    const batch = blocks.slice(i, i + batchSize);
    const children_id = batch.map((_, j) => `b${i + j}`);
    const payload: any = { index: -1, children_id, descendants: batch.map((b, j) => ({ block_id: `b${i + j}`, ...b })) };
    const res = await fetchWithRetry(`https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks/${rootId}/descendant`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.code !== 0) {
      console.log(`⚠️  添加内容块失败 (batch ${i}): ${data.msg}`);
    }
    if (i + batchSize < blocks.length) await new Promise(r => setTimeout(r, 100));
  }
}

async function uploadImage(token: string, filePath: string): Promise<string | null> {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'image/png' }), fileName);
  const res = await fetchWithRetry(`https://open.feishu.cn/open-apis/drive/v1/medias/upload_all?size=${buf.length}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form,
  }).catch(() => null);
  if (!res) return null;
  const data = await res.json();
  if (data.code !== 0) return null;
  return data.file?.token || null;
}

function shareUrl(docId: string): string {
  return `https://bytedance.feishu.cn/docx/${docId}`;
}

function saveDocUrl(url: string): void {
  const dir = path.dirname(DOC_URL_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DOC_URL_FILE, url, 'utf-8');
  console.log(`💾 文档链接已保存: ${DOC_URL_FILE}`);
}

/* ── 报告数据读取 ── */

function readIssues(): { blocker: number; warning: number; total: number; items: any[] } {
  const p = path.join(process.cwd(), ISSUES_FILE);
  if (!fs.existsSync(p)) return { blocker: 0, warning: 0, total: 0, items: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const summary = raw.summary || {};
    const items = (raw.issues || []).filter((i: any) => i.severity === 'blocker' || i.severity === 'warning');
    return {
      blocker: summary.blocker || 0,
      warning: summary.warning || 0,
      total: summary.total || 0,
      items: items.slice(0, 20), // 最多 20 条
    };
  } catch { return { blocker: 0, warning: 0, total: 0, items: [] }; }
}

function readHistoryComparison(): { lastDate: string; histText: string } | null {
  const dir = path.join(process.cwd(), HISTORY_DIR);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (files.length < 2) return null;
  try {
    const curr = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf-8'));
    const last = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 2]), 'utf-8'));
    if (!curr.summary || !last.summary) return null;
    const c = curr.summary;
    const l = last.summary;
    const lastDate = files[files.length - 2].replace(/\.json$/, '');
    return {
      lastDate,
      histText: `较上次 (${lastDate})：严重 ${l.blocker}→${c.blocker}，轻微 ${l.warning}→${c.warning}，共 ${l.total}→${c.total}`,
    };
  } catch { return null; }
}

/* ── 文档内容块构建 ── */

function buildBlocks(issues: ReturnType<typeof readIssues>, hist: ReturnType<typeof readHistoryComparison>): any[] {
  const blocks: any[] = [];
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  // 标题
  blocks.push({ block_type: 3, heading1: { elements: [{ text_run: { content: '📊 自动化测试报告', text_element_style: { bold: true } } }] } });
  blocks.push({ block_type: 2, text: { elements: [{ text_run: { content: `生成时间：${now}` } }] } });

  if (hist) {
    blocks.push({ block_type: 2, text: { elements: [{ text_run: { content: hist.histText } }] } });
  }

  // 概述
  blocks.push({ block_type: 4, heading2: { elements: [{ text_run: { content: '📋 概述', text_element_style: { bold: true } } }] } });

  const passed = issues.blocker === 0;
  const statusEmoji = passed ? '✅' : '❌';
  const statusText = passed ? '通过' : '未通过';
  blocks.push({ block_type: 2, text: { elements: [{ text_run: { content: `${statusEmoji} 截图对比：${statusText}` } }] } });
  blocks.push({ block_type: 2, text: { elements: [{ text_run: { content: `严重差异：${issues.blocker} 项` } }] } });
  blocks.push({ block_type: 2, text: { elements: [{ text_run: { content: `轻微差异：${issues.warning} 项` } }] } });
  blocks.push({ block_type: 2, text: { elements: [{ text_run: { content: `共计：${issues.total} 项` } }] } });

  // 差异列表
  if (issues.items.length > 0) {
    blocks.push({ block_type: 4, heading2: { elements: [{ text_run: { content: '🔍 差异详情', text_element_style: { bold: true } } }] } });

    for (const item of issues.items) {
      const sevEmoji = item.severity === 'blocker' ? '🔴' : '🟡';
      const pct = ((item.difference || 0) * 100).toFixed(1);
      const step = item.stepName || `步骤 ${item.stepNumber}`;
      const script = (item.scriptKey || '').replace(/^stage\//, '');
      blocks.push({ block_type: 5, heading3: { elements: [{ text_run: { content: `${sevEmoji} ${script} / ${step}` } }] } });
      blocks.push({ block_type: 2, text: { elements: [{ text_run: { content: `差异率：${pct}%` } }] } });
      blocks.push({ block_type: 2, text: { elements: [{ text_run: { content: `浏览器：${item.browser || 'chrome'}` } }] } });
      if (item.compareKind === 'cross-browser') {
        blocks.push({ block_type: 2, text: { elements: [{ text_run: { content: '对比类型：跨浏览器 (Chrome vs WebKit)' } }] } });
      }
      // 如果 diff 图存在且可上传，在此插入图片块（后续增强）
    }
  }

  // 底部说明
  blocks.push({ block_type: 4, heading2: { elements: [{ text_run: { content: '📎 相关链接', text_element_style: { bold: true } } }] } });
  blocks.push({ block_type: 2, text: { elements: [{ text_run: { content: '完整 HTML 报告及截图可在 GitHub Actions Artifacts 中下载。' } }] } });

  return blocks;
}

/* ── 主流程 ── */

async function main(): Promise<boolean> {
  const issues = readIssues();
  const hist = readHistoryComparison();

  console.log(`📊 读取到 ${issues.total} 条差异（严重 ${issues.blocker}，轻微 ${issues.warning}）`);

  const config: FeishuConfig = {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
  };

  if (!config.appId || !config.appSecret) {
    try {
      const cfg = JSON.parse(fs.readFileSync('feishu-config.json', 'utf-8'));
      config.appId = cfg.appId || config.appId;
      config.appSecret = cfg.appSecret || config.appSecret;
    } catch { /* ignore */ }
  }

  if (!config.appId || !config.appSecret) {
    console.log('⚠️  未配置飞书开放平台 App ID / App Secret，跳过文档更新');
    return false;
  }

  console.log('🔑 获取访问令牌...');
  const token = await getAccessToken(config);
  console.log('✅ 令牌获取成功');

  // 检查是否有已创建的文档
  let docId = '';
  if (fs.existsSync(DOC_URL_FILE)) {
    const saved = fs.readFileSync(DOC_URL_FILE, 'utf-8').trim();
    const m = saved.match(/docx\/([a-zA-Z0-9_-]+)/);
    if (m) docId = m[1];
  }

  if (!docId) {
    console.log('📄 创建新文档...');
    docId = await createDocument(token);
    console.log(`✅ 文档创建成功: ${docId}`);
  } else {
    console.log(`📄 更新已有文档: ${docId}`);
  }

  console.log('🧹 清空旧内容...');
  await clearDocument(token, docId);
  console.log('✅ 旧内容已清空');

  console.log('📝 写入新内容...');
  const blocks = buildBlocks(issues, hist);
  await addBlocks(token, docId, blocks);
  console.log(`✅ 写入完成（${blocks.length} 个内容块）`);

  const url = shareUrl(docId);
  saveDocUrl(url);
  console.log(`📄 文档链接: ${url}`);
  return true;
}

main().then((ok) => {
  process.exit(ok ? 0 : 0); // 不阻塞流程
}).catch((e) => {
  console.error('❌ 更新飞书文档失败:', e.message);
  process.exit(0); // 不阻塞主流程
});
