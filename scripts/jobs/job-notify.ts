import fs from 'fs';
import path from 'path';
import type { FeishuMode } from './test-jobs-config.js';
import { canSendFeishuNotify, sendFeishuNotify } from '../feishu/index.js';
import {
  buildCardPayload,
  buildResultMarkdown,
  cardHeader,
  type JobNotifySummary,
} from './job-notify-card.js';
import { writeDeliveryRecord } from './notification-delivery.js';

export type { JobNotifySummary } from './job-notify-card.js';

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

  console.log('🔍 飞书通知配置检查：');
  console.log('  - 自建应用发信:', process.env.FEISHU_CHAT_ID?.trim() && process.env.FEISHU_APP_ID?.trim() ? '已配置' : '未配置');
  console.log('  - Webhook URL:', process.env.FEISHU_WEBHOOK_URL?.trim() ? '已配置' : '未配置');

  if (!canSendFeishuNotify()) {
    console.log('⚠️  未配置 FEISHU_CHAT_ID+应用凭证，也未配置 FEISHU_WEBHOOK_URL，跳过通知');
    return true;
  }

  const cardHeaderResult = cardHeader(summary);

  const feishuAppId = process.env.FEISHU_APP_ID?.trim();
  if (feishuAppId && !process.env.SKIP_FEISHU_DOC) {
    try {
      const { execSync } = await import('child_process');
      const repoRoot = process.cwd();
      const script = path.join(repoRoot, 'scripts', 'feishu', 'update-feishu-report.ts');
      if (fs.existsSync(script)) {
        execSync(`npx tsx "${script}"`, { cwd: repoRoot, stdio: 'pipe', timeout: 30000 });
      }
    } catch (e: any) {
      console.log('⚠️  飞书文档更新失败（不影响通知）:', e.message?.slice(0, 100));
    }
  }

  let body: Parameters<typeof sendFeishuNotify>[0];

  if (effectiveMode === 'text') {
    const resultMd = buildResultMarkdown(summary);
    body = {
      msg_type: 'text',
      content: { text: `${cardHeaderResult.title}\n\n${resultMd}` },
    };
  } else {
    const cardPayload = await buildCardPayload(summary, effectiveMode);
    body = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: cardPayload.header.title },
          template: cardPayload.header.template,
        },
        elements: cardPayload.elements,
      },
    };
  }

  const MAX_NOTIFY_ATTEMPTS = 2;
  const jobId = summary.jobId || 'studio';
  const counts = readUiIssuesSummaryCounts();
  const issueCount = counts
    ? { blocker: counts.blocker, warning: counts.warning }
    : undefined;
  for (let attempt = 1; attempt <= MAX_NOTIFY_ATTEMPTS; attempt++) {
    try {
      const ok = await sendFeishuNotify(body);
      writeDeliveryRecord({
        jobId,
        channel: 'feishu',
        attempt,
        status: ok ? 'success' : 'failed',
        issueCount,
        sentAt: new Date().toISOString(),
        error: ok ? undefined : 'sendFeishuNotify returned false',
      });
      if (ok) return true;
      if (attempt < MAX_NOTIFY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return false;
    } catch (error) {
      console.log(`❌ 飞书通知发送异常 (attempt ${attempt}/${MAX_NOTIFY_ATTEMPTS}):`, error);
      writeDeliveryRecord({
        jobId,
        channel: 'feishu',
        attempt,
        status: 'failed',
        issueCount,
        sentAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      if (attempt < MAX_NOTIFY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return false;
    }
  }
  return false;
}

export function readUiIssuesSummaryLine(): string | undefined {
  const counts = readUiIssuesSummaryCounts();
  if (!counts) return undefined;
  const base = `**界面差异**：严重 ${counts.blocker} 项 · 轻微 ${counts.warning} 项 · 共 ${counts.total} 项`;
  if (!counts.review || counts.review.reviewed <= 0) return base;
  return `${base}\n**UI 判定**：疑似问题 ${counts.review.uiBug} · 需人工 ${counts.review.needsHuman} · 不稳定 ${counts.review.unstable} · 噪声 ${counts.review.likelyNoise}`;
}

export function readUiIssuesSummaryCounts():
  | {
      blocker: number;
      warning: number;
      total: number;
      review?: { uiBug: number; needsHuman: number; unstable: number; likelyNoise: number; reviewed: number };
    }
  | undefined {
  const p = path.join(process.cwd(), 'results/ui-issues.json');
  if (!fs.existsSync(p)) return undefined;
  try {
    const report = JSON.parse(fs.readFileSync(p, 'utf-8')) as {
      summary?: {
        blocker: number;
        warning: number;
        total: number;
        review?: { uiBug: number; needsHuman: number; unstable: number; likelyNoise: number; reviewed: number };
      };
    };
    if (!report.summary) return undefined;
    return {
      blocker: report.summary.blocker ?? 0,
      warning: report.summary.warning ?? 0,
      total: report.summary.total ?? 0,
      review: report.summary.review,
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
