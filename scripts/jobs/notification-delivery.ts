import fs from 'fs';
import path from 'path';

export const DELIVERY_DIR = path.join('results', 'notification-deliveries');

export type DeliveryStatus = 'success' | 'failed';

export type DeliveryRecord = {
  jobId: string;
  channel: string;
  attempt: number;
  status: DeliveryStatus;
  issueCount?: { blocker: number; warning: number; info?: number };
  sentAt: string;
  error?: string;
  /** 重投时指向原记录文件名 */
  resentFrom?: string;
};

function ensureDir(): void {
  if (!fs.existsSync(DELIVERY_DIR)) fs.mkdirSync(DELIVERY_DIR, { recursive: true });
}

export function writeDeliveryRecord(record: DeliveryRecord): string | null {
  try {
    ensureDir();
    const safeId = String(record.jobId || 'job').replace(/[^\w.-]+/g, '_').slice(0, 64);
    const ts = record.sentAt.replace(/[:.]/g, '-');
    const file = path.join(DELIVERY_DIR, `${safeId}-${ts}.json`);
    fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf-8');
    return file;
  } catch {
    return null;
  }
}

export function listDeliveryRecords(opts?: { status?: DeliveryStatus; limit?: number }): DeliveryRecord[] {
  if (!fs.existsSync(DELIVERY_DIR)) return [];
  const files = fs
    .readdirSync(DELIVERY_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const full = path.join(DELIVERY_DIR, f);
      try {
        const st = fs.statSync(full);
        return { full, mtime: st.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x): x is { full: string; mtime: number } => Boolean(x))
    .sort((a, b) => b.mtime - a.mtime);

  const out: DeliveryRecord[] = [];
  for (const { full } of files) {
    try {
      const rec = JSON.parse(fs.readFileSync(full, 'utf-8')) as DeliveryRecord;
      if (opts?.status && rec.status !== opts.status) continue;
      out.push({ ...rec, resentFrom: rec.resentFrom || path.basename(full) });
      if (opts?.limit && out.length >= opts.limit) break;
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function readDeliveryFile(filePath: string): DeliveryRecord | null {
  const full = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf-8')) as DeliveryRecord;
  } catch {
    return null;
  }
}

export function findLatestFailedDelivery(jobId?: string): { file: string; record: DeliveryRecord } | null {
  if (!fs.existsSync(DELIVERY_DIR)) return null;
  const files = fs
    .readdirSync(DELIVERY_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(DELIVERY_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  for (const file of files) {
    try {
      const record = JSON.parse(fs.readFileSync(file, 'utf-8')) as DeliveryRecord;
      if (record.status !== 'failed') continue;
      if (jobId && record.jobId !== jobId) continue;
      return { file, record };
    } catch {
      /* ignore */
    }
  }
  return null;
}
