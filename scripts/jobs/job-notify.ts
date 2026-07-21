import fs from 'fs';
import path from 'path';
import type { FeishuMode } from './test-jobs-config.js';

export type JobNotifySummary = {
  jobId?: string;
  jobDescription?: string;
  trigger?: string;
  testPassed: boolean;
  comparePassed: boolean;
  compareSkipped?: boolean;
  feishuDocAttempted: boolean;
  feishuDocPassed: boolean;
  aborted?: boolean;
  uiIssuesSummary?: string;
  errorSummary?: string;
};

function buildResultMarkdown(summary: JobNotifySummary): string {
  const lines = [
    '**测试结果**：',
    ...(summary.jobId ? [`**任务**：\`${summary.jobId}\`${summary.jobDescription ? ` — ${summary.jobDescription}` : ''}`] : []),
    ...(summary.trigger ? [`**触发**：${summary.trigger}`] : []),
    summary.aborted ? '⏹️ 执行：已中断（失败即停）' : `${summary.testPassed ? '✅' : '❌'} 执行：${summary.testPassed ? '成功' : '失败'}`,
    summary.compareSkipped
      ? '⏭️ 对比：已跳过'
      : `${summary.comparePassed ? '✅' : '❌'} 对比：${summary.comparePassed ? '成功' : '失败'}`,
  ];
  if (summary.feishuDocAttempted) {
    lines.push(
      `${summary.feishuDocPassed ? '✅' : '❌'} 飞书文档：${summary.feishuDocPassed ? '成功' : '失败'}`,
    );
  }
  if (summary.uiIssuesSummary) {
    lines.push(summary.uiIssuesSummary);
    lines.push('报告：`results/screenshot-comparison.html` · `results/ui-issues.json`');
  }
  if (summary.errorSummary) {
    lines.push(summary.errorSummary);
  }
  if (process.env.GITHUB_RUN_ID) {
    lines.push('**报告**：Actions 下载 Artifact `public-reports`，解压 `index.html` 用浏览器打开');
  }
  return lines.join('\n');
}

function cardHeader(summary: JobNotifySummary): { title: string; template: 'green' | 'red' } {
  const allOk =
    summary.testPassed &&
    (summary.compareSkipped || summary.comparePassed) &&
    (!summary.feishuDocAttempted || summary.feishuDocPassed);
  if (allOk && !summary.aborted) {
    return { title: '🎉 Playwright 测试任务完成', template: 'green' };
  }
  return { title: '⚠️ Playwright 测试任务未完成', template: 'red' };
}

export async function sendJobFeishuNotification(
  mode: FeishuMode,
  summary: JobNotifySummary,
): Promise<boolean> {
  if (mode === 'none') {
    console.log('ℹ️  feishu-mode=none，跳过飞书通知');
    return true;
  }

  let effectiveMode = mode;
  const githubEnabled = process.env.ENABLE_GITHUB === '1';
  if (mode === 'links' && !githubEnabled) {
    console.log('ℹ️  未启用 GitHub 链接（ENABLE_GITHUB!=1），降级为 interactive');
    effectiveMode = 'interactive';
  }

  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  const webhookSecret = process.env.FEISHU_WEBHOOK_SECRET;
  const sensitiveLogsEnabled = process.env.ENABLE_SENSITIVE_LOGS === '1';

  console.log('🔍 飞书通知配置检查：');
  console.log('  - Webhook URL:', webhookUrl ? '已配置' : '未配置');

  if (!webhookUrl) {
    console.log('⚠️  未配置飞书 Webhook URL，跳过通知');
    return true;
  }

  const resultMd = buildResultMarkdown(summary);
  const { title: cardTitle, template: cardTemplate } = cardHeader(summary);
  const timestamp = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  let body: object;

  if (effectiveMode === 'text') {
    body = {
      msg_type: 'text',
      content: { text: `${cardTitle}\n\n${resultMd}` },
    };
  } else {
    const elements: Array<Record<string, unknown>> = [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: resultMd },
      },
    ];

    if (effectiveMode === 'links' && githubEnabled) {
      const githubRepository = process.env.GITHUB_REPOSITORY || 'Ingrid-frontend/playwright-ai-project';
      const githubRunId = process.env.GITHUB_RUN_ID || '';
      const githubRunUrl = `https://github.com/${githubRepository}/actions/runs/${githubRunId}`;
      const [owner, repo] = githubRepository.split('/');
      const publicBase =
        process.env.PUBLIC_REPORT_URL?.replace(/\/$/, '') || `https://${owner}.github.io/${repo}`;
      elements.push({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '📊 在线报告' },
            type: 'primary',
            url: `${publicBase}/`,
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '📥 CI Artifacts' },
            type: 'default',
            url: githubRunUrl,
          },
        ],
      });
    }

    const docActions: Array<Record<string, unknown>> = [];
    const feishuDocUrlPath = 'results/feishu-doc-url.txt';
    if (fs.existsSync(feishuDocUrlPath)) {
      try {
        const feishuDocUrl = fs.readFileSync(feishuDocUrlPath, 'utf-8').trim();
        if (feishuDocUrl) {
          docActions.push({
            tag: 'button',
            text: { tag: 'plain_text', content: '📄 飞书文档' },
            type: 'primary',
            url: feishuDocUrl,
          });
        }
      } catch {
        console.log('⚠️  无法读取飞书文档链接');
      }
    }

    if (docActions.length) {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: '**飞书文档**：' } });
      elements.push({ tag: 'action', actions: docActions });
    }

    body = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: cardTitle },
          template: cardTemplate,
        },
        elements,
      },
    };
  }

  if (webhookSecret) {
    const crypto = await import('crypto');
    const bodyString = JSON.stringify(body);
    const signString = `${timestamp}\n${bodyString}`;
    if (sensitiveLogsEnabled) {
      console.log('  - 签名字符串:', signString);
    }
    headers['X-Lark-Request-Timestamp'] = String(timestamp);
    headers['X-Lark-Signature'] = crypto.createHmac('sha256', webhookSecret).update(signString).digest('base64');
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const responseText = await response.text();
    if (response.ok) {
      console.log('✅ 飞书通知发送成功');
      return true;
    }
    console.log('❌ 飞书通知发送失败:', response.status, responseText);
    return false;
  } catch (error) {
    console.log('❌ 飞书通知发送异常:', error);
    return false;
  }
}

export function readUiIssuesSummaryLine(): string | undefined {
  const counts = readUiIssuesSummaryCounts();
  if (!counts) return undefined;
  return `**UI 问题**：blocker ${counts.blocker} · warning ${counts.warning} · 共 ${counts.total} 项`;
}

export function readUiIssuesSummaryCounts():
  | { blocker: number; warning: number; total: number }
  | undefined {
  const p = path.join(process.cwd(), 'results/ui-issues.json');
  if (!fs.existsSync(p)) return undefined;
  try {
    const report = JSON.parse(fs.readFileSync(p, 'utf-8')) as {
      summary?: { blocker: number; warning: number; total: number };
    };
    if (!report.summary) return undefined;
    return {
      blocker: report.summary.blocker ?? 0,
      warning: report.summary.warning ?? 0,
      total: report.summary.total ?? 0,
    };
  } catch {
    return undefined;
  }
}

export function buildJobFailReasons(input: {
  testPassed: boolean;
  comparePassed: boolean;
  compareSkipped: boolean;
  aborted: boolean;
  failCount: number;
  executedCount?: number;
  compareGate?: boolean;
  feishuDocPassed?: boolean;
  feishuDocAttempted?: boolean;
  uiIssuesBlocker?: number;
}): string[] {
  const reasons: string[] = [];
  if (input.aborted) reasons.push('执行已中断');
  if (input.failCount > 0) {
    reasons.push(`${input.failCount} 个用例执行失败`);
  } else if (!input.testPassed && (input.executedCount ?? 0) === 0) {
    reasons.push('未匹配到可执行用例');
  } else if (!input.testPassed) {
    reasons.push('用例执行未通过');
  }

  if (!input.compareSkipped && !input.comparePassed) {
    if (input.compareGate) {
      const b = input.uiIssuesBlocker;
      reasons.push(
        b != null && b > 0 ? `截图对比 gate 未通过（blocker ${b}）` : '截图对比 gate 未通过',
      );
    } else {
      reasons.push('截图对比失败');
    }
  }

  if (input.feishuDocAttempted && input.feishuDocPassed === false) {
    reasons.push('飞书文档创建失败');
  }

  return reasons;
}
