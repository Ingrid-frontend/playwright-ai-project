import fs from 'fs';
import path from 'path';
import { canSendFeishuNotify, sendFeishuNotify } from '../feishu/index.js';
import {
  getCustomerReportUrl,
  type CustomerReportSummary,
} from './customer-report-summary.js';
import {
  appendNotificationRecord,
  buildDedupKey,
  buildNotificationId,
  findLatestRecord,
  type NotificationKind,
  type NotificationRecord,
} from './notification-history.js';

export type CustomerNotifyKind = 'weekly' | 'alert' | 'skip';

export type CustomerNotifyState = {
  lastWeeklyWeek?: string;
  lastAlertFingerprint?: string;
  lastAlertAt?: string;
};

const STATE_FILE = 'results/customer-feishu-state.json';

export function needsAttention(summary: CustomerReportSummary): boolean {
  return summary.regressSteps > 0 || summary.minorSteps > 0;
}

export function isBaselineOnly(summary: CustomerReportSummary): boolean {
  return !needsAttention(summary) && summary.shipAdvice === 'baseline';
}

export function alertFingerprint(summary: CustomerReportSummary): string {
  const issues = summary.issues.map((i) => `${i.priority}:${i.title}:${i.maxDifferenceLabel}`).join('|');
  return `r${summary.regressSteps}:m${summary.minorSteps}:${issues}`;
}

export function currentIsoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function readNotifyState(filePath = STATE_FILE): CustomerNotifyState {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return {};
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8')) as CustomerNotifyState;
  } catch {
    return {};
  }
}

export function writeNotifyState(state: CustomerNotifyState, filePath = STATE_FILE): void {
  const abs = path.resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(state, null, 2), 'utf-8');
}

export function shouldSendWeekly(state: CustomerNotifyState, now = new Date(), env?: string): boolean {
  const week = currentIsoWeek(now);
  if (state.lastWeeklyWeek === week) return false;
  if (env) {
    const dedupKey = buildDedupKey(env, 'weekly', week);
    const latest = findLatestRecord(dedupKey);
    if (latest?.status === 'sent') return false;
  }
  return true;
}

export function shouldSendAlert(
  summary: CustomerReportSummary,
  state: CustomerNotifyState,
  env?: string,
): boolean {
  if (!needsAttention(summary)) return false;
  const fp = alertFingerprint(summary);
  if (state.lastAlertFingerprint === fp) return false;
  if (env) {
    const dedupKey = buildDedupKey(env, 'alert', fp);
    const latest = findLatestRecord(dedupKey);
    if (latest?.status === 'sent') return false;
  }
  return true;
}

export function resolveCustomerNotifyKind(
  summary: CustomerReportSummary,
  opts: { mode?: 'auto' | 'weekly' | 'alert'; force?: boolean; env?: string } = {},
): CustomerNotifyKind {
  const mode = opts.mode || 'auto';
  const state = readNotifyState();

  if (mode === 'weekly') {
    return opts.force || shouldSendWeekly(state, new Date(), opts.env) ? 'weekly' : 'skip';
  }
  if (mode === 'alert') {
    if (!needsAttention(summary)) return 'skip';
    return opts.force || shouldSendAlert(summary, state, opts.env) ? 'alert' : 'skip';
  }

  if (needsAttention(summary) && (opts.force || shouldSendAlert(summary, state, opts.env))) {
    return 'alert';
  }
  if (opts.force || shouldSendWeekly(state, new Date(), opts.env)) {
    return 'weekly';
  }
  if (isBaselineOnly(summary)) return 'skip';
  return 'skip';
}

export function weeklyCardHeader(summary: CustomerReportSummary): {
  title: string;
  template: 'green' | 'red' | 'orange' | 'blue';
} {
  const week = currentIsoWeek();
  if (summary.regressSteps > 0) {
    return {
      title: `📊 UI 验收周报（${week}）· ${summary.regressGroupCount} 个问题待处理`,
      template: 'orange',
    };
  }
  if (summary.minorSteps > 0) {
    return {
      title: `📊 UI 验收周报（${week}）· ${summary.minorSteps} 处轻微变化`,
      template: 'orange',
    };
  }
  return { title: `📊 UI 验收周报（${week}）· 本周状态正常`, template: 'green' };
}

export function alertCardHeader(summary: CustomerReportSummary): {
  title: string;
  template: 'green' | 'red' | 'orange' | 'blue';
} {
  if (summary.regressSteps > 0) {
    return {
      title: `🔴 UI 验收提醒 · ${summary.regressGroupCount} 个问题需修复`,
      template: 'red',
    };
  }
  return {
    title: `🟡 UI 验收提醒 · ${summary.minorSteps} 处变化需确认`,
    template: 'orange',
  };
}

export function formatWeeklyMarkdown(
  summary: CustomerReportSummary,
  digest?: {
    runCount: number;
    successCount: number;
    failedCount: number;
  },
): string {
  const ctx = [summary.envLabel, summary.releaseTag ? `v${summary.releaseTag}` : '']
    .filter(Boolean)
    .join(' · ');
  const lines: string[] = [
    `**本周 UI 验收概况**`,
    ...(ctx ? [`环境：${ctx}`] : []),
    `检测覆盖：${summary.coveragePct}%（已对比 ${summary.comparedSteps}/${summary.expectedSteps} 步）`,
    `需要修复 ${summary.regressSteps} 步 · 无需处理 ${summary.minorSteps} 步 · 通过率 ${(summary.passRate * 100).toFixed(1)}%`,
  ];
  if (digest) {
    lines.push(
      `本周运行 ${digest.runCount} 次（成功 ${digest.successCount}，失败 ${digest.failedCount}）`,
    );
  }
  if (summary.uncoveredSteps > 0) {
    lines.push(`待建基线 ${summary.uncoveredSteps} 步（未参与判定，周报统计用）`);
  }
  if (summary.issues.length > 0) {
    lines.push('', '**本周需关注问题**：');
    for (const [i, issue] of summary.issues.slice(0, 5).entries()) {
      lines.push(`${i + 1}. [${issue.priority}] ${issue.title} — ${issue.reason}`);
    }
  } else {
    lines.push('', '本周未发现需要修复的 UI 问题。');
  }
  const reportUrl = getCustomerReportUrl();
  if (reportUrl && !reportUrl.startsWith('file://')) {
    lines.push('', `[查看完整验收报告](${reportUrl})`);
  }
  return lines.join('\n');
}

export function formatAlertMarkdown(summary: CustomerReportSummary): string {
  const ctx = [summary.envLabel, summary.releaseTag ? `v${summary.releaseTag}` : '']
    .filter(Boolean)
    .join(' · ');
  const lines: string[] = [
    `**${summary.headline}**`,
    ...(ctx ? [`环境：${ctx}`] : []),
  ];
  if (summary.issues.length > 0) {
    lines.push('', '**问题清单**：');
    for (const [i, issue] of summary.issues.slice(0, 8).entries()) {
      const nature = issue.natureLabel ? ` · ${issue.natureLabel}` : '';
      lines.push(
        `${i + 1}. [${issue.priority}] **${issue.title}**（${issue.maxDifferenceLabel}，影响 ${issue.affectedSteps} 步${nature}）`,
      );
      lines.push(`   ${issue.reason}`);
    }
  } else if (summary.minorSteps > 0) {
    lines.push('', `共 ${summary.minorSteps} 处轻微变化，建议人工确认是否接受（多为位移或渲染差异）。`);
  }
  const fixItems = summary.actionItems.filter((a) => !/可按计划发版/.test(a));
  if (fixItems.length > 0) {
    lines.push('', '**建议操作**：');
    for (const [i, item] of fixItems.entries()) {
      lines.push(`${i + 1}. ${item}`);
    }
  }
  const reportUrl = getCustomerReportUrl();
  if (reportUrl && !reportUrl.startsWith('file://')) {
    lines.push('', `[查看对比证据](${reportUrl})`);
  }
  return lines.join('\n');
}

function buildCardElements(kind: CustomerNotifyKind, summary: CustomerReportSummary) {
  const header = kind === 'weekly' ? weeklyCardHeader(summary) : alertCardHeader(summary);
  const body = kind === 'weekly' ? formatWeeklyMarkdown(summary) : formatAlertMarkdown(summary);
  const elements: Array<Record<string, unknown>> = [
    { tag: 'div', text: { tag: 'lark_md', content: body } },
  ];
  const reportUrl = getCustomerReportUrl();
  if (reportUrl && !reportUrl.startsWith('file://')) {
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: kind === 'weekly' ? '打开周报报告' : '查看问题证据' },
          type: 'primary',
          url: reportUrl,
        },
      ],
    });
  }
  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content:
          kind === 'weekly'
            ? 'UI 验收周报 · 每周汇总一次'
            : 'UI 验收提醒 · 出现需关注问题时推送',
      },
    ],
  });
  return { header, elements };
}

export function skipNotifyReason(summary: CustomerReportSummary, state = readNotifyState()): string {
  if (needsAttention(summary) && !shouldSendAlert(summary, state)) {
    return '问题提醒已发过，指纹未变化';
  }
  if (!shouldSendWeekly(state)) {
    if (isBaselineOnly(summary)) return '本周周报已发送，当前无新问题';
    return '本周周报已发送';
  }
  if (isBaselineOnly(summary)) return '仅检测覆盖不足，不推送即时通知';
  return '无需要推送的内容';
}
export function markNotifySent(
  kind: CustomerNotifyKind,
  summary: CustomerReportSummary,
  env?: string,
): void {
  const state = readNotifyState();
  if (kind === 'weekly') {
    state.lastWeeklyWeek = currentIsoWeek();
  }
  if (kind === 'alert') {
    state.lastAlertFingerprint = alertFingerprint(summary);
    state.lastAlertAt = new Date().toISOString();
  }
  writeNotifyState(state);

  if (env) {
    const periodOrEventId = kind === 'weekly' ? currentIsoWeek() : alertFingerprint(summary);
    const dedupKey = buildDedupKey(env, kind as NotificationKind, periodOrEventId);
    const record: NotificationRecord = {
      id: buildNotificationId(dedupKey),
      dedupKey,
      env,
      kind: kind as NotificationKind,
      periodOrEventId,
      revision: 0,
      recipientTarget: '',
      status: 'sent',
      sentAt: new Date().toISOString(),
      attempt: 1,
      payloadSummary: kind === 'weekly' ? weeklyCardHeader(summary).title : alertCardHeader(summary).title,
    };
    appendNotificationRecord(record);
  }
}

export type SendCustomerNotifyResult = {
  kind: CustomerNotifyKind;
  sent: boolean;
  reason?: string;
};

export async function sendCustomerFeishuNotify(
  summary: CustomerReportSummary,
  opts: { mode?: 'auto' | 'weekly' | 'alert'; force?: boolean; env?: string } = {},
): Promise<SendCustomerNotifyResult> {
  const kind = resolveCustomerNotifyKind(summary, opts);
  if (kind === 'skip') {
    return { kind, sent: false, reason: skipNotifyReason(summary) };
  }
  if (!canSendFeishuNotify()) {
    return { kind, sent: false, reason: '未配置飞书通知' };
  }

  const { header, elements } = buildCardElements(kind, summary);
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

  if (ok) {
    markNotifySent(kind, summary, opts.env);
  } else if (opts.env) {
    const periodOrEventId = kind === 'weekly' ? currentIsoWeek() : alertFingerprint(summary);
    const dedupKey = buildDedupKey(opts.env, kind as NotificationKind, periodOrEventId);
    const record: NotificationRecord = {
      id: buildNotificationId(dedupKey),
      dedupKey,
      env: opts.env,
      kind: kind as NotificationKind,
      periodOrEventId,
      revision: 0,
      recipientTarget: '',
      status: 'unknown',
      attempt: 1,
      error: '飞书发送失败，结果未知',
      payloadSummary: header.title,
    };
    appendNotificationRecord(record);
  }

  return { kind, sent: ok, reason: ok ? undefined : '飞书发送失败' };
}
