import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type DeliveryStage =
  | 'payload-loaded'
  | 'images-uploaded'
  | 'bitable-written'
  | 'doc-created'
  | 'doc-linked'
  | 'notified'
  | 'failed';

export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'unknown';

export type StageRecord = {
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  attempt: number;
  error?: string;
  detail?: Record<string, unknown>;
};

export type DeliveryReceipt = {
  deliveryId: string;
  envId: string;
  payloadPath: string;
  payloadHash: string;
  createdAt: string;
  updatedAt: string;
  stages: Record<DeliveryStage, StageRecord>;
  artifacts: {
    tableId?: string;
    recordIds?: Array<{ recordId: string; key: string }>;
    documentId?: string;
    docUrl?: string;
    imageTokens?: Record<string, string>;
    notifiedChannels?: string[];
  };
};

const HISTORY_DIR = 'results/delivery-history';

function safeId(deliveryId: string): string {
  return deliveryId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function receiptPath(deliveryId: string): string {
  return path.join(HISTORY_DIR, `${safeId(deliveryId)}.json`);
}

export function hashPayloadFile(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return '';
  }
}

function emptyStage(): StageRecord {
  return { status: 'pending', attempt: 0 };
}

export function createReceipt(deliveryId: string, envId: string, payloadPath: string): DeliveryReceipt {
  const now = new Date().toISOString();
  return {
    deliveryId,
    envId,
    payloadPath,
    payloadHash: hashPayloadFile(payloadPath),
    createdAt: now,
    updatedAt: now,
    stages: {
      'payload-loaded': emptyStage(),
      'images-uploaded': emptyStage(),
      'bitable-written': emptyStage(),
      'doc-created': emptyStage(),
      'doc-linked': emptyStage(),
      notified: emptyStage(),
      failed: emptyStage(),
    },
    artifacts: {},
  };
}

export function readReceipt(deliveryId: string): DeliveryReceipt | null {
  const p = receiptPath(deliveryId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as DeliveryReceipt;
  } catch {
    return null;
  }
}

export function writeReceipt(receipt: DeliveryReceipt): void {
  const dir = path.resolve(HISTORY_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.resolve(receiptPath(receipt.deliveryId));
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  receipt.updatedAt = new Date().toISOString();
  fs.writeFileSync(tmp, JSON.stringify(receipt, null, 2), 'utf-8');
  fs.renameSync(tmp, target);
}

export function updateStage(
  receipt: DeliveryReceipt,
  stage: DeliveryStage,
  patch: Partial<StageRecord>,
): void {
  const current = receipt.stages[stage];
  receipt.stages[stage] = { ...current, ...patch };
  writeReceipt(receipt);
}

export function startStage(receipt: DeliveryReceipt, stage: DeliveryStage): void {
  const current = receipt.stages[stage];
  updateStage(receipt, stage, {
    status: 'running',
    startedAt: new Date().toISOString(),
    attempt: current.attempt + 1,
  });
}

export function completeStage(
  receipt: DeliveryReceipt,
  stage: DeliveryStage,
  detail?: Record<string, unknown>,
): void {
  updateStage(receipt, stage, {
    status: 'done',
    completedAt: new Date().toISOString(),
    detail: detail ? { ...(receipt.stages[stage].detail || {}), ...detail } : receipt.stages[stage].detail,
  });
}

export function failStage(receipt: DeliveryReceipt, stage: DeliveryStage, error: string): void {
  updateStage(receipt, stage, {
    status: 'failed',
    completedAt: new Date().toISOString(),
    error,
  });
  updateStage(receipt, 'failed', {
    status: 'done',
    completedAt: new Date().toISOString(),
    detail: { failedStage: stage, error },
  });
}

export function isStageDone(receipt: DeliveryReceipt | null, stage: DeliveryStage): boolean {
  return receipt?.stages[stage]?.status === 'done';
}
