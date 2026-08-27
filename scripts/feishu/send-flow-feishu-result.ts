#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fetchWithRetry } from './feishu-utils.js';
import type { FlowId } from '../../src/utils/flow-run-report.js';
import { flowLabel, readLastRun } from '../../src/utils/flow-run-report.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function getToken(): Promise<string> {
  const appId = process.env.FEISHU_APP_ID?.trim() || '';
  const appSecret = process.env.FEISHU_APP_SECRET?.trim() || '';
  if (!appId || !appSecret) throw new Error('未配置 FEISHU_APP_ID/SECRET');
  const res = await fetchWithRetry('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.msg);
  return data.tenant_access_token as string;
}

async function sendCard(chatId: string, card: object): Promise<boolean> {
  const token = await getToken();
  const res = await fetchWithRetry('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    }),
  });
  const data = await res.json();
  return data.code === 0;
}

function readWeekUrl(flowId: FlowId): string {
  const p = path.join(process.cwd(), 'results/feishu-docs', `${flowId}-week-url.txt`);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8').trim();
  const fallback = path.join(process.cwd(), 'results/feishu-doc-url.txt');
  if (fs.existsSync(fallback)) return fs.readFileSync(fallback, 'utf-8').trim();
  return '';
}

async function main(): Promise<void> {
  const flowId = (process.argv.find((a) => a.startsWith('--flow='))?.slice(7) || 'request-flow') as FlowId;
  const chatId =
    process.argv.find((a) => a.startsWith('--chat-id='))?.slice(10)?.trim() ||
    process.env.FEISHU_CHAT_ID?.trim() ||
    '';

  if (!chatId) {
    console.log('无 chat-id，跳过通知');
    return;
  }

  const run = readLastRun(flowId);
  if (!run) return;

  const ok = Boolean(run.ok);
  const docUrl = readWeekUrl(flowId);
  const reportBase = (process.env.FEISHU_REPORT_URL || '').trim().replace(/\/$/, '');
  const pwUrl =
    reportBase && run.playwrightReportRel
      ? `${reportBase}/repo-report/${run.playwrightReportRel}`
      : '';

  const elements: object[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: [
          `**${flowLabel(flowId)}** · ${run.env}`,
          `状态：${ok ? '✅ 通过' : '❌ 失败'}`,
          `通过/失败：${run.passed ?? 0}/${run.failed ?? 0}`,
          `耗时：${run.durationSec ?? '-'}s`,
        ].join('\n'),
      },
    },
  ];

  const actions: object[] = [];
  if (docUrl) {
    actions.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '📄 本周周报' },
      type: 'primary',
      url: docUrl,
    });
  }
  if (pwUrl) {
    actions.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '📊 Playwright' },
      type: 'default',
      url: pwUrl,
    });
  }
  if (actions.length) elements.push({ tag: 'action', actions });

  const card = {
    header: {
      title: { tag: 'plain_text', content: ok ? '✅ 流程测试完成' : '❌ 流程测试失败' },
      template: ok ? 'green' : 'red',
    },
    elements,
  };

  const sent = await sendCard(chatId, card);
  console.log(sent ? '通知已发送' : '通知发送失败');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(0);
});
