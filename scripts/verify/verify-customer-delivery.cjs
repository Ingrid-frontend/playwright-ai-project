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

const envProfileMod = tsxRequire(path.join(__dirname, '../../src/utils/env-profile.ts'), __filename);
const { sanitizeScriptLabel, readCustomerDeliveryPayload, resolveDeliveryImagePath } = payloadMod;
const { resolveDeliveryPayloadPath } = envProfileMod;
const { renderDeliveryPreview } = previewMod;
const { buildCustomerDocBlocks, buildCustomerDocTitle } = docMod;
const { buildDeliveryRecord, hashItemKey } = bitableMod;

const ACCOUNT_LIKE = /(?:^|\s)(?:[\w.+-]+@[\w.-]+|\d{6,}|[a-z0-9]+(?:[_-][a-z0-9]+)+)(?=\s|$)/i;
const HASH_ITEM_KEY = /^[0-9a-f]{16}$/;

function isBenignOutgoingToken(seg) {
  const s = String(seg || '').trim();
  if (!s) return true;
  if (/^\d{4}-\d{2}-\d{2}T[\d-]+Z$/i.test(s)) return true;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) return true;
  return false;
}

function assertNoAccountLeak(label, where) {
  const raw = String(label).trim();
  if (isBenignOutgoingToken(raw)) return;
  const hit = raw
    .split('·')
    .map((s) => s.trim())
    .filter((s) => !isBenignOutgoingToken(s) && ACCOUNT_LIKE.test(s));
  assert.deepStrictEqual(hit, [], `${where} 泄漏内部账号: ${label}`);
}

/** 多维表一条记录的全部外发文本（字符串字段 + 链接字段），供脱敏断言 */
function collectOutgoingTexts(fields) {
  const out = [];
  for (const [, v] of Object.entries(fields)) {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object' && typeof v.link === 'string') {
      out.push(v.link, v.text || '');
    } else if (Array.isArray(v)) {
      for (const e of v) {
        if (typeof e === 'string') out.push(e);
        else if (e && typeof e.file_token === 'string') out.push(e.name || '');
      }
    }
  }
  return out;
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

  const env = process.argv.find((a) => a.startsWith('--env='))?.slice('--env='.length).trim().toLowerCase() || '';
  const payloadFile = env ? resolveDeliveryPayloadPath(env) : 'results/customer-delivery.json';
  const payload = readCustomerDeliveryPayload(payloadFile);
  if (!payload) {
    if (env) {
      console.error(`❌ 未找到 ${payloadFile}，请先执行 npm run deliver:ready -- --env=${env}`);
      process.exit(1);
    }
    console.log(`⚠️  未找到 ${payloadFile}，跳过集成断言（先跑 npm run report:customer）`);
    console.log('✅ 客户交付链路校验通过（仅单元断言）');
    return;
  }

  // 2. 载荷结构
  assert.strictEqual(payload.version, 1);
  assert.ok(payload.items.length > 0, '交付条目不能为空，否则客户会收到空报告');
  assert.ok(payload.headline, '缺少结论标题');
  assert.strictEqual(typeof payload.stats.coveragePct, 'number');
  assert.ok(payload.deliveryId, '缺少稳定交付身份 deliveryId');
  assert.strictEqual(typeof payload.totalIssueCount, 'number', '缺少 totalIssueCount');
  assert.strictEqual(typeof payload.totalSampleCount, 'number', '缺少 totalSampleCount');
  // totalIssueCount 应 >= 实际 issues 数量（可能被截断）
  const actualIssues = payload.items.filter((i) => i.kind === 'regress' || i.kind === 'minor').length;
  assert.ok(payload.totalIssueCount >= actualIssues, 'totalIssueCount 不应小于实际问题数');
  const actualSamples = payload.items.filter((i) => i.kind === 'pass').length;
  assert.ok(payload.totalSampleCount >= actualSamples, 'totalSampleCount 不应小于实际抽样数');
  if (env) {
    assert.strictEqual(payload.deliveryReady, true, '按环境交付时 deliveryReady 须为 true');
    assert.strictEqual(payload.envId, env, 'envId 与 --env 不一致');
    assert.ok(payload.deliveryId.includes(env), 'deliveryId 应包含环境标识');
  }

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

  // 4.1 recordUrls 应被用于证据链接
  const issues = payload.items.filter((i) => i.kind === 'regress' || i.kind === 'minor');
  if (issues.length > 0) {
    const fakeRecordUrls = new Map();
    const fakeUrl = 'https://feishu.cn/base/test?table=t1&record=rec1';
    fakeRecordUrls.set(issues[0].key, fakeUrl);
    const blocksWithUrls = buildCustomerDocBlocks(payload, fakeRecordUrls);
    // 找到包含证据链接的文本块
    const evidenceBlock = blocksWithUrls.find(
      (b) => b.text && b.text.elements && b.text.elements.some((e) => e.text_run.content.includes(fakeUrl)),
    );
    assert.ok(evidenceBlock, '提供 recordUrls 时文档应包含证据链接');
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
  // 5.1 item_key 必须是哈希（原始 key 含内部路径/账号，不可外发）
  assert.ok(HASH_ITEM_KEY.test(fields['item_key']), `item_key 应为 16 位哈希: ${fields['item_key']}`);
  assert.strictEqual(fields['item_key'], hashItemKey(sample.key), 'item_key 应为 key 的哈希');
  // 5.2 多维表全部外发文本不得含内部账号/目录串
  for (const text of collectOutgoingTexts(fields)) {
    assertNoAccountLeak(text, `多维表字段 item ${sample.title}`);
    assert.ok(!text.includes('by-account') && !text.includes('golden-regression'), `多维表外发内部路径: ${text}`);
  }

  // 5.3 dry-run 执行计划若已生成，同样不得含原始 key / 图片路径
  const planPath = path.join(process.cwd(), 'results', 'feishu-delivery-plan.json');
  if (fs.existsSync(planPath)) {
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
    for (const p of plan.items || []) {
      assert.ok(HASH_ITEM_KEY.test(p.key), `计划 key 应为哈希: ${p.key}`);
      assertNoAccountLeak(p.flow || '', `计划 ${p.title}`);
      assert.ok(!p.images || p.images.every((s) => typeof s === 'string' && !s.includes('/')), '计划不得含图片路径');
    }
  }

  // 6. 本地预览
  const html = renderDeliveryPreview(payload, title);
  // 章节编号会随「已验证抽样 / 待补基线」的出现而变，只断言章节名不断言序号
  assert.ok(html.includes('结论'), '预览缺少结论章节');
  assert.ok(html.includes('问题与证据'), '预览缺少问题与证据章节');
  assert.ok(html.includes('检测范围'), '预览缺少检测范围章节');

  // 6.1 口径：覆盖率不足时不得输出独立通过率格
  // （24/24=100% 与「覆盖 65%」并排，客户会误读成整体验收通过）
  if ((payload.stats.uncoveredSteps ?? 0) > 0) {
    assert.ok(!/>通过率</.test(html), '覆盖率不足时不应输出独立通过率格');
    assert.ok(html.includes('待建基线'), '覆盖率不足时应给出待建基线统计');
  }
  if ((payload.uncoveredList || []).length > 0) {
    assert.ok(html.includes('待补基线'), '有待建基线时应给出待补基线章节');
  }

  // 6.2 契约：问题项与抽样项互斥——有问题时不拿零差异项凑数
  const itemKinds = new Set(payload.items.map((i) => i.kind));
  assert.ok(
    !((itemKinds.has('regress') || itemKinds.has('minor')) && itemKinds.has('pass')),
    '问题项与「已验证抽样」项不应混在同一份交付里',
  );

  console.log(`✅ 客户交付链路校验通过（${payload.items.length} 个交付条目）`);
}

main();
