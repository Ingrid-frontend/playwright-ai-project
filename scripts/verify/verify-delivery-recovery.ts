import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DocBlock } from '../feishu/doc-delivery.js';
import type { DeliveryReceipt } from '../feishu/delivery-receipt.js';
import type { FeishuNotifyPayload, NotifyChannel } from '../feishu/feishu-app.js';

/** 独立离线样例：全部网络 mock，回执只写入临时目录，不读取真实 results。 */
export async function verifyDeliveryRecovery(): Promise<void> {
  const cwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-recovery-'));
  const originalFetch = globalThis.fetch;
  const originalRename = fs.renameSync;
  const originalEnv = { ...process.env };
  let networkCalls = 0;
  let handler: (url: string, init?: RequestInit) => Promise<Response> = async (url) => {
    throw new Error(`禁止非 mock 网络请求：${url}`);
  };
  globalThis.fetch = async (input, init) => {
    networkCalls += 1;
    return handler(String(input), init);
  };
  try {
    process.chdir(tempDir);
    const { createReceipt, readReceipt, writeReceipt, completeStage, receiptPath } =
      await import('../feishu/delivery-receipt.js');
    const { deliverDocument, linkDocumentRecords, notifyDeliveryChannels, parseArgs, assertDeliveryNotificationOptions } =
      await import('../feishu/deliver-customer-report.js');
    const { addBlocksBatched, createDocxDocument, shareDocxDocument } =
      await import('../feishu/doc-delivery.js');
    assert.equal(networkCalls, 0, '导入不得启动 main 或网络请求');
    assert.deepEqual(fs.readdirSync(tempDir), [], '导入不得生成预览、计划或回执');
    const cli = parseArgs(['--apply', '--env=uat', '--no-doc', '--no-bitable', '--notify']);
    assert.equal(cli.apply, true);
    assert.equal(cli.withDoc, false);
    assert.equal(cli.withBitable, false);
    assert.equal(cli.notify, true);
    process.env.FEISHU_CHAT_ID_CUSTOMER = 'mock-customer';
    assert.throws(() => assertDeliveryNotificationOptions(cli), /禁止.*--no-doc/);
    assert.doesNotThrow(() => assertDeliveryNotificationOptions({ ...cli, apply: false }));
    assert.doesNotThrow(() => assertDeliveryNotificationOptions({ ...cli, notify: false }));
    assert.doesNotThrow(() => assertDeliveryNotificationOptions({ ...cli, withDoc: true }));
    process.env.FEISHU_CHAT_ID_CUSTOMER = ' ';
    process.env.FEISHU_CHAT_ID_INTERNAL = 'mock-internal';
    assert.doesNotThrow(() => assertDeliveryNotificationOptions(cli), '内部-only 允许 --no-doc');
    assert.equal(networkCalls, 0, '选项门禁不得触发网络请求');
    assert.deepEqual(fs.readdirSync(tempDir), [], '选项门禁不得写入回执');

    const fresh = (id: string) => createReceipt(id, 'offline', path.join(tempDir, 'unused-payload.json'));
    const reload = (receipt: DeliveryReceipt): DeliveryReceipt => {
      const saved = readReceipt(receipt.deliveryId);
      assert.ok(saved);
      return saved;
    };
    const blocks: DocBlock[] = Array.from({ length: 21 }, (_, i) => ({
      block_type: 2, text: { elements: [{ text_run: { content: `offline-${i}` } }] },
    }));
    const docUrl = 'https://example.invalid/doc';
    const share = async () => ({ url: docUrl, shareDegraded: true });
    const confirmedShare = { url: docUrl, shareDegraded: false };
    const confirmDocument = (receipt: DeliveryReceipt) => completeStage(receipt, 'doc-created', undefined, {
      documentId: `doc-${receipt.deliveryId}`, docUrl, shareDegraded: false,
    });
    const noBodyWrites = {
      createDocument: async (): Promise<string> => { throw new Error('恢复禁止重新 create'); },
      appendBlocks: async (): Promise<number> => { throw new Error('恢复禁止重新 append'); },
    };
    const json = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));

    // 每次 completeStage 只发布一个同时含 done 和产物的文件。
    const snapshots: DeliveryReceipt[] = [];
    fs.renameSync = (oldPath, newPath) => {
      snapshots.push(JSON.parse(fs.readFileSync(oldPath, 'utf-8')) as DeliveryReceipt);
      originalRename(oldPath, newPath);
    };
    const atomic = fresh('atomic');
    completeStage(atomic, 'images-uploaded', { uploaded: 1 }, { imageTokens: { image: 'token' } });
    completeStage(atomic, 'bitable-written', { created: 1 }, {
      tableId: 'table', recordIds: [{ recordId: 'record', key: 'key' }],
    });
    fs.renameSync = originalRename;
    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[0].stages['images-uploaded'].status, 'done');
    assert.deepEqual(snapshots[0].artifacts.imageTokens, { image: 'token' });
    assert.equal(snapshots[1].stages['bitable-written'].status, 'done');
    assert.equal(snapshots[1].artifacts.recordIds?.[0].recordId, 'record');
    assert.deepEqual(snapshots[1].artifacts.imageTokens, { image: 'token' });

    function documentServer(receipt: DeliveryReceipt, lostCreate = false, lostBatch = -1) {
      const remote = { creates: 0, batches: [] as string[][] };
      handler = async (url, init) => {
        assert.equal(init?.method, 'POST');
        const saved = reload(receipt);
        if (url.endsWith('/docx/v1/documents')) {
          assert.equal(saved.artifacts.pendingDocumentWrite?.operation, 'create');
          remote.creates += 1;
          if (lostCreate) throw new Error('远端建文档成功，但响应丢失');
          return json({ document: { document_id: `doc-${receipt.deliveryId}` } });
        }
        assert.ok(url.endsWith('/descendant'), `非预期网络请求：${url}`);
        const body = JSON.parse(String(init?.body)) as { children_id: string[] };
        assert.equal(saved.artifacts.documentId, `doc-${receipt.deliveryId}`);
        assert.equal(saved.artifacts.pendingDocumentWrite?.operation, 'append');
        assert.equal(saved.artifacts.writtenBlockCount, remote.batches.flat().length);
        assert.equal(saved.artifacts.pendingDocumentWrite?.startIndex, remote.batches.flat().length);
        assert.equal(saved.artifacts.pendingDocumentWrite?.count, body.children_id.length);
        remote.batches.push(body.children_id);
        if (remote.batches.length === lostBatch) throw new Error('远端 append 成功，但响应丢失');
        return json({});
      };
      return remote;
    }

    // ID 返回即落盘；第一批开始前中断，重启只复用文档。
    const created = fresh('after-create');
    const createdRemote = documentServer(created);
    await assert.rejects(deliverDocument('mock', 'title', blocks, created, {
      appendBlocks: async () => {
        const saved = reload(created);
        assert.equal(saved.artifacts.documentId, 'doc-after-create');
        assert.equal(saved.artifacts.writtenBlockCount, 0);
        assert.equal(saved.artifacts.pendingDocumentWrite, undefined);
        throw new Error('第一批发出前中断');
      },
      shareDocument: share,
    }), /第一批发出前中断/);
    const completed = await deliverDocument('mock', 'title', blocks, reload(created), { shareDocument: share });
    assert.equal(createdRemote.creates, 1);
    assert.equal(createdRemote.batches.flat().length, blocks.length);
    assert.equal(completed.shareDegraded, true);
    assert.equal(reload(created).artifacts.shareDegraded, true);
    assert.equal(reload(created).stages['doc-created'].status, 'done');

    // done 但分享降级仍可恢复；分享中断不丢正文 done，重启只确认分享。
    await assert.rejects(deliverDocument('mock', 'title', blocks, reload(created), {
      ...noBodyWrites,
      shareDocument: async () => { throw new Error('重新确认分享中断'); },
    }), /重新确认分享中断/);
    assert.equal(reload(created).stages['doc-created'].status, 'done');
    assert.equal(reload(created).artifacts.shareDegraded, true);
    let shareConfirmations = 0;
    const confirmed = await deliverDocument('mock', 'title', blocks, reload(created), {
      ...noBodyWrites,
      shareDocument: async (_token, documentId) => {
        shareConfirmations += 1;
        assert.equal(documentId, completed.documentId);
        return confirmedShare;
      },
    });
    assert.equal(shareConfirmations, 1);
    assert.equal(confirmed.shareDegraded, false);
    assert.equal(reload(created).artifacts.shareDegraded, false);
    assert.equal(reload(created).artifacts.docUrl, confirmed.url);
    assert.equal(reload(created).artifacts.documentId, completed.documentId);
    assert.equal(reload(created).artifacts.writtenBlockCount, blocks.length);
    assert.equal(reload(created).stages['doc-created'].detail?.blocks, blocks.length);
    assert.equal(createdRemote.creates, 1);
    assert.equal(createdRemote.batches.flat().length, blocks.length);
    const callsBeforeDoneResume: number = networkCalls;
    assert.deepEqual(await deliverDocument('mock', 'title', blocks, reload(created)), confirmed);
    assert.equal(networkCalls, callsBeforeDoneResume, '已确认分享的 done 恢复零网络');

    // 第一批确认落盘后中断；下一次仅提交未写前缀之后的块。
    const partial = fresh('after-batch');
    const partialRemote = documentServer(partial);
    await assert.rejects(deliverDocument('mock', 'title', blocks, partial, {
      appendBlocks: (token, id, content, size, progress) => addBlocksBatched(token, id, content, size, {
        ...progress,
        onBatchWritten: async (count) => {
          await progress?.onBatchWritten?.(count);
          throw new Error('第一批检查点之后中断');
        },
      }),
      shareDocument: share,
    }), /检查点之后中断/);
    assert.equal(reload(partial).artifacts.writtenBlockCount, 20);
    await deliverDocument('mock', 'title', blocks, reload(partial), { shareDocument: share });
    assert.equal(partialRemote.creates, 1);
    assert.deepEqual(partialRemote.batches[1], ['cb_20']);
    assert.equal(new Set(partialRemote.batches.flat()).size, 21);

    // 所有正文已确认，分享中断后恢复不再发 append。
    const sharing = fresh('before-share');
    const sharingRemote = documentServer(sharing);
    await assert.rejects(deliverDocument('mock', 'title', blocks, sharing, {
      shareDocument: async () => { throw new Error('分享中断'); },
    }), /分享中断/);
    assert.equal(reload(sharing).artifacts.writtenBlockCount, 21);
    const batchesBeforeShareResume = sharingRemote.batches.length;
    await deliverDocument('mock', 'title', blocks, reload(sharing), { shareDocument: share });
    assert.equal(sharingRemote.batches.length, batchesBeforeShareResume);

    // 非幂等 POST 响应丢失：本次不重试，下次 unknown 也不得重放。
    for (const operation of ['create', 'append'] as const) {
      const uncertain = fresh(`lost-${operation}`);
      const remote = documentServer(uncertain, operation === 'create', operation === 'append' ? 2 : -1);
      await assert.rejects(deliverDocument('mock', 'title', blocks, uncertain, { shareDocument: share }), /禁止自动重放/);
      const saved = reload(uncertain);
      assert.equal(saved.stages['doc-created'].status, 'unknown');
      assert.equal(saved.artifacts.pendingDocumentWrite?.operation, operation);
      assert.equal(remote.creates, 1);
      assert.equal(remote.batches.length, operation === 'append' ? 2 : 0);
      if (operation === 'append') assert.equal(saved.artifacts.writtenBlockCount, 20);
      const callsBeforeUnknownResume: number = networkCalls;
      await assert.rejects(deliverDocument('mock', 'title', blocks, saved), /人工核对/);
      assert.equal(networkCalls, callsBeforeUnknownResume);
    }

    // 远端成功响应已收到，但检查点落盘失败：旧文件仍保留未决标记。
    for (const operation of ['create', 'append'] as const) {
      const diskFailure = fresh(`disk-${operation}`);
      const remote = documentServer(diskFailure);
      fs.renameSync = (oldPath, newPath) => {
        const snapshot = JSON.parse(fs.readFileSync(oldPath, 'utf-8')) as DeliveryReceipt;
        if (!snapshot.artifacts.pendingDocumentWrite &&
            (operation === 'create' ? snapshot.artifacts.documentId : snapshot.artifacts.writtenBlockCount)) {
          throw new Error('检查点磁盘不可写');
        }
        originalRename(oldPath, newPath);
      };
      try {
        await assert.rejects(deliverDocument('mock', 'title', blocks, diskFailure, { shareDocument: share }), /磁盘不可写/);
      } finally {
        fs.renameSync = originalRename;
      }
      const saved = reload(diskFailure);
      assert.equal(saved.artifacts.pendingDocumentWrite?.operation, operation);
      assert.equal(remote.creates, 1);
      assert.equal(remote.batches.length, operation === 'append' ? 1 : 0);
      const callsBeforeDiskResume: number = networkCalls;
      await assert.rejects(deliverDocument('mock', 'title', blocks, saved), /人工核对/);
      assert.equal(networkCalls, callsBeforeDiskResume);
    }

    // 进程退出可能只留下 running + 未决标记；同样不代表可重放。
    const interrupted = fresh('running-create');
    interrupted.stages['doc-created'].status = 'running';
    interrupted.artifacts.pendingDocumentWrite = { operation: 'create' };
    writeReceipt(interrupted);
    const callsBeforeInterruptedResume = networkCalls;
    await assert.rejects(deliverDocument('mock', 'title', blocks, reload(interrupted)), /人工核对/);
    assert.equal(networkCalls, callsBeforeInterruptedResume);
    assert.equal(reload(interrupted).stages['doc-created'].status, 'unknown');

    // 旧 done/artifacts 间隙复用正文；缺少分享确认时仅恢复既有文档的分享。
    const legacy = fresh('legacy-done');
    delete legacy.checkpointVersion;
    completeStage(legacy, 'doc-created', { documentId: 'old-doc', url: 'https://example.invalid/old' });
    const callsBeforeLegacyResume: number = networkCalls;
    let legacyShares = 0;
    const oldDocument = await deliverDocument('mock', 'title', blocks, reload(legacy), {
      ...noBodyWrites,
      shareDocument: async (_token, documentId) => {
        legacyShares += 1;
        assert.equal(documentId, 'old-doc');
        return { url: 'https://example.invalid/old', shareDegraded: false };
      },
    });
    assert.equal(oldDocument.documentId, 'old-doc');
    assert.equal(legacyShares, 1);
    assert.equal(reload(legacy).artifacts.documentId, 'old-doc');
    assert.equal(reload(legacy).artifacts.docUrl, oldDocument.url);
    assert.equal(reload(legacy).artifacts.shareDegraded, false);
    assert.deepEqual(await deliverDocument('mock', 'title', blocks, reload(legacy)), oldDocument);
    assert.equal(networkCalls, callsBeforeLegacyResume);
    const legacyPartial = fresh('legacy-partial');
    delete legacyPartial.checkpointVersion;
    await assert.rejects(deliverDocument('mock', 'title', blocks, legacyPartial), /旧版未完成回执/);
    assert.equal(networkCalls, callsBeforeLegacyResume);

    // 即使数量合法，正文发生变化也不能按旧前缀追加。
    const changed = reload(sharing);
    changed.stages['doc-created'].status = 'failed';
    await assert.rejects(deliverDocument('mock', 'title', [...blocks, blocks[0]], changed), /正文内容或已写数量/);
    assert.equal(networkCalls, callsBeforeLegacyResume);

    // 5xx 及非 JSON 同样只有一次 POST；分享 permission 原样保留。
    for (const response of [new Response('server error', { status: 503 }), new Response('not-json')]) {
      let attempts = 0;
      handler = async () => { attempts += 1; return response; };
      await assert.rejects(createDocxDocument('mock', 'title'));
      assert.equal(attempts, 1);
    }
    let permissionWrites = 0;
    handler = async (_url, init) => {
      if (init?.method === 'PUT') {
        permissionWrites += 1;
        assert.deepEqual(JSON.parse(String(init.body)), {
          external_access_entity: 'open', security_entity: 'anyone_can_view',
          comment_entity: 'anyone_can_view', link_share_entity: 'anyone_readable', invite_external: true,
        });
      } else {
        assert.equal(init?.method, 'GET');
      }
      return json({});
    };
    assert.equal((await shareDocxDocument('mock', 'doc')).shareDegraded, true);
    assert.equal(permissionWrites, 1);

    // 回填按记录恢复；未确认记录只重复同值 PUT。
    const linking = fresh('linking');
    const records = [{ recordId: 'r1', key: 'k1' }, { recordId: 'r2', key: 'k2' }];
    const updated: string[] = [];
    let failSecond = true;
    const client = {
      updateRecord: async (_table: string, recordId: string) => {
        updated.push(recordId);
        if (recordId === 'r2' && failSecond) {
          assert.deepEqual(reload(linking).artifacts.linkedRecordIds, ['r1']);
          throw new Error('回填中断');
        }
      },
    };
    await assert.rejects(linkDocumentRecords(client, 'table', records, 'https://example.invalid/doc', linking), /回填中断/);
    failSecond = false;
    await linkDocumentRecords(client, 'table', records, 'https://example.invalid/doc', reload(linking));
    assert.deepEqual(updated, ['r1', 'r2', 'r2']);
    assert.equal(reload(linking).stages['doc-linked'].status, 'done');

    const card: FeishuNotifyPayload = { msg_type: 'text', content: { text: `offline ${docUrl}` } };
    const notifications: Array<{ channel: NotifyChannel; card: FeishuNotifyPayload }> = [
      { channel: 'customer', card }, { channel: 'internal', card },
    ];

    // 客户必须有正文完成、有效 HTTPS 链接和严格 false 的分享确认。
    const blockedCases: Array<{ name: string; prepare: (receipt: DeliveryReceipt) => void }> = [
      { name: 'no-document', prepare: (r) => { r.stages['doc-created'].status = 'pending'; r.artifacts = {}; } },
      { name: 'document-pending', prepare: (r) => { r.stages['doc-created'].status = 'pending'; } },
      { name: 'document-failed', prepare: (r) => { r.stages['doc-created'].status = 'failed'; } },
      { name: 'document-unknown', prepare: (r) => { r.stages['doc-created'].status = 'unknown'; } },
      { name: 'missing-url', prepare: (r) => { delete r.artifacts.docUrl; } },
      ...['', ' ', '/doc', '//example.invalid/doc', 'http://example.invalid/doc',
        'javascript:alert(1)', 'not-a-url', 'https://', 'https:///doc', 'https://[invalid',
        'https://example.invalid/ bad'].map((url, index) => ({
        name: `invalid-url-${index}`,
        prepare: (r: DeliveryReceipt) => { r.artifacts.docUrl = url; },
      })),
      { name: 'missing-share', prepare: (r) => { delete r.artifacts.shareDegraded; } },
      { name: 'degraded-share', prepare: (r) => { r.artifacts.shareDegraded = true; } },
      { name: 'null-share', prepare: (r) => { r.artifacts.shareDegraded = null as unknown as boolean; } },
    ];
    for (const { name, prepare } of blockedCases) {
      const blocked = fresh(`blocked-${name}`);
      confirmDocument(blocked);
      prepare(blocked);
      writeReceipt(blocked);
      const callsBeforeBlocked: number = networkCalls;
      let sends = 0;
      await assert.rejects(notifyDeliveryChannels(reload(blocked), notifications, async () => {
        sends += 1;
        return true;
      }), /客户群通知被阻断/);
      const saved = reload(blocked);
      assert.equal(sends, 0, `${name} 不得调用客户发送器`);
      assert.equal(networkCalls, callsBeforeBlocked);
      assert.equal(saved.stages.notified.status, 'failed', `${name} 必须可恢复而非 unknown`);
      assert.equal(saved.artifacts.pendingNotifyChannel, undefined);
      assert.deepEqual(saved.artifacts.notifiedChannels ?? [], []);
      confirmDocument(saved);
      const resumedChannels: string[] = [];
      await notifyDeliveryChannels(reload(saved), notifications, async (_card, channel) => {
        resumedChannels.push(channel!);
        assert.equal(reload(saved).artifacts.pendingNotifyChannel, channel);
        return true;
      });
      assert.deepEqual(resumedChannels, ['customer', 'internal']);
      assert.equal(reload(saved).stages.notified.status, 'done');
      await notifyDeliveryChannels(reload(saved), notifications, async () => {
        throw new Error('已确认通知不得重发');
      });
    }

    // 分享持续降级时一直阻断；确认同一文档后可恢复通知，不再写正文。
    const degraded = fresh('degraded-notification');
    confirmDocument(degraded);
    degraded.artifacts.shareDegraded = true;
    writeReceipt(degraded);
    let degradedSends = 0;
    const sendAfterShare = async () => { degradedSends += 1; return true; };
    await assert.rejects(notifyDeliveryChannels(degraded, notifications, sendAfterShare), /客户群通知被阻断/);
    await deliverDocument('mock', 'title', blocks, reload(degraded), { ...noBodyWrites, shareDocument: share });
    await assert.rejects(notifyDeliveryChannels(reload(degraded), notifications, sendAfterShare), /客户群通知被阻断/);
    assert.equal(degradedSends, 0);
    await deliverDocument('mock', 'title', blocks, reload(degraded), {
      ...noBodyWrites,
      shareDocument: async (_token, documentId) => {
        assert.equal(documentId, degraded.artifacts.documentId);
        return confirmedShare;
      },
    });
    await notifyDeliveryChannels(reload(degraded), notifications, sendAfterShare);
    assert.equal(degradedSends, 2);
    assert.equal(reload(degraded).stages.notified.status, 'done');

    // 内部-only 不要求文档；先发内部再遇客户门禁也保留内部成功检查点。
    const internalOnly = fresh('internal-only');
    const internalCard: FeishuNotifyPayload = { msg_type: 'text', content: { text: 'offline internal without document' } };
    const internalChannels: string[] = [];
    await notifyDeliveryChannels(internalOnly, [{ channel: 'internal', card: internalCard }], async (_card, channel) => {
      internalChannels.push(channel!);
      return true;
    });
    assert.deepEqual(internalChannels, ['internal']);
    assert.equal(reload(internalOnly).stages.notified.status, 'done');
    assert.equal(reload(internalOnly).stages['doc-created'].status, 'pending');
    const internalFirst = fresh('internal-first');
    const orderedChannels: string[] = [];
    const sendOrdered = async (_card: FeishuNotifyPayload, channel?: NotifyChannel) => {
      orderedChannels.push(channel!);
      return true;
    };
    const internalFirstNotifications = [...notifications].reverse();
    await assert.rejects(notifyDeliveryChannels(internalFirst, internalFirstNotifications, sendOrdered), /客户群通知被阻断/);
    assert.deepEqual(reload(internalFirst).artifacts.notifiedChannels, ['internal']);
    assert.equal(reload(internalFirst).artifacts.pendingNotifyChannel, undefined);
    confirmDocument(internalFirst);
    await notifyDeliveryChannels(reload(internalFirst), internalFirstNotifications, sendOrdered);
    assert.deepEqual(orderedChannels, ['internal', 'customer']);

    // 客户成功立即持久化；内部明确失败后续只补内部，不再检查客户门禁。
    const notifying = fresh('notifying');
    confirmDocument(notifying);
    const channels: string[] = [];
    await assert.rejects(notifyDeliveryChannels(notifying, notifications, async (_card, channel) => {
      channels.push(channel!);
      if (channel === 'internal') assert.deepEqual(reload(notifying).artifacts.notifiedChannels, ['customer']);
      return channel === 'customer';
    }), /部分渠道返回发送失败/);
    assert.equal(reload(notifying).stages.notified.status, 'failed');
    const internalResume = reload(notifying);
    internalResume.stages['doc-created'].status = 'pending';
    delete internalResume.artifacts.docUrl;
    delete internalResume.artifacts.shareDegraded;
    writeReceipt(internalResume);
    await notifyDeliveryChannels(reload(internalResume), notifications, async (_card, channel) => {
      channels.push(channel!);
      return true;
    });
    assert.deepEqual(channels, ['customer', 'internal', 'internal']);
    assert.equal(reload(notifying).stages.notified.status, 'done');

    // 渠道响应丢失保留已成功渠道，未知渠道需核对而非自动重发。
    const lostNotify = fresh('lost-notify');
    confirmDocument(lostNotify);
    await assert.rejects(notifyDeliveryChannels(lostNotify, notifications, async (_card, channel) => {
      if (channel === 'internal') throw new Error('通知响应丢失');
      return true;
    }), /人工核对/);
    assert.deepEqual(reload(lostNotify).artifacts.notifiedChannels, ['customer']);
    assert.equal(reload(lostNotify).artifacts.pendingNotifyChannel, 'internal');
    let resent = false;
    await assert.rejects(notifyDeliveryChannels(reload(lostNotify), notifications, async () => {
      resent = true;
      return true;
    }), /人工核对/);
    assert.equal(resent, false);

    // 客户发送结果未知优先于分享门禁：不能降为可重试失败，也不能自动重发。
    const lostCustomer = fresh('lost-customer');
    confirmDocument(lostCustomer);
    let customerAttempts = 0;
    const loseCustomerResponse = async () => {
      customerAttempts += 1;
      throw new Error('客户通知响应丢失');
    };
    await assert.rejects(notifyDeliveryChannels(lostCustomer, notifications, loseCustomerResponse), /人工核对/);
    const unknownCustomer = reload(lostCustomer);
    assert.equal(unknownCustomer.stages.notified.status, 'unknown');
    assert.equal(unknownCustomer.artifacts.pendingNotifyChannel, 'customer');
    delete unknownCustomer.artifacts.docUrl;
    delete unknownCustomer.artifacts.shareDegraded;
    writeReceipt(unknownCustomer);
    await assert.rejects(notifyDeliveryChannels(reload(unknownCustomer), notifications, loseCustomerResponse), /人工核对/);
    assert.equal(customerAttempts, 1);
    assert.equal(reload(unknownCustomer).stages.notified.status, 'unknown');
    assert.equal(reload(unknownCustomer).artifacts.pendingNotifyChannel, 'customer');
    confirmDocument(unknownCustomer);
    await assert.rejects(notifyDeliveryChannels(reload(unknownCustomer), notifications, loseCustomerResponse), /人工核对/);
    assert.equal(customerAttempts, 1, '补齐分享确认也不能重放 unknown 客户通知');

    // 真实共享 fetch 封装下，非幂等 POST 也只能尝试一次（不是仅 mock 上层发送器）。
    const { BitableClient } = await import('../feishu/bitable-client.js');
    const { sendFeishuNotify } = await import('../feishu/feishu-app.js');
    for (const key of Object.keys(process.env)) if (key.startsWith('FEISHU_')) delete process.env[key];
    const failResponse = (failure: string): Response => {
      if (failure === 'lost') throw new Error('响应丢失');
      if (failure === 'abort') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (failure === '503') return new Response('server error', { status: 503 });
      if (failure === 'invalid-json') return new Response('not-json');
      if (failure === 'empty-json') return new Response('{}');
      return new Response(JSON.stringify({ code: 123, msg: 'rejected' }));
    };
    for (const failure of ['lost', 'abort', '503', 'invalid-json', 'empty-json', 'api-error']) {
      let creates = 0;
      handler = async (url, init) => {
        if (url.includes('/auth/')) return new Response(JSON.stringify({ code: 0, tenant_access_token: 'mock' }));
        if (url.includes('/records/search')) return json({ items: [] });
        assert.ok(url.endsWith('/records'));
        assert.equal(init?.method, 'POST');
        creates += 1;
        return failResponse(failure);
      };
      const table = new BitableClient({ appId: 'mock', appSecret: 'mock', appToken: 'mock', runTableId: 'mock' });
      await assert.rejects(table.upsertRecord('table', 'item_key', 'key', { title: 'offline' }));
      assert.equal(creates, 1, `createRecord ${failure} 禁止内部重试`);

      for (const mode of ['app', 'webhook']) {
        process.env.FEISHU_APP_ID = 'mock';
        process.env.FEISHU_APP_SECRET = 'mock';
        process.env.FEISHU_CHAT_ID_INTERNAL = mode === 'app' ? 'mock-chat' : '';
        process.env.FEISHU_WEBHOOK_URL = 'https://example.invalid/webhook';
        let sends = 0;
        handler = async (url, init) => {
          if (url.includes('/auth/')) return new Response(JSON.stringify({ code: 0, tenant_access_token: 'mock' }));
          assert.ok(mode === 'app' ? url.includes('/im/v1/messages') : url === 'https://example.invalid/webhook');
          assert.equal(init?.method, 'POST');
          sends += 1;
          return failResponse(failure);
        };
        const receipt = fresh(`send-${mode}-${failure}`);
        await assert.rejects(notifyDeliveryChannels(receipt, [{ channel: 'internal', card }], sendFeishuNotify));
        assert.equal(sends, 1, `${mode} ${failure} 禁止内部重试`);
        const saved = reload(receipt);
        if (mode === 'app' && failure === 'api-error') {
          assert.equal(saved.stages.notified.status, 'failed');
        } else {
          assert.equal(saved.stages.notified.status, 'unknown');
          const beforeResume: number = networkCalls;
          await assert.rejects(notifyDeliveryChannels(saved, [{ channel: 'internal', card }], sendFeishuNotify), /人工核对/);
          assert.equal(networkCalls, beforeResume);
        }
      }
    }
    handler = async () => new Response(JSON.stringify({ code: 0 }));
    assert.equal(await sendFeishuNotify(card, 'internal'), true, '有效 Webhook 确认才算成功');
    delete process.env.FEISHU_WEBHOOK_URL;
    assert.equal(await sendFeishuNotify(card, 'internal'), false, '无通知配置不能当作成功');

    // 存在但损坏的回执不能被当成首次交付。
    const corruptPath = path.resolve(receiptPath('corrupt'));
    fs.writeFileSync(corruptPath, '{broken', 'utf-8');
    assert.throws(() => readReceipt('corrupt'), /人工核对/);
    assert.equal(fs.existsSync(path.join(tempDir, 'results/feishu-delivery-result.json')), false);
    console.log('交付恢复离线样例通过');
  } finally {
    fs.renameSync = originalRename;
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    process.chdir(cwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verifyDeliveryRecovery().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
