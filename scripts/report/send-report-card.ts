import { sendFeishuNotify, type NotifyChannel } from '../feishu/feishu-app.js';
import {
  appendNotificationRecord,
  buildDedupKey,
  buildNotificationId,
  shouldSendNotification,
  type NotificationKind,
} from './notification-history.js';

export type SummaryCardInput = {
  env: string;
  kind: NotificationKind;
  period: string;
  title: string;
  template: 'green' | 'red' | 'orange' | 'blue';
  markdown: string;
  channel?: NotifyChannel;
  force?: boolean;
  note?: string;
};

/**
 * 发送日/周汇总交互卡并写入去重账本。同一 env+kind+period 默认只发一次，
 * --force 跳过去重检查；发送结果未知记 unknown，需人工对账后再决定重发。
 */
export async function sendSummaryCard(input: SummaryCardInput): Promise<{ sent: boolean; reason?: string }> {
  const { env, kind, period, channel = 'internal', force = false } = input;

  if (!force) {
    const gate = shouldSendNotification(env, kind, period);
    if (!gate.send) return { sent: false, reason: gate.reason };
  }

  const elements: unknown[] = [{ tag: 'div', text: { tag: 'lark_md', content: input.markdown } }];
  if (input.note) {
    elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: input.note }] });
  }

  const ok = await sendFeishuNotify(
    {
      msg_type: 'interactive',
      card: {
        header: { title: { tag: 'plain_text', content: input.title }, template: input.template },
        elements,
      },
    },
    channel,
  );

  const dedupKey = buildDedupKey(env, kind, period);
  appendNotificationRecord({
    id: buildNotificationId(dedupKey),
    dedupKey,
    env,
    kind,
    periodOrEventId: period,
    revision: 0,
    recipientTarget: channel,
    status: ok ? 'sent' : 'unknown',
    sentAt: ok ? new Date().toISOString() : undefined,
    attempt: 1,
    error: ok ? undefined : '发送失败，结果未知',
    payloadSummary: input.title,
  });

  return { sent: ok, reason: ok ? undefined : '飞书发送失败' };
}
