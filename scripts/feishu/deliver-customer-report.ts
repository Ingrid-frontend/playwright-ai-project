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
import { syncDeliveryFeedback } from './sync-delivery-feedback.js';
import {
  createReceipt,
  readReceipt,
  writeReceipt,
  startStage,
  completeStage,
  failStage,
  isStageDone,
  hashPayloadFile,
  type DeliveryReceipt,
} from './delivery-receipt.js';
import { runDeliveryGate, formatGateResult } from './delivery-gate.js';
import { checkReview } from './delivery-review.js';
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

function buildBitableRecordUrl(appToken: string, tableId: string, recordId: string): string {
  return `https://feishu.cn/base/${appToken}?table=${tableId}&record=${recordId}`;
}

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
    if (payload.envId && payload.envId !== opts.env) {
      console.error(
        `交付载荷环境不匹配：payload.envId=${payload.envId}，但 --env=${opts.env}。请用对应环境重新生成载荷。`,
      );
      process.exit(1);
    }

    const gate = runDeliveryGate(payload);
    if (!gate.passed) {
      console.error('交付门控未通过：');
      console.error(formatGateResult(gate));
      process.exit(1);
    }
    console.log('交付门控通过：');
    console.log(formatGateResult(gate));

    const skipReview = new Set(process.argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')[0])).has('skip-review');
    if (!skipReview && payload.deliveryId) {
      const reviewCheck = checkReview(payload.deliveryId);
      if (!reviewCheck.approved) {
        console.error(`审核未通过：${reviewCheck.reason}`);
        console.error('使用 --skip-review 跳过审核检查（不推荐，会记录告警）');
        process.exit(1);
      }
      console.log(`审核状态：${reviewCheck.reason}`);
    }
  }

  let receipt: DeliveryReceipt | null = null;
  if (opts.apply && payload.deliveryId) {
    const existing = readReceipt(payload.deliveryId);
    if (existing) {
      const currentHash = hashPayloadFile(opts.payloadPath);
      if (existing.payloadHash && currentHash && existing.payloadHash !== currentHash) {
        console.error(
          `交付载荷与回执不一致（deliveryId=${payload.deliveryId}）：同一交付身份的载荷不可变更。正式修订请提升 releaseTag 以生成新交付身份，避免复用旧文档或重复建文档。`,
        );
        process.exit(1);
      }
      receipt = existing;
    } else {
      receipt = createReceipt(payload.deliveryId, payload.envId || opts.env || '', opts.payloadPath);
    }
    if (!isStageDone(receipt, 'payload-loaded')) {
      startStage(receipt, 'payload-loaded');
      completeStage(receipt, 'payload-loaded');
    }
    const doneStages = (Object.keys(receipt.stages) as Array<keyof DeliveryReceipt['stages']>)
      .filter((s) => s !== 'failed' && receipt!.stages[s].status === 'done')
      .join(', ');
    if (doneStages) console.log(`  恢复回执：已完成阶段 [${doneStages}]`);
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
  let bitableInfo: unknown = null;
  let uploadSummary = { uploaded: 0, reused: 0, failed: 0 };
  const recordUrls = new Map<string, string>();
  let bitableClient: BitableClient | null = null;
  let bitableTableId = '';
  let bitableRecordIds: Array<{ recordId: string; key: string }> = [];

  // [1/3] 先写多维表明细，获取 recordId 用于文档证据链接
  if (opts.withBitable) {
    console.log('\n[1/3] 写入多维表明细...');
    const bitableConfig = loadBitableRuntimeConfig();
    if (!bitableConfig) {
      console.log(`  ⚠️  ${explainMissingBitableConfig()}`);
    } else {
      const client = new BitableClient(bitableConfig);
      bitableClient = client;

      if (receipt && isStageDone(receipt, 'bitable-written') && receipt.artifacts.tableId) {
        // 恢复：明细已写入，复用既有表与记录，不重传附件、不重写记录
        bitableTableId = receipt.artifacts.tableId;
        bitableRecordIds = receipt.artifacts.recordIds || [];
        for (const rec of bitableRecordIds) {
          recordUrls.set(rec.key, buildBitableRecordUrl(bitableConfig.appToken, bitableTableId, rec.recordId));
        }
        bitableInfo = { tableId: bitableTableId, resumed: true, records: bitableRecordIds.length };
        console.log(`  恢复回执：明细已写入（表 ${bitableTableId}，${bitableRecordIds.length} 条），跳过图片上传与明细写入`);
      } else {
        const { tableId, created, addedFields } = await ensureDeliveryTable(client, {
          tableId: bitableConfig.deliveryTableId || undefined,
        });
        console.log(
          `  明细表 ${created ? '已创建' : '已存在'}${addedFields.length ? `，补建字段 ${addedFields.length} 个` : ''}`,
        );
        bitableTableId = tableId;

        let imageTokens: Map<string, string>;
        if (receipt && isStageDone(receipt, 'images-uploaded') && receipt.artifacts.imageTokens) {
          // 恢复：图片已上传，复用回执里的附件 token，不重传
          imageTokens = new Map(Object.entries(receipt.artifacts.imageTokens));
          console.log(`  恢复回执：证据图已上传（复用 ${imageTokens.size} 个附件 token），跳过上传`);
        } else {
          console.log('  上传证据图（作为多维表附件）...');
          const upload = await uploadImagesWithRetry(token, existingImages, { concurrency: opts.concurrency });
          console.log(`  新传 ${upload.uploaded} 张 · 复用缓存 ${upload.reused} 张 · 失败 ${upload.failed.length} 张`);
          for (const f of upload.failed) console.log(`  ⚠️  ${path.basename(f.absPath)}: ${f.error}`);
          if (upload.failed.length > 0) {
            console.error('图片上传失败，阻断交付（请检查网络或飞书凭证后重试）');
            if (receipt) failStage(receipt, 'images-uploaded', `${upload.failed.length} 张图片上传失败`);
            process.exit(1);
          }
          uploadSummary = { uploaded: upload.uploaded, reused: upload.reused, failed: upload.failed.length };
          imageTokens = upload.tokens;
          if (receipt) {
            completeStage(receipt, 'images-uploaded', { uploaded: upload.uploaded, reused: upload.reused });
            const tokenMap: Record<string, string> = {};
            for (const [k, v] of upload.tokens) tokenMap[k] = v;
            receipt.artifacts.imageTokens = tokenMap;
            writeReceipt(receipt);
          }
        }

        // 注意：此时 docUrl 尚未生成，多维表的 doc_url 字段将为空，文档创建后回填
        const written = await writeDeliveryRecords(
          client,
          tableId,
          payload,
          { tokens: imageTokens },
          { dedupe: opts.dedupe, resolvePath: resolveDeliveryImagePath },
        );
        console.log(`  新增 ${written.created} 条 · 更新 ${written.updated} 条`);
        bitableRecordIds = written.records.map((r) => ({ recordId: r.recordId, key: r.key }));
        // 构建 recordUrls Map 供文档引用
        for (const rec of written.records) {
          recordUrls.set(rec.key, buildBitableRecordUrl(bitableConfig.appToken, tableId, rec.recordId));
        }
        bitableInfo = { tableId, ...written };

        // 同步问题到反馈表（UI采集反馈），只更新检测事实，不覆盖人工字段
        if (bitableConfig.feedbackTableId) {
          const feedbackResult = await syncDeliveryFeedback(client, bitableConfig.feedbackTableId, payload);
          console.log(`  反馈表同步：新增 ${feedbackResult.created} 条 · 更新 ${feedbackResult.updated} 条`);
        }
        if (receipt) {
          completeStage(receipt, 'bitable-written', { tableId, created: written.created, updated: written.updated });
          receipt.artifacts.tableId = tableId;
          receipt.artifacts.recordIds = written.records.map((r) => ({ recordId: r.recordId, key: r.key }));
          writeReceipt(receipt);
        }
      }
    }
  } else {
    console.log('\n[1/3] 跳过多维表（--no-bitable）');
  }

  // [2/3] 创建飞书文档，传入 recordUrls 用于证据链接
  if (opts.withDoc) {
    if (receipt && isStageDone(receipt, 'doc-created') && receipt.artifacts.documentId) {
      // 恢复：复用已建文档，不重复创建
      docUrl = receipt.artifacts.docUrl;
      console.log(`\n[2/3] 恢复回执：文档已创建，跳过建文档：${docUrl || receipt.artifacts.documentId}`);
    } else {
      console.log('\n[2/3] 创建飞书文档...');
      const documentId = await createDocxDocument(token, title);
      console.log(`  document_id: ${documentId}`);
      const blocks = buildCustomerDocBlocks(payload, recordUrls);
      const writtenBlocks = await addBlocksBatched(token, documentId, blocks);
      const share = await shareDocxDocument(token, documentId);
      docUrl = share.url;
      shareDegraded = share.shareDegraded;
      console.log(`  文档已生成（${writtenBlocks} 个内容块）：${docUrl}`);
      if (shareDegraded) {
        console.warn('  ⚠️  分享链接未自动公开，请在飞书内手动「分享」后再发给客户。');
      }
      if (receipt) {
        completeStage(receipt, 'doc-created', { documentId, blocks: writtenBlocks, url: docUrl });
        receipt.artifacts.documentId = documentId;
        receipt.artifacts.docUrl = docUrl;
        writeReceipt(receipt);
      }
    }

    // 回填多维表记录的 doc_url（写多维表时 docUrl 尚未生成）；已回填则跳过
    const alreadyLinked = receipt ? isStageDone(receipt, 'doc-linked') : false;
    if (alreadyLinked) {
      console.log('  恢复回执：报告链接已回填，跳过');
    } else if (bitableClient && bitableTableId && bitableRecordIds.length > 0 && docUrl) {
      const DELIVERY_DOC_URL_FIELD = 'doc_url';
      for (const rec of bitableRecordIds) {
        await bitableClient.updateRecord(bitableTableId, rec.recordId, {
          [DELIVERY_DOC_URL_FIELD]: { link: docUrl, text: '验收报告' },
        });
      }
      console.log(`  已回填 ${bitableRecordIds.length} 条多维表记录的报告链接`);
      if (receipt) completeStage(receipt, 'doc-linked', { backfilledRecords: bitableRecordIds.length });
    }
  } else {
    console.log('\n[2/3] 跳过文档（--no-doc）');
  }

  if (opts.notify) {
    if (receipt && isStageDone(receipt, 'notified')) {
      console.log('[3/3] 恢复回执：通知已发送，跳过重复通知');
    } else {
      console.log('[3/3] 发送飞书通知...');
      const lines = [payload.headline, `发版建议：${payload.shipAdviceLabel}`, `检测覆盖 ${payload.stats.coveragePct}%`];
      if (docUrl) lines.push(`验收报告：${docUrl}`);
      await sendFeishuNotify({ msg_type: 'text', content: { text: lines.join('\n') } });
      if (receipt) completeStage(receipt, 'notified');
    }
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
