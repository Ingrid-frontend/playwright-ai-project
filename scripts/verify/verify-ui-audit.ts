/**
 * 验证 AI UI 审计全链路（无需 AI_API_KEY）：
 * 1. 造 fixture 截图 + fixture meta
 * 2. 运行 mock 分析
 * 3. 断言三态结论 + 问题数
 * 4. 生成 HTML 报告并验证标注框
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportDir = path.resolve(__dirname, '../../results/ui-audit-verify');
const assetDir = path.join(reportDir, 'assets');

function makeFixturePng(width = 1440, height = 900): Buffer {
  const png = new PNG({ width, height });
  // 画一个简单的"页面"：蓝色 header，浅灰表格，红色溢出按钮
  const rgba = new Uint8ClampedArray(png.data);
  const set = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    const idx = (y * width + x) * 4;
    rgba[idx] = r;
    rgba[idx + 1] = g;
    rgba[idx + 2] = b;
    rgba[idx + 3] = a;
  };

  for (let y = 0; y < 900; y++) {
    for (let x = 0; x < 1440; x++) {
      if (y < 80) {
        // header: 蓝色
        set(x, y, 30, 80, 220);
      } else if (y < 400) {
        // 表格区域: 浅灰
        set(x, y, 245, 245, 245);
      } else if (y >= 700 && y < 740 && x >= 1360) {
        // 溢出按钮: 红色
        set(x, y, 220, 50, 50);
      } else {
        // 背景: 白色
        set(x, y, 255, 255, 255);
      }
    }
  }
  return PNG.sync.write(png);
}

function fixtureMeta(): Record<string, unknown> {
  return {
    capturedAt: new Date().toISOString(),
    url: 'https://fixture.example.com/approve',
    title: '审批列表 - 测试',
    viewport: { width: 1440, height: 900 },
    imageWidth: 1440,
    imageHeight: 900,
    layout: {
      horizontalOverflow: true,
      scrollWidth: 1482,
      innerWidth: 1440,
    },
    consoleErrors: ['Uncaught TypeError: xxx is not a function'],
    pageErrors: [],
    selectors: {
      '.submit-btn': {
        exists: true,
        bbox: { x: 1360, y: 700, width: 120, height: 40 },
      },
      '.title': {
        exists: true,
        bbox: { x: 120, y: 80, width: 300, height: 30 },
      },
      '.missing-table': {
        exists: false,
        bbox: null,
      },
    },
    textSections: [
      { key: 'header', text: '我的审批 待我审批 已审批 我发起的', charCount: 20 },
      { key: 'table', text: '编号 标题 申请人 状态 操作', charCount: 18 },
    ],
  };
}

async function main(): Promise<void> {
  console.log('=== AI UI 审计验证 ===\n');

  // 清理并重建
  fs.rmSync(reportDir, { recursive: true, force: true });
  fs.mkdirSync(assetDir, { recursive: true });

  // 写 fixture 截图
  const pngBuf = makeFixturePng();
  const pngPath = path.join(assetDir, 'fixture.png');
  fs.writeFileSync(pngPath, pngBuf);

  // 写 fixture meta
  const metaPath = path.join(assetDir, 'fixture.meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(fixtureMeta()), 'utf-8');

  // 设置 mock 环境：清掉整条 Key 回退链，避免 .env 里的真实 Key 让验证走真调用
  process.env.AI_AUDIT_MOCK = '1';
  delete process.env.AI_API_KEY;
  delete process.env.AI_TEST_OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  // 动态导入（保持与 tsx ESM 运行方式一致）
  const { auditStep } = await import('../report/ui-audit-analyzer.js');
  const { renderAuditReportHtml, relativeAssetPath } = await import('../report/ui-audit-report.js');

  // 审计
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const result = await auditStep(pngPath, meta, {
    scriptKey: 'verify/self-test',
    stepName: '自测页面',
    stepNumber: 1,
    expect: ['标题', '表格', '提交按钮', '分页'],
  });

  // 断言
  assert.notEqual(result.verdict, 'pass', 'mock 分析应发现至少 1 个问题');
  assert.ok(result.issues.length >= 2, `mock 分析应至少发现 2 个问题（实际 ${result.issues.length}）`);
  assert.ok(result.score >= 0 && result.score <= 100, `score 在 0-100 范围内（实际 ${result.score}）`);

  // 验证具体问题类型
  const types = result.issues.map((i: { type: string }) => i.type);
  assert.ok(types.includes('console'), '应该有 console 错误问题');
  assert.ok(types.includes('overflow'), '应该有 overflow 问题');
  assert.ok(types.includes('missing-element'), '应该有 missing-element 问题');
  console.log(`✅ mock 分析产出 ${result.issues.length} 个问题，结论 ${result.verdict}`);

  // 生成报告
  const steps = [
    {
      scriptKey: 'verify/self-test',
      stepName: '自测页面',
      stepNumber: 1,
      screenshotRel: relativeAssetPath(reportDir, pngPath),
      imageWidth: 1440,
      imageHeight: 900,
      viewportWidth: 1440,
      viewportHeight: 900,
      result,
    },
  ];
  const html = renderAuditReportHtml(steps);
  const htmlPath = path.join(reportDir, 'index.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');

  // 验证 HTML 包含标注框
  assert.ok(html.includes('class="box"'), '报告 HTML 应包含标注框 overlay');
  assert.ok(html.includes('需修复') || html.includes('待确认'), '报告应包含三态结论');
  assert.ok(html.includes('src="' + steps[0].screenshotRel + '"'), '截图路径应正确');
  console.log('✅ 报告 HTML 包含标注框与三态结论');

  // 验证 bbox 换算：.submit-btn 在 x=1360/1440 → 约 94.4%
  assert.ok(
    html.includes('left:94.44%'),
    'bbox 应按视口百分比换算（.submit-btn 期望 left:94.44%）',
  );
  console.log('✅ bbox 百分比换算正确');

  // 回归断言：无信号的 meta 不得谎报"通过"，必须是 skipped
  const emptyMetaPath = path.join(assetDir, 'empty.meta.json');
  fs.writeFileSync(
    emptyMetaPath,
    JSON.stringify({
      url: 'https://fixture.example.com/empty',
      viewport: { width: 1440, height: 900 },
      imageWidth: 1440,
      imageHeight: 900,
    }),
    'utf-8',
  );
  const emptyResult = await auditStep(pngPath, JSON.parse(fs.readFileSync(emptyMetaPath, 'utf-8')), {
    scriptKey: 'verify/self-test',
    stepName: '无信号页面',
  });
  assert.equal(
    emptyResult.verdict,
    'skipped',
    '缺少判定依据时必须标记 skipped，不能谎报 pass（假绿回归）',
  );
  console.log('✅ 无判定依据时正确标记为未审计，未产生假绿');

  // 清理
  fs.rmSync(reportDir, { recursive: true, force: true });

  console.log('\n🎉 全链路验证通过');
}

main().catch((err) => {
  console.error('❌ 验证失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});