import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { generateVisualReviewReport, validateReviewScope, reviewHash, reviewRegions, reviewStepLabel, REVIEW_NEXT } from '../report/visual-review-report.js';
import { publishVisualReview, readVisualReview, type ReviewTransport } from '../feishu/deliver-visual-review.js';
import type { CoverageSlot } from '../report/coverage-stats.js';
import { reviewReceiptPath, updateVisualReviewIndex } from '../feishu/visual-review-index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-review-'));
try {
  const goldenSource = fs.readFileSync(new URL('../../request-flow/tests/request/golden-regression.spec.ts', import.meta.url), 'utf8');
  for (const [title, snapshot, assertion] of [
    ['按单号搜索并校验列表', 'request-search-result', 'expectRowContains'],
    ['展开筛选并按固定关键字筛选', 'request-filter-result', 'expectReasonFilterResult'],
  ]) {
    const body = goldenSource.split(`test('${title}'`)[1]?.split('\n  });')[0];
    assert.ok(body, `缺少用例：${title}`);
    const captureEnd = body.indexOf(`snapshot: '${snapshot}'`);
    const assertionStart = body.indexOf(`await list.${assertion}(`);
    assert.ok(assertionStart >= 0 && captureEnd > assertionStart, '结果断言必须存在且先于截图');
    assert.ok(body.indexOf('await list.restoreDefaultList();') > captureEnd, '清除条件必须晚于结果截图');
  }
  const scriptKey = 'request-flow/dev/golden-regression/by-account/test';
  const runId = '2026-10-15T02-00-01-626Z';
  const current = path.join(dir, 'screenshots/flows', scriptKey, 'run-chromium-flow', runId, 'current.png');
  fs.mkdirSync(path.dirname(current), { recursive: true });
  const png = new PNG({ width: 100, height: 80 }); png.data.fill(255);
  fs.writeFileSync(current, PNG.sync.write(png));
  const baseline = path.join(dir, 'baseline.png'); fs.copyFileSync(current, baseline);
  const slot: CoverageSlot = {
    scriptKey, stepNumber: 1, stepName: '列表 <测试>', browser: 'chromium', status: 'minor',
    difference: 1, pageTitle: '列表', processOnly: false, baselinePath: baseline, currentPath: current,
    overlayPath: current, regions: [{ x: 1, y: 1, w: 30, h: 30, pixels: 200, ratio: 1, severity: 'high' }],
  };
  assert.equal(validateReviewScope([slot], scriptKey, runId), 'dev');
  assert.throws(() => validateReviewScope([slot], scriptKey, 'another-run'));
  assert.throws(() => validateReviewScope([{ ...slot, scriptKey: 'other' }], scriptKey, runId));
  const manifest = await generateVisualReviewReport([slot], scriptKey, runId, path.join(dir, 'source.html'), path.join(dir, 'out'));
  const report = readVisualReview(manifest);
  assert.equal(report.items.length, 1); assert.equal(report.items[0].images.length, 3);
  assert.match(report.title, /DEV环境/);
  assert.equal(report.env, 'dev', '运行绑定仍使用内部环境 ID');
  assert.match(fs.readFileSync(path.join(dir, 'out/index.html'), 'utf8'), /&lt;测试&gt;/);
  const replay = await generateVisualReviewReport([slot], scriptKey, runId, path.join(dir, 'source.html'), path.join(dir, 'again'));
  assert.equal(readVisualReview(replay).items[0].key, report.items[0].key);
  assert.equal(readVisualReview(replay).hash, report.hash, '换输出目录不改变内容哈希');
  assert.equal(report.hash, reviewHash(report));
  assert.match(report.items[0].description, /100.00%/);
  const regionSlot = { ...slot, difference: 0.007329644097222222 };
  const groupedPath = await generateVisualReviewReport([
    regionSlot, { ...regionSlot, stepNumber: 2, stepName: '搜索' },
  ], scriptKey, runId, path.join(dir, 'source.html'), path.join(dir, 'grouped'));
  const grouped = readVisualReview(groupedPath);
  assert.equal(grouped.items.length, 3); // 一个公共组，两个状态保留完整证据。
  assert.equal(grouped.items[0].images.length, 1);
  assert.deepEqual(grouped.items.slice(1).map(i => i.images.length), [2, 2]);
  assert.match(grouped.items[0].description, /列表 <测试>.*搜索/);
  assert.equal(grouped.items[0].images[0].label, '共同变化 · 细节 1');
  assert.match(grouped.items[1].description, /0.73%/);
  const cropped = PNG.sync.read(fs.readFileSync(grouped.items[0].images[0].file));
  assert.ok(cropped.height < 200, '小局部不得被拉伸成巨幅图片');
  const groupedHtml = fs.readFileSync(path.join(dir, 'grouped/index.html'), 'utf8');
  assert.match(groupedHtml, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.equal(reviewStepLabel('request-search-result'), '单号搜索结果');
  assert.equal(reviewStepLabel('request-filter-result'), '事由筛选结果');
  assert.equal(reviewStepLabel('request-search'), '搜索步骤截图', '历史截图不能改称搜索结果');
  assert.equal(groupedHtml.split(REVIEW_NEXT).length - 1, 1);
  const changed = PNG.sync.read(PNG.sync.write(png)); changed.data[0] = 0;
  assert.notEqual(reviewRegions(slot, png, png)[0].signature, reviewRegions(slot, png, changed)[0].signature,
    '同坐标但像素不同不能合并');
  const schema = { '复核项': 1, '复核状态': 3, '变化说明': 1, '证据图': 17, '处理角色': 1, '下一步': 1,
    '报告': 15, '运行批次': 1, '浏览器': 1, '环境': 1, '交付类型': 1, '样例键': 1 };
  const blocks: any[] = [], records: any[] = [];
  let documentCreates = 0, unknown = false;
  const service: ReviewTransport = {
    upload: async (file, type, parent) => `${type}:${parent}:${path.basename(file)}`,
    api: async (route, method = 'GET', body: any) => {
      if (route.includes('/fields?')) return { items: Object.entries(schema).map(([field_name, type]) => ({ field_name, type })) } as any;
      if (route === 'docx/v1/documents') { documentCreates++; if (unknown) throw new Error('timeout'); return { document: { document_id: 'doc' } }; }
      if (route.endsWith('/children')) { const b = { ...body.children[0], block_id: `block-${blocks.length}` }; blocks.push(b); return { children: [b] }; }
      if (route.includes('/blocks?')) return { items: blocks };
      if (route.includes('/blocks/') && method === 'GET') return { block: blocks.find(b => b.block_id === route.split('/').at(-1)) };
      if (route.includes('/blocks/') && method === 'PATCH') {
        const block = blocks.find(b => b.block_id === route.split('/').at(-1));
        if (body.replace_image) block.image = body.replace_image;
        if (body.update_text_elements) block.text = body.update_text_elements;
        return {};
      }
      if (route.endsWith('/records/search')) return { items: records.filter(r => r.fields['样例键'] === body.filter.conditions[0].value[0]) };
      if (route.endsWith('/records') && method === 'POST') {
        const record = { record_id: `record-${records.length}`, fields: body.fields }; records.push(record); return { record };
      }
      if (route.includes('/records/')) return { record: records.find(r => r.record_id === route.split('/').at(-1)) };
      throw new Error(`Unexpected ${route}`);
    },
  };
  const target = { app: 'base', table: 'review', origin: 'https://example.feishu.cn' };
  const receipt = path.join(dir, 'receipt.json');
  await publishVisualReview(report, target, receipt, service);
  assert.equal(documentCreates, 1); assert.equal(records.length, 1);
  assert.equal(records[0].fields['环境'], 'DEV环境');
  records[0].fields['复核状态'] = '确认缺陷'; records[0].fields['复核结论'] = '人工结论';
  const count = blocks.length;
  await publishVisualReview(report, target, receipt, service);
  assert.equal(documentCreates, 1); assert.equal(records.length, 1); assert.equal(blocks.length, count);
  assert.equal(records[0].fields['复核结论'], '人工结论'); assert.equal(records[0].fields['复核状态'], '确认缺陷');
  const stateDir = path.join(dir, 'state');
  assert.equal(reviewReceiptPath(target, report.id, stateDir), reviewReceiptPath(target, readVisualReview(replay).id, stateDir));
  const entry = { id: report.id, title: report.title, url: 'https://example.feishu.cn/docx/report-one' };
  const indexUrl = await updateVisualReviewIndex(target, entry, stateDir, service);
  const createsAfterIndex = documentCreates, indexBlocks = blocks.length;
  await updateVisualReviewIndex(target, entry, stateDir, service);
  assert.equal(documentCreates, createsAfterIndex); assert.equal(blocks.length, indexBlocks);
  const second = { id: 'second', title: '第二次交付', url: 'https://example.feishu.cn/docx/report-two' };
  assert.equal(await updateVisualReviewIndex(target, second, stateDir, service), indexUrl);
  await updateVisualReviewIndex(target, entry, stateDir, service);
  const indexText = blocks.at(-1).text.elements;
  assert.equal(indexText[1].text_run.content, second.title, '重试旧交付不得替换最新入口');
  assert.equal(indexText.filter((e: any) => e.text_run.text_element_style?.link).length, 2);
  await assert.rejects(publishVisualReview({ ...report, hash: 'changed' }, target, receipt, service), /不匹配/);
  unknown = true;
  const failedIndexDir = path.join(dir, 'failed-index');
  await assert.rejects(updateVisualReviewIndex(target, entry, failedIndexDir, service), /timeout/);
  const indexCreates = documentCreates;
  await assert.rejects(updateVisualReviewIndex(target, entry, failedIndexDir, service), /结果未知/);
  assert.equal(documentCreates, indexCreates);
  const pending = path.join(dir, 'pending.json');
  await assert.rejects(publishVisualReview(report, target, pending, service), /timeout/);
  const creates = documentCreates;
  await assert.rejects(publishVisualReview(report, target, pending, service), /结果未知/);
  assert.equal(documentCreates, creates);
  const image = report.items[0].images[0].file;
  fs.appendFileSync(image, 'changed'); assert.throws(() => readVisualReview(manifest), /已变化/);
  console.log('✓ 运行绑定、带标签整页及局部图、HTML 转义、证据哈希、重试去重、人工结论保护、未知写入阻断');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
