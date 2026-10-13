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
  /** 缺省为旧回执：未完成的文档没有可证明安全的重放检查点。 */
  checkpointVersion?: 1;
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
    /** 批次汇总表（UI 验收汇总）写入结果；旧回执无此字段时汇总漏写由迁移工具 --rebuild-summary 兜底 */
    summaryTableId?: string;
    summaryRecordId?: string;
    /** doc-linked 阶段是否已回填汇总行报告链接 */
    summaryLinked?: boolean;
    documentId?: string;
    docUrl?: string;
    writtenBlockCount?: number;
    documentBlocksHash?: string;
    shareDegraded?: boolean;
    pendingDocumentWrite?: { operation: 'create' | 'append'; startIndex?: number; count?: number };
    linkedRecordIds?: string[];
    imageTokens?: Record<string, string>;
    notifiedChannels?: string[];
    pendingNotifyChannel?: string;
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
    checkpointVersion: 1,
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
    const receipt = JSON.parse(fs.readFileSync(p, 'utf-8')) as DeliveryReceipt;
    if (receipt.deliveryId !== deliveryId || !receipt.stages || !receipt.artifacts) {
      throw new Error('回执结构不完整');
    }
    return receipt;
  } catch {
    // 损坏的既有回执不能当作未交付，否则可能重复创建远端文档。
    throw new Error(`交付回执不可读，需人工核对后恢复：${path.resolve(p)}`);
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
  artifacts?: Partial<DeliveryReceipt['artifacts']>,
): void {
  // 阶段完成和恢复所需产物必须通过同一次 tmp + rename 落盘。
  if (artifacts) receipt.artifacts = { ...receipt.artifacts, ...artifacts };
  updateStage(receipt, stage, {
    status: 'done',
    completedAt: new Date().toISOString(),
    error: undefined,
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
