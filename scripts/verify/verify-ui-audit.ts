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

  const { parseFigmaUrl, matchFigmaMapping } = await import('../report/figma-baseline.js');
  const parsed = parseFigmaUrl('https://www.figma.com/design/AbCd1234/My-File?node-id=12-34');
  assert.ok(parsed, '应能解析带 node-id 的 Figma URL');
  assert.equal(parsed.fileKey, 'AbCd1234');
  assert.equal(parsed.nodeId, '12:34');
  assert.equal(parseFigmaUrl('https://www.figma.com/design/AbCd1234/My-File'), null, '缺 node-id 应拒绝');
  const mapped = matchFigmaMapping(
    [{ script: 'verify/self-test', figmaUrl: 'https://www.figma.com/design/AbCd1234/x?node-id=1-2' }],
    'verify/self-test',
    '自测页面',
    1,
  );
  assert.ok(mapped, '应按 script 匹配到 Figma 映射');
  console.log('✅ Figma URL 解析与配置匹配正确');

  const { resolveFigmaBaseline } = await import('../report/figma-baseline.js');
  const storeUrl = 'https://www.figma.com/design/AbCd1234/x?node-id=99-88';
  const storePng = path.join(reportDir, 'screenshots-baseline', 'figma', 'images', 'AbCd1234_99-88.png');
  fs.mkdirSync(path.dirname(storePng), { recursive: true });
  fs.copyFileSync(pngPath, storePng);
  const origCwd = process.cwd();
  process.chdir(reportDir);
  const offline = await resolveFigmaBaseline({
    scriptKey: 'verify/self-test',
    stepName: 'fixture',
    cliFigmaUrl: storeUrl,
  });
  process.chdir(origCwd);
  assert.equal(offline?.source, 'store', '应命中本地 Figma 缓存');
  console.log('✅ 审计默认只读本地 Figma 缓存（无需 Token）');

  const figmaHtml = renderAuditReportHtml([{ ...steps[0], figmaRel: steps[0].screenshotRel }]);
  assert.ok(figmaHtml.includes('Figma 设计稿'), '有 Figma 基准时应并排展示设计稿');
  console.log('✅ 报告在有 Figma 基准时展示设计稿对照');

  const mockWithFigma = await auditStep(
    pngPath,
    JSON.parse(fs.readFileSync(emptyMetaPath, 'utf-8')),
    { scriptKey: 'verify/self-test', stepName: '无信号页面' },
    { figmaImagePath: pngPath },
  );
  assert.equal(mockWithFigma.verdict, 'skipped', 'mock 有 Figma 图但仍无规则信号时保持 skipped');
  assert.ok(
    mockWithFigma.issues.some((i: { description: string }) => i.description.includes('Figma')),
    'mock 应提示 Figma 基准未被对比',
  );
  console.log('✅ mock + Figma 不会把无信号步骤谎报为通过');

  const { applyAuditRules: applyRules, resolveAuditRule } = await import('../report/ui-audit-rules.js');

  const actionRule = resolveAuditRule(
    'dev/260911/工作台_2026-08-20_19-29-59',
    'action-skipped',
    5,
  );
  assert.ok(actionRule, '无 step 的全局规则应命中 action-skipped');
  const actionFiltered = applyRules(
    {
      score: 82,
      verdict: 'review',
      source: 'ai',
      issues: [
        {
          id: 'o1',
          type: 'occlusion',
          severity: 'noise',
          selector: '',
          bbox: null,
          description: '右侧悬浮AI入口贴视口右边缘，图标被部分裁切',
          confidence: 0.35,
        },
      ],
    },
    actionRule,
  );
  assert.equal(actionFiltered.issues.length, 0, '悬浮 AI 裁切应被 dropPatterns 过滤');

  const filtered = applyRules(
    {
      score: 85,
      verdict: 'review',
      source: 'ai',
      issues: [
        {
          id: 'n1',
          type: 'truncation',
          severity: 'noise',
          selector: '',
          bbox: null,
          description: '单号截断',
          confidence: 0.5,
        },
        {
          id: 'w1',
          type: 'occlusion',
          severity: 'warning',
          selector: '',
          bbox: null,
          description: '右下角悬浮圆形按钮压在分页“跳至”输入框上',
          confidence: 0.5,
        },
      ],
    },
    {
      script: '260911',
      dropNoiseBelow: 0.55,
      dropPatterns: ['跳至', '悬浮圆形'],
    },
  );
  assert.equal(filtered.issues.length, 0, '应过滤低置信 noise/warning 与 dropPatterns');
  assert.equal(filtered.verdict, 'pass', '过滤后应恢复 pass');
  console.log('✅ 业务白名单后处理可过滤低置信 noise/warning');

  const { resolveHeliosAuditContext } = await import('../report/helios-design-spec.js');
  const helios = resolveHeliosAuditContext('flows/request-flow/dev/golden-regression', 'request-detail', 1);
  assert.equal(helios.enabled, true);
  assert.ok(helios.layoutRules && helios.layoutRules.length > 0);
  assert.ok(helios.tokensSummary && helios.tokensSummary.includes('主题色'));
  console.log('✅ Helios 设计规范可解析并注入审计上下文');

  // 清理
  fs.rmSync(reportDir, { recursive: true, force: true });

  console.log('\n🎉 全链路验证通过');
}

main().catch((err) => {
  console.error('❌ 验证失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});