#!/usr/bin/env tsx
/** CI 失败时增强型飞书通知 */
import fs from 'fs';
import path from 'path';
import { sendJobFeishuNotification } from '../jobs/job-notify.js';
import { getAnalyzeErrorsSummary } from './flow-shared.js';

/** 从 tests/deprecated/errors/ 读取最近的失败详情 */
function readFailureDetails(maxLines = 5): string[] | undefined {
  const errorDir = path.join(process.cwd(), 'tests/deprecated/errors');
  if (!fs.existsSync(errorDir)) return undefined;
  const files = fs.readdirSync(errorDir)
    .filter((f) => f.startsWith('test-errors-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) return undefined;
  try {
    const content = JSON.parse(
      fs.readFileSync(path.join(errorDir, files[0]), 'utf-8'),
    ) as {
      errors?: { testFile?: string; testName?: string; error?: string; errorLine?: number }[];
    };
    return (content.errors || []).slice(0, maxLines).map((err) => {
      const file = err.testFile ? path.basename(err.testFile) : '未知文件';
      const name = err.testName || '未知用例';
      const msg = (err.error || '').split('\n')[0]?.slice(0, 80) || '';
      return `${file} / ${name} — ${msg}`;
    });
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const mode = (process.env.FEISHU_MODE ||
    (process.env.ENABLE_GITHUB === '1' ? 'links' : 'interactive')) as
    | 'interactive'
    | 'text'
    | 'links'
    | 'none';

  const errorSummary = getAnalyzeErrorsSummary();
  const failureDetails = readFailureDetails(5);

  await sendJobFeishuNotification(mode, {
    trigger: 'ci',
    testPassed: false,
    comparePassed: false,
    feishuDocAttempted: false,
    feishuDocPassed: true,
    errorSummary,
    failureDetails,
  });
}

main();
