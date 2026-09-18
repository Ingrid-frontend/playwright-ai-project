import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type NotificationKind = 'weekly' | 'alert' | 'recovery' | 'delivery';
export type NotificationStatus = 'sent' | 'failed' | 'unknown' | 'skipped';

export type NotificationRecord = {
  id: string;
  dedupKey: string;
  env: string;
  kind: NotificationKind;
  periodOrEventId: string;
  revision: number;
  recipientTarget: string;
  status: NotificationStatus;
  skipReason?: string;
  sentAt?: string;
  attempt: number;
  error?: string;
  payloadSummary?: string;
};

const HISTORY_FILE = 'results/notification-history.jsonl';

export function buildNotificationId(dedupKey: string): string {
  return crypto.createHash('sha256').update(dedupKey).digest('hex').slice(0, 16);
}

export function buildDedupKey(env: string, kind: NotificationKind, periodOrEventId: string, revision = 0): string {
  return `${env}|${kind}|${periodOrEventId}|r${revision}`;
}

function ensureDir(): void {
  const dir = path.dirname(path.resolve(HISTORY_FILE));
  fs.mkdirSync(dir, { recursive: true });
}

export function appendNotificationRecord(record: NotificationRecord): void {
  ensureDir();
  const line = JSON.stringify(record) + '\n';
  fs.appendFileSync(path.resolve(HISTORY_FILE), line, 'utf-8');
}

export function readNotificationHistory(): NotificationRecord[] {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  const content = fs.readFileSync(HISTORY_FILE, 'utf-8').trim();
  if (!content) return [];
  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as NotificationRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is NotificationRecord => r !== null);
}

export function findLatestRecord(dedupKey: string): NotificationRecord | null {
  const records = readNotificationHistory();
  const matches = records.filter((r) => r.dedupKey === dedupKey);
  if (matches.length === 0) return null;
  return matches[matches.length - 1];
}

export function shouldSendNotification(env: string, kind: NotificationKind, periodOrEventId: string, revision = 0): { send: boolean; reason?: string } {
  const dedupKey = buildDedupKey(env, kind, periodOrEventId, revision);
  const latest = findLatestRecord(dedupKey);

  if (!latest) return { send: true };

  if (latest.status === 'sent') {
    return { send: false, reason: `已发送（${latest.sentAt || latest.id}），revision=${revision}` };
  }
  if (latest.status === 'skipped') {
    return { send: false, reason: `已跳过：${latest.skipReason || '未知原因'}` };
  }
  if (latest.status === 'unknown') {
    return { send: false, reason: `上次发送结果未知（${latest.id}），请先对账再决定是否重发` };
  }
  return { send: true };
}
