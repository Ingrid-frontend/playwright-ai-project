export function customerReportCss(): string {
  return `
:root {
  --bg: #f6f7f9;
  --card: #fff;
  --text: #1f2329;
  --muted: #646a73;
  --line: #e5e6eb;
  --green: #2f9e44;
  --red: #e03131;
  --amber: #f08c00;
  --blue: #228be6;
}
* { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
}
.header {
  background: linear-gradient(135deg, #1b2a4a 0%, #2c4a7c 100%);
  color: #fff;
  padding: 28px 32px 22px;
}
.header h1 { font-size: 24px; font-weight: 650; }
.header .sub { margin-top: 6px; opacity: 0.85; font-size: 13px; }
.wrap { max-width: 1180px; margin: 0 auto; padding: 20px 20px 48px; }
.verdict {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 18px 20px;
  margin-bottom: 16px;
}
.verdict-title { font-size: 20px; font-weight: 650; }
.verdict-meta { margin-top: 8px; color: var(--muted); font-size: 14px; }
.verdict { border-left: 4px solid var(--line); }
.verdict.bad { border-left-color: var(--red); }
.verdict.good { border-left-color: var(--green); }
.verdict.unknown { border-left-color: var(--amber); }
.verdict.bad .verdict-title { color: #c92a2a; }
.verdict.good .verdict-title { color: #2b8a3e; }
.verdict.watch { border-left-color: var(--amber); }
.verdict.watch .verdict-title { color: #a37200; }
.verdict-foot {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-top: 14px;
}
.stat {
  background: #f8f9fb;
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}
.stat .n { display: block; font-size: 22px; font-weight: 700; }
.stat .l { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }
.stat .h { display: block; font-size: 11px; color: #9aa0a6; margin-top: 2px; }
.n-green { color: var(--green); }
.n-red { color: var(--red); }
.n-amber { color: var(--amber); }
.tabs {
  display: flex;
  gap: 8px;
  margin: 18px 0 12px;
  flex-wrap: wrap;
}
.tab {
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 999px;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
}
.tab.active {
  background: #1b2a4a;
  border-color: #1b2a4a;
  color: #fff;
}
.panel { display: none; }
.panel.active { display: block; }
.page-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 14px;
}
.page-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.page-title { font-size: 16px; font-weight: 650; }
.page-sub { color: var(--muted); font-size: 12px; }
.browser-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
}
.browser-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
  background: #fafbfc;
}
.browser-card.regress { border-color: #ffc9c9; background: #fff5f5; }
.browser-card.minor { border-color: #ffe8a3; background: #fffdf5; }
.browser-card.uncovered { border-color: #ffe8a3; background: #fff9db; }
.bc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
}
.badge {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
}
.badge-pass { background: #d3f9d8; color: #2b8a3e; }
.badge-regress { background: #ffe3e3; color: #c92a2a; }
.badge-minor { background: #fff3bf; color: #a37200; }
.badge-uncovered { background: #fff3bf; color: #e67700; }
.slider-compare {
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  background: #111;
  aspect-ratio: 16 / 9;
}
.slider-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.slider-after-clip {
  position: absolute;
  inset: 0;
  width: 50%;
  overflow: hidden;
}
.slider-after-clip .slider-after { width: 200%; max-width: none; }
.slider-range {
  position: absolute;
  left: 0; right: 0; bottom: 8px;
  width: 100%;
  z-index: 3;
  margin: 0;
}
.slider-handle-line {
  position: absolute;
  top: 0; bottom: 0;
  left: 50%;
  width: 2px;
  background: #fff;
  z-index: 2;
  pointer-events: none;
}
.view-btns { display: flex; gap: 6px; margin: 8px 0; }
.view-btn {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}
.view-btn.active { background: #1b2a4a; color: #fff; border-color: #1b2a4a; }
.diff-view-panel { display: none; }
.diff-view-panel.active { display: block; }
.overlay-img {
  width: 100%;
  border-radius: 6px;
  display: block;
  background: #111;
}
.plain { margin-top: 8px; font-size: 13px; color: var(--muted); }
.empty {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 28px;
  text-align: center;
  color: var(--muted);
}
.empty.ok {
  border-color: #b2f2bb;
  background: #ebfbee;
  color: #2b8a3e;
  margin-bottom: 14px;
}
.sec-lead {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--muted);
}
.sec-title {
  margin: 18px 0 10px;
  font-size: 15px;
  font-weight: 650;
}
.sec-title.sec-regress { color: var(--red); }
.sec-title.sec-pass { color: var(--green); }
.sec-title.sec-minor { color: #a37200; margin-top: 26px; }
/* 首屏速览清单：一行一个问题，不放大图，客户一眼扫完全部结论 */
.brief-list {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}
.brief {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
  border-left: 3px solid transparent;
}
.brief:last-child { border-bottom: none; }
.brief.regress { border-left-color: var(--red); }
.brief.minor { border-left-color: var(--amber); }
.brief-no {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: #f1f3f5;
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
  display: flex;
  align-items: center;
  justify-content: center;
}
.brief.regress .brief-no { background: #ffe3e3; color: #c92a2a; }
.brief-main { min-width: 0; }
.brief-title { display: block; font-size: 14px; font-weight: 600; }
.brief-reason {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
}
.brief-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.brief-diff { font-weight: 650; color: var(--text); font-variant-numeric: tabular-nums; }
.brief-link {
  font-size: 12px;
  color: var(--blue);
  text-decoration: none;
  border: 1px solid #d0ebff;
  border-radius: 5px;
  padding: 4px 10px;
  white-space: nowrap;
}
.brief-link:hover { background: #e7f5ff; }
.uncovered-summary {
  margin-top: 18px;
  background: #fff9db;
  border: 1px solid #ffe8a3;
  border-radius: 10px;
  padding: 14px 16px;
}
.uncovered-summary-title {
  font-size: 14px;
  font-weight: 650;
  color: #e67700;
}
.uncovered-summary-meta {
  margin: 6px 0 10px;
  font-size: 12px;
  color: var(--muted);
}
.uncovered-preview {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
}
.uncovered-preview li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(0,0,0,.06);
  font-size: 13px;
}
.uncovered-preview .uc-title { font-weight: 500; }
.uncovered-preview .uc-sub { color: var(--muted); font-size: 12px; }
.uncovered-preview .uc-more { color: var(--muted); border-bottom: none; }
.link-btn {
  border: 1px solid #ffe8a3;
  background: #fff;
  color: #e67700;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}
.link-btn:hover { background: #fff3bf; }
.scope-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
}
.scope-table th, .scope-table td {
  border-bottom: 1px solid var(--line);
  padding: 10px 12px;
  text-align: left;
  vertical-align: top;
}
.scope-table th { background: #f1f3f5; font-weight: 600; }
.scope-table td.st-regress { color: var(--red); font-weight: 600; }
.scope-table td.st-minor { color: #a37200; }
.scope-table td.st-pass { color: var(--green); }
.scope-table td.st-uncovered { color: var(--muted); }
.run-history-block { margin-bottom: 20px; }
.run-history-title { font-size: 15px; font-weight: 650; margin: 0 0 6px; }
.run-history-meta { margin: 0 0 10px; font-size: 12px; color: var(--muted); }
.run-history-table { margin-bottom: 0; }
.tag-latest {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #e7f5ff;
  color: #1971c2;
  font-size: 11px;
  font-weight: 600;
}
.tag-process {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #f1f3f5;
  color: var(--muted);
  font-size: 11px;
  font-weight: 500;
}
.issue-group {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 14px;
}
.issue-group.regress { border-left: 4px solid var(--red); }
.issue-group.minor { border-left: 4px solid var(--amber); }
.issue-group.ig-flash { box-shadow: 0 0 0 3px rgba(34, 139, 230, 0.35); }
.issue-group { scroll-margin-top: 16px; transition: box-shadow 0.3s ease; }
.ig-head { display: flex; gap: 12px; align-items: flex-start; }
.ig-index {
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: #1b2a4a;
  color: #fff;
  font-size: 13px;
  font-weight: 650;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ig-main { flex: 1 1 auto; min-width: 0; }
.ig-title { font-size: 16px; font-weight: 650; }
.ig-reason { margin-top: 4px; font-size: 13px; color: var(--text); }
.ig-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-top: 8px;
  font-size: 12px;
  color: var(--muted);
}
.issue-group .page-card {
  border: none;
  padding: 12px 0 0;
  margin: 12px 0 0;
  border-top: 1px solid var(--line);
}
.page-card.compact .page-title { font-size: 14px; }
.group-others {
  margin-top: 12px;
  border-top: 1px solid var(--line);
  padding-top: 10px;
}
.group-others > summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--blue);
}
.minor-block {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  margin: 18px 0 14px;
}
.minor-block > summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.minor-block[open] > summary { margin-bottom: 12px; }
.mark-wrap {
  position: relative;
  border-radius: 6px;
  overflow: hidden;
  background: #f1f3f5;
  line-height: 0;
}
.mark-img { width: 100%; display: block; }
.mark-box {
  position: absolute;
  border: 2px solid var(--red);
  border-radius: 2px;
  box-shadow: 0 0 0 2px rgba(224, 49, 49, 0.18);
  pointer-events: none;
}
/* 实质变化用红框，位移/渲染差异用灰蓝虚线框：客户一眼分清哪些要处理 */
.mark-box.mark-benign {
  border: 2px dashed #868e96;
  box-shadow: none;
}
.mark-box.mark-benign .mark-tag { background: #868e96; }
.mark-tag {
  position: absolute;
  top: -2px;
  left: -2px;
  background: var(--red);
  color: #fff;
  font-size: 10px;
  line-height: 1.4;
  padding: 0 4px;
  border-radius: 2px;
}
.mark-empty {
  position: absolute;
  left: 8px;
  bottom: 8px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 11px;
  line-height: 1.6;
  padding: 2px 8px;
  border-radius: 4px;
}
.view-hint { margin-top: 6px; font-size: 12px; color: var(--muted); line-height: 1.5; }
.mark-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--muted);
}
.mark-legend .lg { display: inline-flex; align-items: center; gap: 6px; }
.mark-legend .lg::before {
  content: '';
  width: 12px;
  height: 12px;
  border-radius: 2px;
  box-sizing: border-box;
}
.mark-legend .lg-real::before { border: 2px solid var(--red); }
.mark-legend .lg-benign::before { border: 2px dashed #868e96; }
@media (max-width: 720px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
  .brief {
    grid-template-columns: 22px minmax(0, 1fr);
    row-gap: 6px;
  }
  .brief-meta { grid-column: 2; align-items: flex-start; }
  .brief-link { grid-column: 2; justify-self: start; }
}
`;
}

export function customerReportClientJs(): string {
  return `
function switchCustomerTab(name) {
  document.querySelectorAll('.tab').forEach(function (el) {
    el.classList.toggle('active', el.getAttribute('data-tab') === name);
  });
  document.querySelectorAll('.panel').forEach(function (el) {
    el.classList.toggle('active', el.id === 'panel-' + name);
  });
}
/** 速览清单 -> 对比明细：切 Tab、滚到对应证据卡并短暂高亮 */
function openCustomerIssue(anchorId) {
  switchCustomerTab('regress');
  var target = document.getElementById(anchorId);
  if (!target) return;
  initSliders(target);
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.classList.add('ig-flash');
  setTimeout(function () { target.classList.remove('ig-flash'); }, 1600);
}
function initSliders(root) {
  (root || document).querySelectorAll('.slider-compare').forEach(function (box) {
    var range = box.querySelector('.slider-range');
    var clip = box.querySelector('.slider-after-clip');
    var line = box.querySelector('.slider-handle-line');
    var after = box.querySelector('.slider-after');
    if (!range || !clip) return;
    function apply(v) {
      var pct = Math.max(0, Math.min(100, Number(v) || 0));
      clip.style.width = pct + '%';
      if (line) line.style.left = pct + '%';
      if (after) after.style.width = (pct <= 0 ? 100 : (10000 / pct)) + '%';
    }
    range.addEventListener('input', function () { apply(range.value); });
    apply(range.value);
  });
}
function initViewButtons(root) {
  (root || document).querySelectorAll('.browser-card').forEach(function (card) {
    card.querySelectorAll('.view-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var view = btn.getAttribute('data-view');
        card.querySelectorAll('.view-btn').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
        card.querySelectorAll('.diff-view-panel').forEach(function (p) {
          p.classList.toggle('active', p.getAttribute('data-view') === view);
        });
      });
    });
  });
}
document.addEventListener('DOMContentLoaded', function () {
  initSliders(document);
  initViewButtons(document);
  // details 展开后其中的图片才有布局尺寸，滑块需要重新对齐
  document.querySelectorAll('details').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) initSliders(d);
    });
  });
});
`;
}
