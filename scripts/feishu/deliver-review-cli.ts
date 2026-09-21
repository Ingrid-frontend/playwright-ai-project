#!/usr/bin/env tsx
/**
 * 审核交付批次
 *
 * 用法：
 *   npm run deliver:review -- --env=stage9084 --approve --reviewer=张三
 *   npm run deliver:review -- --env=stage9084 --reject --reviewer=张三 --notes="图片缺失"
 */
import fs from 'fs';
import { resolveDeliveryPayloadPath } from '../../src/utils/env-profile.js';
import { readCustomerDeliveryPayload } from '../report/customer-delivery-payload.js';
import { approveDelivery, rejectDelivery, readReview } from './delivery-review.js';

function main(): void {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const value = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };

  if (flags.has('--status')) {
    const review = readReview();
    if (!review) {
      console.log('无审核记录');
      return;
    }
    console.log(JSON.stringify(review, null, 2));
    return;
  }

  const env = value('env');
  const reviewer = value('reviewer');
  const notes = value('notes');

  if (!env) {
    console.error('请指定 --env=<id>');
    process.exit(1);
  }
  if (!reviewer) {
    console.error('请指定 --reviewer=<name>');
    process.exit(1);
  }

  const payloadPath = resolveDeliveryPayloadPath(env);
  if (!fs.existsSync(payloadPath)) {
    console.error(`未找到载荷 ${payloadPath}，请先执行 npm run report:customer -- --env=${env}`);
    process.exit(1);
  }

  const payload = readCustomerDeliveryPayload(payloadPath);
  if (!payload) {
    console.error('载荷解析失败');
    process.exit(1);
  }

  const deliveryId = payload.deliveryId;
  if (!deliveryId) {
    console.error('载荷缺少 deliveryId');
    process.exit(1);
  }

  if (flags.has('--approve')) {
    const review = approveDelivery(deliveryId, payload.envId || env, reviewer, notes, payload.contentHash);
    console.log(`✅ 已审核通过：deliveryId=${deliveryId}, reviewer=${reviewer}, at=${review.reviewedAt}`);
    if (payload.contentHash) console.log(`   内容哈希：${payload.contentHash}`);
  } else if (flags.has('--reject')) {
    const review = rejectDelivery(deliveryId, payload.envId || env, reviewer, notes, payload.contentHash);
    console.log(`❌ 已审核拒绝：deliveryId=${deliveryId}, reviewer=${reviewer}, at=${review.reviewedAt}`);
    if (notes) console.log(`   原因：${notes}`);
    if (payload.contentHash) console.log(`   内容哈希：${payload.contentHash}`);
  } else {
    console.error('请指定 --approve 或 --reject');
    process.exit(1);
  }
}

main();
