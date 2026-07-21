#!/usr/bin/env tsx
/** CI 失败时轻量飞书通知（不误导为「优化成功」） */
import { sendJobFeishuNotification } from '../jobs/job-notify.js';
import { getAnalyzeErrorsSummary } from './flow-shared.js';

async function main(): Promise<void> {
  const mode = (process.env.FEISHU_MODE || 'interactive') as 'interactive' | 'text' | 'links' | 'none';
  await sendJobFeishuNotification(mode, {
    trigger: 'ci',
    testPassed: false,
    comparePassed: false,
    feishuDocAttempted: false,
    feishuDocPassed: true,
    errorSummary: getAnalyzeErrorsSummary(),
  });
}

main();
