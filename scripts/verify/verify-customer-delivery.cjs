#!/usr/bin/env node
/**
 * 离线校验客户交付链路（飞书多维表 + 飞书文档）
 *   node scripts/verify/verify-customer-delivery.cjs
 *
 * 未生成 results/customer-delivery.json 时自动跳过集成断言，避免阻塞 CI。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { require: tsxRequire } = require('tsx/cjs/api');

const payloadMod = tsxRequire(
  path.join(__dirname, '../report/customer-delivery-payload.ts'),
  __filename,
);
const previewMod = tsxRequire(
  path.join(__dirname, '../report/customer-delivery-preview.ts'),
  __filename,
);
const docMod = tsxRequire(path.join(__dirname, '../feishu/doc-delivery.ts'), __filename);
const bitableMod = tsxRequire(path.join(__dirname, '../feishu/bitable-delivery.ts'), __filename);

const { sanitizeScriptLabel, readCustomerDeliveryPayload, resolveDeliveryImagePath } = payloadMod;
const { renderDeliveryPreview } = previewMod;
const { buildCustomerDocBlocks, buildCustomerDocTitle } = docMod;
const { buildDeliveryRecord } = bitableMod;

const ACCOUNT_LIKE = /(?:^|\s)(?:[\w.+-]+@[\w.-]+|\d{6,}|[a-z0-9]+(?:[_-][a-z0-9]+)+)(?=\s|$)/i;

function assertNoAccountLeak(label, where) {
  const hit = String(label).split('·').map((s) => s.trim()).filter((s) => ACCOUNT_LIKE.test(s));
  assert.deepStrictEqual(hit, [], `${where} 泄漏内部账号: ${label}`);
}

function main() {
  // 1. 标签脱敏
  assert.strictEqual(sanitizeScriptLabel('UAT环境 · 申请单流程 · 199702_comic_com'), 'UAT环境 · 申请单流程');
  assert.strictEqual(sanitizeScriptLabel('DEV环境 · 审批流程 · 13312349876'), 'DEV环境 · 审批流程');
  assert.strictEqual(
    sanitizeScriptLabel('Stage9084环境 · 申请单流程 · 183202411010_e-elitech_com'),
    'Stage9084环境 · 申请单流程',
  );
  assert.strictEqual(sanitizeScriptLabel('申请单流程'), '申请单流程');

  const payload = readCustomerDeliveryPayload();
  if (!payload) {
    console.log('⚠️  未找到 results/customer-delivery.json，跳过集成断言（先跑 npm run report:customer）');
    console.log('✅ 客户交付链路校验通过（仅单元断言）');
    return;
  }

  // 2. 载荷结构
  assert.strictEqual(payload.version, 1);
  assert.ok(payload.items.length > 0, '交付条目不能为空，否则客户会收到空报告');
  assert.ok(payload.headline, '缺少结论标题');
  assert.strictEqual(typeof payload.stats.coveragePct, 'number');

  for (const item of payload.items) {
    assert.ok(item.key && item.dedupeKey, '每条交付项都要有 key / dedupeKey');
    assert.ok(item.verdictLabel, `缺少判定文案: ${item.title}`);
    assertNoAccountLeak(item.scriptLabel, `item ${item.title}`);
    // pass 不应被标记为需要动手
    if (item.kind === 'pass') assert.strictEqual(item.actionable, false, `pass 项不应标记需处理: ${item.title}`);
  }

  // 3. 图片路径可解析
  let resolvable = 0;
  for (const item of payload.items) {
    for (const img of item.images) {
      const abs = resolveDeliveryImagePath(img.relPath);
      assert.ok(path.isAbsolute(abs), `图片路径应为绝对路径: ${img.relPath}`);
      if (fs.existsSync(abs)) resolvable += 1;
    }
  }
  console.log(`  图片可解析 ${resolvable} 张`);

  // 4. 飞书文档块
  const title = buildCustomerDocTitle(payload);
  assert.ok(title.includes('UI 验收检测报告'));
  const blocks = buildCustomerDocBlocks(payload, new Map());
  assert.ok(blocks.length > 0, '文档内容块不能为空');
  assert.strictEqual(blocks[0].block_type, docMod.DOC_BLOCK_TYPE.heading1);
  const kinds = new Set(blocks.map((b) => b.block_type));
  assert.ok(kinds.has(docMod.DOC_BLOCK_TYPE.heading2), '缺少二级标题');
  // 没有 token 时图片降级为文字提示，不应留下空块
  for (const b of blocks) {
    if (b.block_type === docMod.DOC_BLOCK_TYPE.image) {
      assert.ok(b.image && b.image.token, '图片块缺少 token');
    }
  }

  // 5. 多维表记录字段
  const sample = payload.items[0];
  const fields = buildDeliveryRecord(
    sample,
    payload,
    { tokens: new Map(), docUrl: 'https://example.invalid/doc' },
    resolveDeliveryImagePath,
  );
  assert.strictEqual(fields['页面'], sample.title);
  assert.strictEqual(fields['verdict'], sample.verdictLabel);
  assert.ok(fields['doc_url'], '缺少报告链接字段');

  // 6. 本地预览
  const html = renderDeliveryPreview(payload, title);
  assert.ok(html.includes(payload.headline), '预览缺少结论');
  assert.ok(html.includes('一、结论'), '预览缺少结论章节');
  assert.ok(html.includes('四、检测范围'), '预览缺少检测范围章节');

  console.log(`✅ 客户交付链路校验通过（${payload.items.length} 个交付条目）`);
}

main();
