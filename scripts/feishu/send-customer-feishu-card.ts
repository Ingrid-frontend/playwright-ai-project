#!/usr/bin/env tsx
/**
 * 发送客户版 UI 验收摘要卡片（非工程师报告）。
 * 用法: npm run feishu:customer-card
 * 前置: npm run report:customer
 */
import path from 'path';
import dotenv from 'dotenv';
import { canSendFeishuNotify, sendFeishuNotify } from './index.js';
import {
  customerCardHeader,
  formatCustomerSummaryMarkdown,
  getCustomerReportUrl,
  readCustomerReportSummary,
} from '../report/customer-report-summary.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function main(): Promise<void> {
  const summary = readCustomerReportSummary();
  if (!summary) {
    console.error('缺少 customer-report-summary.json，请先执行 npm run report:customer');
    process.exit(1);
  }
  if (!canSendFeishuNotify()) {
    console.error('未配置飞书通知：请设置 FEISHU_CHAT_ID + FEISHU_APP_ID/SECRET，或 FEISHU_WEBHOOK_URL');
    process.exit(1);
  }

  const header = customerCardHeader(summary);
  const elements: Array<Record<string, unknown>> = [
    { tag: 'div', text: { tag: 'lark_md', content: formatCustomerSummaryMarkdown(summary) } },
  ];

  const reportUrl = getCustomerReportUrl();
  if (reportUrl && !reportUrl.startsWith('file://')) {
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '打开验收报告' },
          type: 'primary',
          url: reportUrl,
        },
      ],
    });
  }

  elements.push({
    tag: 'note',
    elements: [{ tag: 'plain_text', content: '客户版 UI 验收摘要 · 与验收基线逐像素比对' }],
  });

  const ok = await sendFeishuNotify({
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: header.title },
        template: header.template,
      },
      elements,
    },
  });

  if (!ok) process.exit(1);
  console.log('OK');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
