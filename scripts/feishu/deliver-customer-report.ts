import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  readCustomerDeliveryPayload,
  resolveDeliveryImagePath,
  type DeliveryPayload,
} from '../report/customer-delivery-payload.js';
import { resolveDeliveryPayloadPath } from '../../src/utils/env-profile.js';
import { renderDeliveryPreview } from '../report/customer-delivery-preview.js';
import { loadFeishuAppConfig, getFeishuAccessToken, sendFeishuNotify } from './feishu-app.js';
import { uploadImages, type UploadBatchResult, type UploaderOptions } from './feishu-media.js';
import { BitableClient } from './bitable-client.js';
import { loadBitableRuntimeConfig, explainMissingBitableConfig } from './bitable-schema.js';
import { ensureDeliveryTable, hashItemKey, writeDeliveryRecords } from './bitable-delivery.js';
import {
  buildCustomerDocBlocks,
  buildCustomerDocTitle,
  createDocxDocument,
  addBlocksBatched,
  shareDocxDocument,
} from './doc-delivery.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

export const DELIVERY_RESULT_FILE = 'results/feishu-delivery-result.json';
export const DELIVERY_PREVIEW_FILE = 'results/feishu-delivery-preview.html';
const PLAN_FILE = 'results/feishu-delivery-plan.json';

export type CliOptions = {
  apply: boolean;
  payloadPath: string;
  /** --env 指定的环境，用于选择对应环境的交付载荷 */
  env?: string;
  withBitable: boolean;
  withDoc: boolean;
  notify: boolean;
  dedupe: boolean;
  concurrency: number;
};

export function parseArgs(argv: string[]): CliOptions {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const value = (name: string, fallback: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  // --env=uat 等价于 --payload=results/customer-delivery-uat.json，
  // 与 report:customer --env=uat 产出的文件对应，避免把别的环境的报告发错
  const env = argv.find((a) => a.startsWith('--env='))?.slice('--env='.length).trim().toLowerCase();
  return {
    apply: flags.has('--apply'),
    payloadPath: value('payload', env ? resolveDeliveryPayloadPath(env) : 'results/customer-delivery.json'),
    env,
    withBitable: !flags.has('--no-bitable'),
    withDoc: !flags.has('--no-doc'),
    notify: flags.has('--notify'),
    dedupe: flags.has('--dedupe'),
    concurrency: Number(value('concurrency', '4')) || 4,
  };
}

export function collectImagePaths(payload: DeliveryPayload): string[] {
  const out = new Set<string>();
  for (const item of payload.items) {
    for (const img of item.images) out.add(resolveDeliveryImagePath(img.relPath));
  }
  return [...out];
}

export async function uploadImagesWithRetry(
  token: string,
  absPaths: string[],
  opts: UploaderOptions = {},
  maxAttempts = 3,
): Promise<UploadBatchResult> {
  let result = await uploadImages(token, absPaths, opts);
  for (let attempt = 2; attempt <= maxAttempts && result.failed.length > 0; attempt += 1) {
    const delayMs = 1000 * 2 ** (attempt - 2);
    console.log(`  图片上传重试 ${attempt}/${maxAttempts}（${result.failed.length} 张，${delayMs}ms 后）...`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const retryPaths = result.failed.map((f) => f.absPath);
    const retry = await uploadImages(token, retryPaths, opts);
    result = {
      tokens: new Map([...result.tokens, ...retry.tokens]),
      uploaded: result.uploaded + retry.uploaded,
      reused: result.reused + retry.reused,
      failed: retry.failed,
    };
  }
  return result;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const payload = readCustomerDeliveryPayload(opts.payloadPath);
  if (!payload) {
    console.error(`未找到交付载荷 ${opts.payloadPath}，请先执行 npm run report:customer`);
    process.exit(1);
  }
  if (!payload.generatedAt) {
    console.error('交付载荷缺少 generatedAt，无法校验新鲜度');
    process.exit(1);
  }
  if (opts.apply) {
    if (!opts.env) {
      console.error('正式交付必须指定 --env=<id>，例如: npm run deliver:feishu -- --env=stage9084');
      process.exit(1);
    }
    if (payload.deliveryReady !== true) {
      console.error(
        '交付载荷 deliveryReady 不为 true，禁止写入飞书。请用 npm run deliver:ready -- --env=<id> 按环境重新生成。',
      );
      process.exit(1);
    }
  }

  const imagePaths = collectImagePaths(payload);
  const existingImages = imagePaths.filter((p) => fs.existsSync(p));
  console.log(`交付载荷：${opts.payloadPath}`);
  console.log(
    `  runId=${payload.runId || '(未绑定)'} · generatedAt=${payload.generatedAt} · 条目 ${payload.items.length} 个 · 图片 ${existingImages.length}/${imagePaths.length} 张可读`,
  );

  const title = buildCustomerDocTitle(payload);
  const previewHtml = renderDeliveryPreview(payload, title);
  fs.mkdirSync(path.dirname(path.resolve(DELIVERY_PREVIEW_FILE)), { recursive: true });
  fs.writeFileSync(path.resolve(DELIVERY_PREVIEW_FILE), previewHtml, 'utf-8');
  console.log(`  本地预览：${DELIVERY_PREVIEW_FILE}`);

  const app = loadFeishuAppConfig();
  if (!opts.apply) {
    fs.writeFileSync(
      path.resolve(PLAN_FILE),
      JSON.stringify(
        {
          mode: 'dry-run',
          title,
          table: 'UI 验收明细',
          images: existingImages.length,
          items: payload.items.map((i) => ({
            key: hashItemKey(opts.dedupe ? i.dedupeKey : i.key),
            flow: i.scriptLabel,
            verdict: i.verdictLabel,
            title: i.title,
            difference: i.differenceLabel,
            images: i.images.map((img) => img.label),
          })),
        },
        null,
        2,
      ),
      'utf-8',
    );
    console.log(`  执行计划：${PLAN_FILE}`);
    console.log(
      app
        ? '\n当前为预览模式，加 --apply 真正写入飞书。'
        : '\n未检测到飞书凭证，仅生成预览；配置后加 --apply 写入。',
    );
    return;
  }

  if (!app) {
    console.error('未配置 FEISHU_APP_ID / FEISHU_APP_SECRET，无法写入飞书。');
    process.exit(1);
  }
  const token = await getFeishuAccessToken(app);

  let docUrl: string | undefined;
  let shareDegraded = false;
  if (opts.withDoc) {
    console.log('\n[1/3] 创建飞书文档...');
    const documentId = await createDocxDocument(token, title);
    console.log(`  document_id: ${documentId}`);
    const blocks = buildCustomerDocBlocks(payload);
    const written = await addBlocksBatched(token, documentId, blocks);
    const share = await shareDocxDocument(token, documentId);
    docUrl = share.url;
    shareDegraded = share.shareDegraded;
    console.log(`  文档已生成（${written} 个内容块）：${docUrl}`);
    if (shareDegraded) {
      console.warn('  ⚠️  分享链接未自动公开，请在飞书内手动「分享」后再发给客户。');
    }
  } else {
    console.log('\n[1/3] 跳过文档（--no-doc）');
  }

  let bitableInfo: unknown = null;
  let uploadSummary = { uploaded: 0, reused: 0, failed: 0 };
  if (opts.withBitable) {
    console.log('[2/3] 写入多维表明细...');
    const bitableConfig = loadBitableRuntimeConfig();
    if (!bitableConfig) {
      console.log(`  ⚠️  ${explainMissingBitableConfig()}`);
    } else {
      const client = new BitableClient(bitableConfig);
      const { tableId, created, addedFields } = await ensureDeliveryTable(client, {
        tableId: bitableConfig.deliveryTableId || undefined,
      });
      console.log(
        `  明细表 ${created ? '已创建' : '已存在'}${addedFields.length ? `，补建字段 ${addedFields.length} 个` : ''}`,
      );
      console.log('  上传证据图（作为多维表附件）...');
      const upload = await uploadImagesWithRetry(token, existingImages, { concurrency: opts.concurrency });
      console.log(`  新传 ${upload.uploaded} 张 · 复用缓存 ${upload.reused} 张 · 失败 ${upload.failed.length} 张`);
      for (const f of upload.failed) console.log(`  ⚠️  ${path.basename(f.absPath)}: ${f.error}`);
      if (upload.failed.length > 0) {
        console.error('图片上传失败，阻断交付（请检查网络或飞书凭证后重试）');
        process.exit(1);
      }
      uploadSummary = { uploaded: upload.uploaded, reused: upload.reused, failed: upload.failed.length };
      const written = await writeDeliveryRecords(
        client,
        tableId,
        payload,
        { tokens: upload.tokens, docUrl },
        { dedupe: opts.dedupe, resolvePath: resolveDeliveryImagePath },
      );
      console.log(`  新增 ${written.created} 条 · 更新 ${written.updated} 条`);
      bitableInfo = { tableId, ...written };
    }
  } else {
    console.log('[2/3] 跳过多维表（--no-bitable）');
  }

  if (opts.notify) {
    console.log('[3/3] 发送飞书通知...');
    const lines = [payload.headline, `发版建议：${payload.shipAdviceLabel}`, `检测覆盖 ${payload.stats.coveragePct}%`];
    if (docUrl) lines.push(`验收报告：${docUrl}`);
    await sendFeishuNotify({ msg_type: 'text', content: { text: lines.join('\n') } });
  } else {
    console.log('[3/3] 跳过通知（加 --notify 开启）');
  }

  fs.writeFileSync(
    path.resolve(DELIVERY_RESULT_FILE),
    JSON.stringify(
      {
        runId: payload.runId || '',
        envId: payload.envId || opts.env || '',
        generatedAt: payload.generatedAt,
        deliveredAt: new Date().toISOString(),
        title,
        docUrl,
        shareDegraded,
        bitable: bitableInfo,
        upload: uploadSummary,
      },
      null,
      2,
    ),
    'utf-8',
  );
  console.log(`\n交付结果：${DELIVERY_RESULT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
