import fs from 'fs';
import path from 'path';

export type DeliveryReview = {
  deliveryId: string;
  envId: string;
  reviewer?: string;
  reviewedAt?: string;
  approved: boolean;
  notes?: string;
};

const REVIEW_FILE = 'results/delivery-review.json';

export function readReview(): DeliveryReview | null {
  if (!fs.existsSync(REVIEW_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(REVIEW_FILE, 'utf-8')) as DeliveryReview;
  } catch {
    return null;
  }
}

export function writeReview(review: DeliveryReview): void {
  const dir = path.dirname(path.resolve(REVIEW_FILE));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.resolve(REVIEW_FILE), JSON.stringify(review, null, 2), 'utf-8');
}

export function approveDelivery(deliveryId: string, envId: string, reviewer: string, notes?: string): DeliveryReview {
  const review: DeliveryReview = {
    deliveryId,
    envId,
    reviewer,
    reviewedAt: new Date().toISOString(),
    approved: true,
    notes,
  };
  writeReview(review);
  return review;
}

export function rejectDelivery(deliveryId: string, envId: string, reviewer: string, notes?: string): DeliveryReview {
  const review: DeliveryReview = {
    deliveryId,
    envId,
    reviewer,
    reviewedAt: new Date().toISOString(),
    approved: false,
    notes,
  };
  writeReview(review);
  return review;
}

export function checkReview(deliveryId: string): { approved: boolean; reason: string } {
  const review = readReview();
  if (!review) return { approved: false, reason: '未找到审核记录，请先执行 npm run deliver:review -- --approve' };
  if (review.deliveryId !== deliveryId) {
    return { approved: false, reason: `审核记录对应 ${review.deliveryId}，与当前 ${deliveryId} 不匹配` };
  }
  if (!review.approved) return { approved: false, reason: `审核未通过（${review.reviewer || '未知'}: ${review.notes || '无备注'}）` };
  return { approved: true, reason: `${review.reviewer || '未知'} 于 ${review.reviewedAt} 审核通过` };
}
