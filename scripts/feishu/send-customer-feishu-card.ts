#!/usr/bin/env tsx
/**
 * 客户版飞书通知（分场景）：
 * - 周报：每周最多 1 次（--weekly 或 auto 在新周首次触发）
 * - 提醒：出现需关注问题时推送（--alert 或 auto 检测到新问题）
 * - 仅「检测覆盖不足」且无问题时：不推送
 *
 * 用法:
 *   npm run feishu:customer-notify          # auto
 *   npm run feishu:customer-weekly          # 强制周报（本周未发过才发）
 *   npm run feishu:customer-alert           # 有问题才发提醒
 *   npm run feishu:customer-card -- --force # 调试：跳过去重
 */
import path from 'path';
import dotenv from 'dotenv';
import { readCustomerReportSummary } from '../report/customer-report-summary.js';
import { sendCustomerFeishuNotify } from '../report/customer-feishu-notify.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

function parseMode(): 'auto' | 'weekly' | 'alert' {
  const args = process.argv.slice(2);
  if (args.includes('--weekly')) return 'weekly';
  if (args.includes('--alert')) return 'alert';
  return 'auto';
}

function parseEnv(): string | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--env='));
  return arg ? arg.slice('--env='.length) : undefined;
}

async function main(): Promise<void> {
  const summary = readCustomerReportSummary();
  if (!summary) {
    console.error('缺少 customer-report-summary.json，请先执行 npm run report:customer');
    process.exit(1);
  }

  const force = process.argv.includes('--force');
  const mode = parseMode();
  const env = parseEnv();
  const result = await sendCustomerFeishuNotify(summary, { mode, force, env });

  if (result.sent) {
    console.log(`OK · ${result.kind}`);
    return;
  }

  console.log(`跳过 · ${result.kind}${result.reason ? ` · ${result.reason}` : ''}`);
  if (mode !== 'auto' && !force) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
