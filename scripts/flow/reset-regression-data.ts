#!/usr/bin/env tsx
/**
 * 重置 UI 回归本地产物 + 飞书文档内容 + 多维表记录
 *
 * 用法: npm run reset:regression-data
 * 选项: --skip-feishu  仅清本地，不动飞书
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { BitableClient } from '../feishu/bitable-client.js';
import { explainMissingBitableConfig, loadBitableRuntimeConfig } from '../feishu/bitable-schema.js';
import { fetchWithRetry } from '../feishu/feishu-utils.js';

dotenv.config();

const DOC_URL_FILE = 'results/feishu-doc-url.txt';

function rmDirContents(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.gitkeep') continue;
    const target = path.join(dir, ent.name);
    fs.rmSync(target, { recursive: true, force: true });
    count++;
  }
  return count;
}

function rmFiles(globDirs: string[], files: string[]): void {
  for (const dir of globDirs) rmDirContents(dir);
  for (const file of files) {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
}

async function getToken(appId: string, appSecret: string): Promise<string> {
  const res = await fetchWithRetry('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json() as { code: number; msg?: string; tenant_access_token?: string };
  if (data.code !== 0 || !data.tenant_access_token) throw new Error(`获取 token 失败: ${data.msg}`);
  return data.tenant_access_token;
}

async function clearFeishuDoc(appId: string, appSecret: string): Promise<void> {
  if (!fs.existsSync(DOC_URL_FILE)) {
    console.log('ℹ️  无 feishu-doc-url.txt，跳过文档清空');
    return;
  }
  const saved = fs.readFileSync(DOC_URL_FILE, 'utf-8').trim();
  const m = saved.match(/docx\/([a-zA-Z0-9_-]+)/);
  if (!m) {
    console.log('ℹ️  文档 URL 无法解析 docId，跳过');
    return;
  }
  const docId = m[1]!;
  const token = await getToken(appId, appSecret);
  const blocksRes = await fetchWithRetry(`https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const blocksData = await blocksRes.json() as { data?: { items?: Array<{ block_id: string }> } };
  const blockIds = (blocksData.data?.items ?? []).map((item) => item.block_id);
  const rootId = blockIds[0];
  const children = blockIds.slice(1);
  if (!rootId || !children.length) {
    console.log('✅ 飞书文档已是空内容');
    return;
  }
  for (let i = 0; i < children.length; i += 50) {
    const batch = children.slice(i, i + 50);
    await fetchWithRetry(
      `https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks/${rootId}/children/batch_delete`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ children_to_delete: batch }),
      },
    );
  }
  console.log(`✅ 飞书文档已清空内容 (${docId})`);
}

async function clearBitable(): Promise<void> {
  const config = loadBitableRuntimeConfig();
  if (!config) {
    console.log(`ℹ️  跳过多维表清空：${explainMissingBitableConfig()}`);
    return;
  }
  const client = new BitableClient(config);
  const tables = [
    { label: '执行记录', id: config.runTableId },
    { label: '问题明细', id: config.issueTableId },
    { label: '日汇总', id: config.dailySummaryTableId },
  ];
  for (const table of tables) {
    if (!table.id) continue;
    const count = await client.clearTable(table.id);
    console.log(`✅ 多维表 ${table.label}：删除 ${count} 条记录`);
  }
}

async function main(): Promise<void> {
  const skipFeishu = process.argv.includes('--skip-feishu');
  console.log('\n🧹 重置 UI 回归数据\n');

  if (!skipFeishu) {
    const appId = process.env.FEISHU_APP_ID || '';
    const appSecret = process.env.FEISHU_APP_SECRET || '';
    if (appId && appSecret) {
      await clearFeishuDoc(appId, appSecret);
      await clearBitable();
    } else {
      console.log('ℹ️  未配置 FEISHU_APP_ID/SECRET，跳过飞书侧清空');
    }
  } else {
    console.log('⏭️  --skip-feishu：跳过飞书文档与多维表');
  }

  const localDirs = ['screenshots', 'screenshots-baseline', 'results/diffs', 'results/history', 'results/ui-regression', 'results/jobs'];
  const localFiles = [
    'results/ui-issues.json',
    'results/ui-issues-analysis.md',
    'results/screenshot-comparison.html',
    'results/feishu-doc-url.txt',
    'results/feishu-bitable-record.json',
    'results/quality-dashboard.html',
  ];
  for (const dir of localDirs) {
    const n = rmDirContents(dir);
    if (n) console.log(`✅ 已清空 ${dir}/ (${n} 项)`);
  }
  for (const file of localFiles) {
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      console.log(`✅ 已删除 ${file}`);
    }
  }

  console.log('\n✅ 重置完成\n');
}

main().catch((error: unknown) => {
  console.error('❌ 重置失败:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
