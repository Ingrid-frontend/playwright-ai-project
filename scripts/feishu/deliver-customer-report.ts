import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import {
  assertDeliveryContentHash,
  readCustomerDeliveryPayload,
  resolveDeliveryImagePath,
  type DeliveryPayload,
} from '../report/customer-delivery-payload.js';
import { resolveDeliveryPayloadPath } from '../../src/utils/env-profile.js';
import { renderDeliveryPreview } from '../report/customer-delivery-preview.js';
import {
  loadFeishuAppConfig,
  getFeishuAccessToken,
  sendFeishuNotify,
  resolveFeishuChatId,
  type NotifyChannel,
  type FeishuNotifyPayload,
} from './feishu-app.js';
import { buildDeliveryCard } from './delivery-card.js';
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
  updateStage,
  isStageDone,
  hashPayloadFile,
  type DeliveryReceipt,
  type DeliveryStage,
} from './delivery-receipt.js';
import { runDeliveryGate, formatGateResult } from './delivery-gate.js';
import { checkReview, readReview } from './delivery-review.js';
import {
  buildCustomerDocBlocks,
  buildCustomerDocTitle,
  createDocxDocument,
  addBlocksBatched,
  shareDocxDocument,
  type DocBlock,
} from './doc-delivery.js';

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

function requireReconciliation(receipt: DeliveryReceipt, stage: DeliveryStage, reason: string): never {
  const error = `${reason}；交付 ${receipt.deliveryId} 的 ${stage} 状态未知，禁止自动重放。请人工核对远端与回执中的未决操作、文档 ID/正文数量或通知渠道后恢复。`;
  updateStage(receipt, stage, { status: 'unknown', error });
  throw new Error(error);
}

type DocumentServices = {
  createDocument: typeof createDocxDocument;
  appendBlocks: typeof addBlocksBatched;
  shareDocument: typeof shareDocxDocument;
};

/** doc-created 仍表示正文及分享均已完成；未决 POST 只能人工核对，不能自动重放。 */
export async function deliverDocument(
  token: string,
  title: string,
  blocks: DocBlock[],
  receipt: DeliveryReceipt,
  services: Partial<DocumentServices> = {},
): Promise<{ documentId: string; url: string; shareDegraded: boolean }> {
  const { createDocument = createDocxDocument, appendBlocks = addBlocksBatched,
    shareDocument = shareDocxDocument } = services;
  if (receipt.artifacts.pendingDocumentWrite || receipt.stages['doc-created'].status === 'unknown') {
    requireReconciliation(receipt, 'doc-created', '上次文档写入未取得可恢复的确认');
  }
  if (isStageDone(receipt, 'doc-created')) {
    // 兼容旧版先写 done/detail、后写 artifacts 的回执，绝不再次 append。
    const detail = receipt.stages['doc-created'].detail;
    const documentId = receipt.artifacts.documentId ||
      (typeof detail?.documentId === 'string' ? detail.documentId : undefined);
    if (!documentId) requireReconciliation(receipt, 'doc-created', '已完成回执缺少 documentId');
    const url = receipt.artifacts.docUrl ||
      (typeof detail?.url === 'string' ? detail.url : `https://feishu.cn/docx/${documentId}`);
    // 旧回执没有记录分享结果，不能默认为已成功授权。
    return { documentId, url, shareDegraded: receipt.artifacts.shareDegraded ?? true };
  }
  if (receipt.checkpointVersion !== 1) {
    requireReconciliation(receipt, 'doc-created', '旧版未完成回执没有写入检查点');
  }
  const blocksHash = createHash('sha256').update(JSON.stringify(blocks)).digest('hex');
  if (receipt.artifacts.documentId &&
      (receipt.artifacts.documentBlocksHash !== blocksHash ||
       !Number.isSafeInteger(receipt.artifacts.writtenBlockCount) ||
       receipt.artifacts.writtenBlockCount! < 0 || receipt.artifacts.writtenBlockCount! > blocks.length)) {
    requireReconciliation(receipt, 'doc-created', '正文内容或已写数量与检查点不一致');
  }

  startStage(receipt, 'doc-created');
  try {
    let documentId = receipt.artifacts.documentId;
    if (!documentId) {
      receipt.artifacts.documentBlocksHash = blocksHash;
      receipt.artifacts.pendingDocumentWrite = { operation: 'create' };
      writeReceipt(receipt);
      documentId = await createDocument(token, title);
      // ID 必须先落盘，才能开始任何正文写入或分享。
      receipt.artifacts.documentId = documentId;
      receipt.artifacts.writtenBlockCount = 0;
      delete receipt.artifacts.pendingDocumentWrite;
      writeReceipt(receipt);
    }
    const writtenBlocks = await appendBlocks(token, documentId, blocks, 20, {
      startIndex: receipt.artifacts.writtenBlockCount,
      onBeforeBatch: (startIndex, count) => {
        receipt.artifacts.pendingDocumentWrite = { operation: 'append', startIndex, count };
        writeReceipt(receipt);
      },
      onBatchWritten: (writtenBlockCount) => {
        receipt.artifacts.writtenBlockCount = writtenBlockCount;
        delete receipt.artifacts.pendingDocumentWrite;
        writeReceipt(receipt);
      },
    });
    // 正文已全部确认时仅恢复分享，不重新写正文。权限设置沿用原函数。
    const share = await shareDocument(token, documentId);
    completeStage(receipt, 'doc-created', { documentId, blocks: writtenBlocks, url: share.url }, {
      documentId, writtenBlockCount: writtenBlocks, docUrl: share.url, shareDegraded: share.shareDegraded,
    });
    return { documentId, ...share };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (receipt.artifacts.pendingDocumentWrite) requireReconciliation(receipt, 'doc-created', message);
    failStage(receipt, 'doc-created', message);
    throw err;
  }
}

/** 回填是对同一字段赋同一值；未确认的一条可安全重试，已确认记录逐条跳过。 */
export async function linkDocumentRecords(
  client: Pick<BitableClient, 'updateRecord'>,
  tableId: string,
  records: Array<{ recordId: string; key: string }>,
  docUrl: string,
  receipt: DeliveryReceipt,
): Promise<void> {
  if (isStageDone(receipt, 'doc-linked')) return;
  const linked = new Set(receipt.artifacts.linkedRecordIds ?? []);
  startStage(receipt, 'doc-linked');
  try {
    for (const rec of records) {
      if (linked.has(rec.recordId)) continue;
      await client.updateRecord(tableId, rec.recordId, {
        doc_url: { link: docUrl, text: '验收报告' },
      });
      linked.add(rec.recordId);
      receipt.artifacts.linkedRecordIds = [...linked];
      writeReceipt(receipt);
    }
    completeStage(receipt, 'doc-linked', { backfilledRecords: records.length }, { linkedRecordIds: [...linked] });
  } catch (err) {
    failStage(receipt, 'doc-linked', err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** 已确认渠道不重复发送；非幂等发送不自动重试，未知结果保留检查点待核对。 */
export async function notifyDeliveryChannels(
  receipt: DeliveryReceipt,
  notifications: Array<{ channel: NotifyChannel; card: FeishuNotifyPayload }>,
  send: typeof sendFeishuNotify = sendFeishuNotify,
): Promise<void> {
  if (isStageDone(receipt, 'notified')) return;
  if (receipt.artifacts.pendingNotifyChannel || receipt.stages.notified.status === 'unknown') {
    requireReconciliation(receipt, 'notified', '上次渠道通知未确认');
  }
  const notified = new Set(receipt.artifacts.notifiedChannels ?? []);
  if (receipt.checkpointVersion !== 1 && notifications.some(({ channel }) => !notified.has(channel))) {
    requireReconciliation(receipt, 'notified', '旧版未完成通知可能已发送但未保存渠道');
  }
  startStage(receipt, 'notified');
  for (const { channel, card } of notifications) {
    if (notified.has(channel)) continue;
    receipt.artifacts.pendingNotifyChannel = channel;
    writeReceipt(receipt);
    let ok: boolean;
    try {
      ok = await send(card, channel);
    } catch (err) {
      requireReconciliation(receipt, 'notified', err instanceof Error ? err.message : String(err));
    }
    delete receipt.artifacts.pendingNotifyChannel;
    if (ok) notified.add(channel);
    receipt.artifacts.notifiedChannels = [...notified];
    // 每个渠道返回后立即落盘，不让后续渠道失败抹掉先前的成功。
    writeReceipt(receipt);
  }
  if (notifications.every(({ channel }) => notified.has(channel))) {
    completeStage(receipt, 'notified', undefined, { notifiedChannels: [...notified] });
  } else {
    failStage(receipt, 'notified', '部分渠道返回发送失败');
    throw new Error('部分渠道返回发送失败，交付通知未完成');
  }
}

export async function main() {
  dotenv.config({ path: path.join(process.cwd(), '.env') });
  const opts = parseArgs(process.argv.slice(2));
  const payload = readCustomerDeliveryPayload(opts.payloadPath);
  if (!payload) {
    console.error(`未找到交付载荷 ${opts.payloadPath}，请先执行 npm run report:customer`);
    process.exit(1);
  }
  if (!payload.generatedAt) {
    console.error('交付载荷缺少 generatedAt，无法确认快照生成信息');
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
    if (payload.envId !== opts.env) {
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
      const reviewCheck = checkReview(payload.deliveryId, payload.contentHash);
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

  if (!receipt) {
    throw new Error('正式交付缺少 deliveryId，无法保存恢复检查点；请重新生成带交付身份的载荷。');
  }
  if (!app) {
    console.error('未配置 FEISHU_APP_ID / FEISHU_APP_SECRET，无法写入飞书。');
    process.exit(1);
  }
  // 本地预览/回执处理后，进入任何线上操作前再次读取真实证据字节。
  assertDeliveryContentHash(payload);
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
            const tokenMap: Record<string, string> = {};
            for (const [k, v] of upload.tokens) tokenMap[k] = v;
            completeStage(receipt, 'images-uploaded', { uploaded: upload.uploaded, reused: upload.reused }, {
              imageTokens: tokenMap,
            });
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
          completeStage(receipt, 'bitable-written', { tableId, created: written.created, updated: written.updated }, {
            tableId,
            recordIds: bitableRecordIds,
          });
        }
      }
    }
  } else {
    console.log('\n[1/3] 跳过多维表（--no-bitable）');
  }

  // [2/3] 创建飞书文档，传入 recordUrls 用于证据链接
  if (opts.withDoc) {
    console.log('\n[2/3] 创建或恢复飞书文档...');
    const document = await deliverDocument(token, title, buildCustomerDocBlocks(payload, recordUrls), receipt);
    docUrl = document.url;
    shareDegraded = document.shareDegraded;
    console.log(`  document_id: ${document.documentId} · ${docUrl}`);
    if (shareDegraded) {
      console.warn('  分享链接未确认可用，请在飞书内核对「分享」后再发给客户。');
    }

    // 回填多维表记录的 doc_url；独立于文档完成状态恢复。
    if (isStageDone(receipt, 'doc-linked')) {
      console.log('  恢复回执：报告链接已回填，跳过');
    } else if (bitableClient && bitableTableId && bitableRecordIds.length > 0 && docUrl) {
      await linkDocumentRecords(bitableClient, bitableTableId, bitableRecordIds, docUrl, receipt);
      console.log(`  已回填 ${bitableRecordIds.length} 条多维表记录的报告链接`);
    }
  } else {
    console.log('\n[2/3] 跳过文档（--no-doc）');
  }

  if (opts.notify) {
    if (receipt && isStageDone(receipt, 'notified')) {
      console.log('[3/3] 恢复回执：通知已发送，跳过重复通知');
    } else {
      console.log('[3/3] 发送飞书通知（客户群 + 内部留档）...');
      const bitableCfg = loadBitableRuntimeConfig();
      const bitableUrl =
        bitableTableId && bitableCfg
          ? bitableCfg.dashboardUrl || `https://feishu.cn/base/${bitableCfg.appToken}?table=${bitableTableId}`
          : undefined;
      const review = readReview();
      const reviewer = review && review.deliveryId === payload.deliveryId ? review.reviewer : undefined;

      const notifications: Array<{ channel: NotifyChannel; card: FeishuNotifyPayload }> = [];
      // 客户群未配置时不阻塞完成，不回退到内部群或 Webhook。
      if (resolveFeishuChatId('customer')) {
        notifications.push({ channel: 'customer', card: buildDeliveryCard(payload, { docUrl }) });
      }
      notifications.push({
        channel: 'internal',
        card: buildDeliveryCard(payload, { docUrl, bitableUrl, internal: true, reviewer }),
      });
      await notifyDeliveryChannels(receipt, notifications);
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
