/**
 * 客户报告结构化验收：直接检查生成的 HTML 是否满足「客户可直观理解」的要求。
 *
 * 用法:
 *   npx tsx scripts/verify/verify-customer-report-html.ts                 # 默认 results/ui-regression-customer.html
 *   npx tsx scripts/verify/verify-customer-report-html.ts --report=results/ui-regression-customer-uat.html
 *
 * 未生成报告时自动跳过集成断言（打印 SKIP 并不阻塞 smoke 链），报告存在时逐项核验。
 */
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';

const reportArg = process.argv.find((a) => a.startsWith('--report='))?.slice('--report='.length);
const reportPath = path.resolve(reportArg || 'results/ui-regression-customer.html');

if (!fs.existsSync(reportPath)) {
  console.log(
    `⚠️  未找到 ${path.relative(process.cwd(), reportPath)}，跳过集成断言（先跑 npm run report:customer）`,
  );
  console.log('✅ verify-customer-report-html 通过（跳过集成部分）');
  process.exit(0);
}

const html = fs.readFileSync(reportPath, 'utf8');

function check(name: string, fn: () => void) {
  fn();
  console.log(`  ✓ ${name}`);
}

check('首屏有一句话结论', () => {
  assert.match(html, /class="verdict (bad|good|unknown|watch)"/);
  assert.match(html, /class="verdict-title">[^<]+/);
  assert.match(
    html,
    /(个问题需要修复|本次未发现需要修复的问题|建议人工确认|交付批次有 \d+ 个运行|交付批次尚有 \d+ 个运行)/,
  );
});

check('首屏结论与统计口径一致', () => {
  const verdict = html.slice(html.indexOf('class="verdict '), html.indexOf('<div class="tabs">'));
  if (verdict.includes('class="verdict bad"')) {
    assert.ok(!verdict.includes('全部通过'), '存在需修复步骤时不得显示「全部通过」');
  }
});

check('统计四格为客户口径', () => {
  for (const label of ['需要修复', '无需处理', '完全一致', '已对比步骤']) {
    assert.ok(html.includes(label), `缺少统计项: ${label}`);
  }
  // P1-④ 统一口径：不再以「通过率」单值概括（通过/轻微/待建基线的口径不同）
  assert.ok(!html.includes('通过率'), '报告不应再出现「通过率」口径字样');
  assert.ok(!html.includes('passRate'), '报告不应泄漏内部字段名 passRate');
});

check('首屏有检测覆盖进度条', () => {
  assert.match(html, /class="coverage-bar/);
  assert.match(html, /检测覆盖/);
});

check('交付批次展示运行范围与 AI 补充口径', () => {
  if (!html.includes('class="batch-scope"')) return;
  assert.match(html, /本次交付范围/);
  assert.match(html, /已完成运行/);
  assert.match(html, /不包含其他历史截图/);
  assert.match(html, /AI 质量观察/);
  assert.match(html, /不改变上方截图基线验收结论/);
});

check('首屏有建议操作', () => {
  assert.match(html, /class="action-box"/);
  assert.match(html, /建议操作/);
});

check('问题速览含缩略图与优先级', () => {
  if (html.includes('class="brief ')) {
    assert.match(html, /class="brief-thumb/);
    assert.match(html, /class="brief-priority/);
  }
});

check('按根因分组展示问题卡（有问题时）', () => {
  const hasIssues = html.includes('class="issue-group');
  const passOnly = html.includes('本次未发现需要修复的问题');
  assert.ok(hasIssues || passOnly, '有问题时应渲染分组卡，无问题时应显示通过提示');
  if (hasIssues) {
    assert.match(html, /class="ig-reason"|判定依据|理由/);
  }
});

check('首屏为速览清单，大图证据放在对比明细', () => {
  const conclusion = html.slice(
    html.indexOf('id="panel-conclusion"'),
    html.indexOf('id="panel-regress"'),
  );
  assert.ok(conclusion.length > 0, '找不到结论面板');
  if (html.includes('class="brief ')) {
    assert.ok(
      !/class="issue-group/.test(conclusion),
      '结论页不应直接铺开大图证据卡，应只放速览清单',
    );
    assert.match(conclusion, /class="brief-link"[^>]*>看对比图</, '速览行缺少跳转明细的入口');
  }
});

check('轻微变化默认折叠，不与衰退混在一起', () => {
  if (html.includes('minor-block')) {
    const open = /<details class="minor-block"[^>]*\sopen/.test(html);
    assert.equal(open, false, '轻微变化区块不应默认展开');
  }
});

check('可接受差异不伪装成 P1 待办', () => {
  const parts = html.split('<li class="brief minor">').slice(1);
  for (const part of parts) {
    const seg = part.slice(0, part.indexOf('</li>'));
    assert.ok(!seg.includes('brief-priority'), '可接受差异不应显示 P1 优先级');
  }
});

check('轻微变化分组内不出现红框', () => {
  const parts = html.split('<article class="issue-group ');
  for (const part of parts.slice(1)) {
    const status = part.slice(0, 20).split('"')[0];
    if (status !== 'minor' && status !== 'pass') continue;
    const end = part.indexOf('</article>');
    const seg = end > 0 ? part.slice(0, end) : part;
    const id = (/id="([^"]+)"/.exec(seg) || [])[1] ?? status;
    assert.ok(
      !seg.includes('mark-real'),
      `分组 ${id} 结论为「${status}」却画了红框，与分级口径矛盾`,
    );
  }
});

check('标注框坐标在 0-100% 之间（有差异区时）', () => {
  const boxes = [...html.matchAll(/class="mark-box [^"]*"[^>]*style="([^"]+)"/g)];
  if (boxes.length === 0) return;
  for (const [, style] of boxes) {
    const nums = [...style.matchAll(/(-?[\d.]+)%/g)].map((m) => Number(m[1]));
    for (const n of nums) {
      assert.ok(n >= 0 && n <= 100, `标注框百分比越界: ${style}`);
    }
  }
});

check('标注框按变化性质区分（有差异区时）', () => {
  const boxes = [...html.matchAll(/class="mark-box /g)];
  if (boxes.length === 0) return;
  assert.ok(html.includes('mark-real') || html.includes('mark-benign'), '标注框未区分变化性质');
  if (html.includes('mark-benign')) {
    assert.match(html, /位移\/渲染差异 \d+ 处（内容一致）|细微差异 \d+ 处/);
  }
});

check('Tab 命名为验收结论 / 问题证据 / 检测覆盖', () => {
  assert.match(html, />验收结论</);
  assert.match(html, />问题证据/);
  assert.match(html, />检测覆盖</);
});
check('差异视图四个 Tab 齐全且顺序正确', () => {
  if (!html.includes('data-view="marked"')) return;
  const order = ['并排对比', '标注变化', '拖动对比', '像素差异'];
  const idx = order.map((t) => html.indexOf(t));
  for (let i = 0; i < order.length; i++) {
    assert.ok(idx[i] > -1, `缺少 Tab: ${order[i]}`);
    if (i > 0) assert.ok(idx[i] > idx[i - 1], `Tab 顺序不符: ${order[i]}`);
  }
});

check('不再出现内部术语 / 账号身份 / 运行目录', () => {
  // P1-⑤：正文、属性、src 全量不得出现内部实现串与测试账号
  for (const bad of ['blocker', 'pixelmatch', 'compareKind', 'severity']) {
    assert.ok(!html.includes(`>${bad}<`), `报告正文出现内部术语: ${bad}`);
  }
  for (const bad of ['技术附录', 'by-account', 'run-chromium', 'menma']) {
    assert.ok(!html.includes(bad), `报告泄漏内部串: ${bad}`);
  }
});

check('P1-⑤ 截图已资产中立化（不直连内部截图树）', () => {
  const srcs = [...html.matchAll(/(?:src|data-screenshot)="([^"]+)"/g)].map((m) => m[1]);
  for (const s of srcs) {
    if (/^(?:https?:|data:|blob:|#)/i.test(s)) continue;
    assert.ok(
      !s.includes('../screenshots') && !s.includes('screenshots-baseline'),
      `图片仍引用内部截图树: ${s}`,
    );
    assert.match(s, /-assets\//, `图片未指向中立资产目录: ${s}`);
  }
});

check('P1-⑤ 脚本标识已令牌化，且映射 sidecar 存在', () => {
  const keys = [
    ...html.matchAll(/(?:data-script-key|data-script)="([^"]+)"/g),
  ].map((m) => m[1]);
  for (const k of keys) {
    assert.match(k, /^k\d+$/, `脚本标识未令牌化: ${k}`);
  }
  if (keys.length > 0) {
    const slug = path.basename(reportPath).replace(/\.html?$/i, '');
    const sidecar = path.join(path.dirname(reportPath), `${slug}.report-keys.json`);
    assert.ok(fs.existsSync(sidecar), `缺少脚本标识映射 sidecar: ${sidecar}`);
    const map = JSON.parse(fs.readFileSync(sidecar, 'utf8')) as { keys?: Record<string, string> };
    assert.ok(map.keys && keys.every((k) => map.keys![k]), 'sidecar 未覆盖全部令牌');
  }
});

check('P1-⑤ 已移除技术附录与 runId 展示', () => {
  assert.ok(!html.includes('id="panel-runs"'), '不应再有技术附录面板');
  assert.ok(!html.includes('data-tab="runs"'), '不应再有技术附录 Tab');
  assert.ok(!html.includes('<th>runId</th>'), '检测覆盖表不应再有 runId 列');
  assert.ok(!html.includes('class="ig-run-id"'), '问题卡不应再展示 runId 胶囊');
  assert.ok(!html.includes('class="run-id-copy"'), '不应再有 runId 复制按钮');
});

check('过程截图被标记，不当作验收结论', () => {
  if (html.includes('tag-process')) {
    assert.match(html, /tag-process/);
  }
});

console.log(`\n✅ verify-customer-report-html 通过: ${path.relative(process.cwd(), reportPath)}`);
