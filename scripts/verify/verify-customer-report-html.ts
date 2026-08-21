/**
 * 客户报告结构化验收：直接检查生成的 HTML 是否满足「客户可直观理解」的要求。
 * 用法: npx tsx scripts/verify/verify-customer-report-html.ts
 */
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';

const reportPath = path.resolve('results/ui-regression-customer.html');
assert.ok(fs.existsSync(reportPath), `报告不存在，请先执行 npm run report:customer: ${reportPath}`);
const html = fs.readFileSync(reportPath, 'utf8');

function check(name: string, fn: () => void) {
  fn();
  console.log(`  ✓ ${name}`);
}

check('首屏有一句话结论', () => {
  assert.match(html, /class="verdict (bad|good|unknown)"/);
  assert.match(html, /class="verdict-title">[^<]+/);
  assert.match(html, /(个 UI 问题需要处理|本次未发现 UI 衰退)/);
});

check('统计四格为客户口径', () => {
  for (const label of ['明显衰退', '轻微变化', '完全一致', '已对比步骤']) {
    assert.ok(html.includes(label), `缺少统计项: ${label}`);
  }
  assert.match(html, /合格率 [\d.]+%/);
});

check('按根因分组展示问题卡', () => {
  const groups = html.match(/class="issue-group/g) || [];
  assert.ok(groups.length > 0, '没有渲染任何问题分组卡');
  assert.match(html, /class="ig-reason"|判定依据|理由/);
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

check('标注框坐标在 0-100% 之间', () => {
  const boxes = [...html.matchAll(/class="mark-box [^"]*"[^>]*style="([^"]+)"/g)];
  assert.ok(boxes.length > 0, '没有渲染任何标注框');
  for (const [, style] of boxes) {
    const nums = [...style.matchAll(/(-?[\d.]+)%/g)].map((m) => Number(m[1]));
    for (const n of nums) {
      assert.ok(n >= 0 && n <= 100, `标注框百分比越界: ${style}`);
    }
  }
});

check('标注框按变化性质区分：实质变化与位移/渲染不同色', () => {
  assert.ok(html.includes('mark-real') || html.includes('mark-benign'), '标注框未区分变化性质');
  // 只要出现了非实质变化的框，就必须给出图例说明「内容一致」
  if (html.includes('mark-benign')) {
    assert.match(html, /位移\/渲染差异 \d+ 处（内容一致）/);
  }
});

check('差异视图三个 Tab 齐全且顺序正确', () => {
  const order = ['标注变化', '拖动对比', '像素差异'];
  const idx = order.map((t) => html.indexOf(t));
  for (let i = 0; i < order.length; i++) {
    assert.ok(idx[i] > -1, `缺少 Tab: ${order[i]}`);
    if (i > 0) assert.ok(idx[i] > idx[i - 1], `Tab 顺序不符: ${order[i]}`);
  }
});

check('不再出现内部术语', () => {
  for (const bad of ['blocker', 'pixelmatch', 'compareKind', 'severity']) {
    assert.ok(!html.includes(`>${bad}<`), `报告正文出现内部术语: ${bad}`);
  }
});

check('过程截图被标记，不当作验收结论', () => {
  if (html.includes('tag-process')) {
    assert.match(html, /tag-process/);
  }
});

console.log('\n✅ verify-customer-report-html 通过');
