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
.coverage-bar {
  margin-top: 14px;
  padding: 12px 14px;
  background: #f8f9fb;
  border-radius: 8px;
}
.coverage-bar.coverage-low .cov-fill { background: var(--red); }
.coverage-bar.coverage-mid .cov-fill { background: var(--amber); }
.coverage-bar.coverage-ok .cov-fill { background: var(--green); }
.cov-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 12px;
  margin-bottom: 8px;
  font-size: 13px;
}
.cov-label { font-weight: 650; }
.cov-pct { font-weight: 700; font-variant-numeric: tabular-nums; }
.cov-detail { color: var(--muted); font-size: 12px; }
.cov-track {
  height: 8px;
  background: #e9ecef;
  border-radius: 999px;
  overflow: hidden;
}
.cov-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--green);
  transition: width 0.3s ease;
}
.cov-note {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  color: var(--muted);
}
.cov-note.warn { color: #e67700; font-weight: 500; }
.trend-hint {
  margin-top: 8px;
  font-size: 12px;
  color: #a37200;
}
.action-box {
  background: var(--card);
  border: 1px solid var(--line);
  border-left: 4px solid var(--blue);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 16px;
}
.action-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 650;
}
.action-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--text);
}
.action-list li { margin: 4px 0; }
.reading-guide {
  margin-bottom: 14px;
  background: #f8f9fb;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
  color: var(--muted);
}
.reading-guide > summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--text);
}
.reading-guide[open] > summary { margin-bottom: 8px; }
.reading-guide ol {
  margin: 0;
  padding-left: 20px;
}
.reading-guide li { margin: 4px 0; }
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
  grid-template-columns: 88px 28px minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
  border-left: 3px solid transparent;
}
.brief-thumb {
  position: relative;
  width: 88px;
  height: 50px;
  border-radius: 6px;
  overflow: hidden;
  background: #f1f3f5;
  line-height: 0;
  grid-row: span 2;
}
.brief-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.brief-thumb .mark-box { border-width: 1px; }
.brief-thumb .mark-tag { font-size: 8px; padding: 0 2px; }
.brief-thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--muted);
  grid-row: span 2;
}
.brief-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 2px;
}
.brief-priority {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  line-height: 1.4;
}
.brief-priority.p0 { background: #ffe3e3; color: #c92a2a; }
.brief-priority.p1 { background: #fff3bf; color: #a37200; }
.brief-nature {
  display: inline-block;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #f1f3f5;
  color: var(--muted);
}
.brief-flow {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--muted);
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
.scope-table td.st-empty { color: var(--muted); }
.run-marker {
  font-size: 11px;
  background: #f1f3f5;
  padding: 1px 4px;
  border-radius: 3px;
  word-break: break-all;
}
.run-id-copy {
  border: none;
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: left;
}
.run-id-copy:hover { background: #e9ecef; }
.run-marker.run-id-copy.copied { background: #d3f9d8; color: #2b8a3e; }
.run-index-copy {
  border: none;
  background: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.run-index-copy:hover { color: #1971c2; }
.run-index-copy.copied { color: #2b8a3e; }
.ig-run-id {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  max-width: 100%;
}
.ig-run-id .run-marker { max-width: min(320px, 100%); }
.scope-table td.st-uncovered { color: var(--muted); }
.scope-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 14px;
}
.scope-filter-label { font-size: 13px; color: var(--muted); }
.scope-filter {
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.scope-filter.active {
  background: #1b2a4a;
  border-color: #1b2a4a;
  color: #fff;
}
.scope-group { margin-bottom: 18px; }
.scope-group-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 650;
}
.scope-group-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
}
.region-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  font-size: 12px;
  color: var(--muted);
}
.region-list li { margin: 3px 0; }
.region-list .rl-no {
  display: inline-block;
  width: 16px;
  font-weight: 650;
  color: var(--text);
}
.run-history-block { margin-bottom: 20px; }
.run-history-layout {
  display: flex;
  align-items: flex-start;
  gap: 28px;
}
.run-history-main { flex: 1; min-width: 0; }
.run-history-env-group {
  scroll-margin-top: 20px;
  margin-bottom: 28px;
}
.run-history-env-group:last-child { margin-bottom: 0; }
.run-history-env-title {
  margin: 0 0 14px;
  padding-bottom: 8px;
  font-size: 18px;
  font-weight: 650;
  border-bottom: 1px solid var(--line);
}
.run-history-anchor {
  flex: 0 0 108px;
  position: sticky;
  top: 16px;
  align-self: flex-start;
}
.run-history-anchor-nav {
  border-left: 2px solid #f0f0f0;
  padding-left: 0;
}
.run-history-anchor-link {
  display: block;
  margin-left: -2px;
  padding: 4px 0 4px 12px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(0, 0, 0, 0.45);
  text-decoration: none;
  border-left: 2px solid transparent;
}
.run-history-anchor-link:hover { color: #1677ff; }
.run-history-anchor-link.active {
  color: #1677ff;
  border-left-color: #1677ff;
}
.run-history-title { font-size: 15px; font-weight: 650; margin: 0 0 6px; }
.run-history-meta { margin: 0 0 10px; font-size: 12px; color: var(--muted); }
.run-history-table { margin-bottom: 0; }
.run-history-shots-row td {
  padding: 0 0 12px;
  border-bottom: 1px solid var(--line);
  background: #fafbfc;
}
.run-history-shot-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 12px 4px;
}
.run-history-shot {
  margin: 0;
  width: 132px;
}
.run-history-shot-img {
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
  background: #fff;
  aspect-ratio: 16 / 10;
}
.run-history-shot-img img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top left;
}
.run-history-shot figcaption {
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-history-shot.shot-minor .run-history-shot-img { border-color: #ffd8a8; }
.run-history-shot.shot-regress .run-history-shot-img { border-color: #ffc9c9; }
.run-history-shot.shot-pass .run-history-shot-img { border-color: #b2f2bb; }
.run-history-shot-empty {
  padding: 8px 12px 4px;
  font-size: 12px;
  color: var(--muted);
}
.run-history-compare {
  padding: 10px 12px 4px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.run-history-compare .page-card {
  margin: 0;
}
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
.incomplete-notice {
  margin: 16px 0;
  padding: 12px 14px;
  border: 1px solid #ffe8cc;
  border-radius: 8px;
  background: #fff9db;
}
.incomplete-notice-title { font-weight: 650; margin-bottom: 6px; color: #e67700; }
.incomplete-notice ul { margin: 0; padding-left: 18px; }
.incomplete-notice-meta { margin: 8px 0 0; font-size: 12px; color: #868e96; }
.env-breakdown { margin: 20px 0; }
.env-table { margin-top: 8px; }
.env-bad { color: #e03131; font-weight: 600; }
.env-watch { color: #f08c00; font-weight: 600; }
.env-ok { color: #2f9e44; font-weight: 600; }
.shot-count-cell { white-space: nowrap; }
.shot-pruned-tag {
  margin-left: 4px;
  font-size: 11px;
  color: #868e96;
  font-weight: 500;
}
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
.side-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  align-items: start;
}
.side-col { min-width: 0; }
.side-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 4px;
  text-align: center;
}
.side-snap {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: var(--text);
  margin-top: 2px;
}
.pair-warn {
  margin-bottom: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fff9db;
  border: 1px solid #ffe066;
  font-size: 12px;
  color: #a37200;
  line-height: 1.5;
}
.side-img-wrap {
  border-radius: 6px;
  overflow: hidden;
  background: #f1f3f5;
  line-height: 0;
}
.side-img-wrap img {
  width: 100%;
  display: block;
}
@media (max-width: 720px) {
  .side-grid { grid-template-columns: 1fr; }
}
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
.fb-annotate-btn {
  margin-left: auto;
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  color: var(--text);
  cursor: pointer;
}
.fb-annotate-btn:hover { border-color: var(--blue); color: var(--blue); }
.fb-annotate-btn.submitting { opacity: 0.65; cursor: wait; }
.fb-annotate-btn.done { border-color: #2b8a3e; color: #2b8a3e; background: #ebfbee; }
.fb-annotate-btn:disabled { cursor: not-allowed; }
.bc-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fb-shot-wrap { position: relative; }
.fb-shot-wrap img,
.brief-thumb img,
.run-history-shot-img img,
.overlay-img {
  cursor: zoom-in;
}
.shot-lightbox {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.86);
  display: none;
  align-items: center;
  justify-content: center;
  padding: 48px 72px;
}
.shot-lightbox.open { display: flex; }
.shot-lb-inner {
  position: relative;
  max-width: 96vw;
  max-height: 88vh;
  line-height: 0;
}
.shot-lb-inner img {
  max-width: 96vw;
  max-height: 88vh;
  display: block;
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
}
.shot-lb-inner .shot-lb-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.shot-lb-inner .shot-lb-overlay .mark-box { pointer-events: none; }
.shot-lb-close,
.shot-lb-prev,
.shot-lb-next {
  position: fixed;
  border: none;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  cursor: pointer;
  line-height: 1;
  transition: background 0.15s;
}
.shot-lb-close:hover,
.shot-lb-prev:hover,
.shot-lb-next:hover { background: rgba(255, 255, 255, 0.28); }
.shot-lb-close {
  top: 16px;
  right: 20px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  font-size: 22px;
}
.shot-lb-prev,
.shot-lb-next {
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 64px;
  border-radius: 8px;
  font-size: 28px;
}
.shot-lb-prev { left: 16px; }
.shot-lb-next { right: 16px; }
.shot-lb-prev:disabled,
.shot-lb-next:disabled {
  opacity: 0.35;
  cursor: default;
}
.shot-lb-cap {
  position: fixed;
  bottom: 44px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.82);
  font-size: 13px;
  max-width: 80vw;
  text-align: center;
  word-break: break-word;
  line-height: 1.45;
}
.shot-lb-counter {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 720px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
  .brief {
    grid-template-columns: 72px 22px minmax(0, 1fr);
    row-gap: 6px;
  }
  .brief-thumb { width: 72px; height: 42px; }
  .brief-meta { grid-column: 3; align-items: flex-start; }
  .brief-link { grid-column: 3; justify-self: start; }
  .shot-lightbox { padding: 40px 12px; }
  .shot-lb-prev { left: 4px; width: 36px; }
  .shot-lb-next { right: 4px; width: 36px; }
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
  if (name === 'runs' || name === 'minor') {
    var panel = document.getElementById('panel-' + name);
    if (panel) {
      initRunHistoryAnchor(panel);
      initRunIdCopy(panel);
      initShotPreview(panel);
    }
  }
}
function initRunHistoryAnchor(root) {
  var scope = root || document;
  var links = scope.querySelectorAll('.run-history-anchor-link');
  if (!links.length) return;
  var groups = scope.querySelectorAll('.run-history-env-group');
  function setActive(id) {
    links.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-env-anchor') === id);
    });
  }
  links.forEach(function (a) {
    if (a.dataset.anchorInit) return;
    a.dataset.anchorInit = '1';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var id = a.getAttribute('data-env-anchor');
      var el = id && document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActive(id);
      if (history.replaceState) history.replaceState(null, '', '#' + id);
    });
  });
  if ('IntersectionObserver' in window && groups.length) {
    var io = new IntersectionObserver(function (entries) {
      var visible = entries.filter(function (e) { return e.isIntersecting; })
        .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });
      if (visible.length) setActive(visible[0].target.id);
    }, { rootMargin: '-12% 0px -55% 0px', threshold: 0 });
    groups.forEach(function (g) { io.observe(g); });
  } else if (groups.length) {
    setActive(groups[0].id);
  }
}
function filterScopeStatus(status) {
  document.querySelectorAll('.scope-filter').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-scope-filter') === status);
  });
  document.querySelectorAll('.scope-table tbody tr').forEach(function (row) {
    var st = row.getAttribute('data-status');
    row.style.display = status === 'all' || st === status ? '' : 'none';
  });
  document.querySelectorAll('.scope-group').forEach(function (group) {
    var visible = group.querySelectorAll('tbody tr:not([style*="display: none"])').length;
    var hidden = group.querySelectorAll('tbody tr[style*="display: none"]').length;
    var rows = group.querySelectorAll('tbody tr');
    var any = false;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].style.display !== 'none') { any = true; break; }
    }
    group.style.display = any ? '' : 'none';
  });
}
/** 速览清单 -> 对比明细：切 Tab、滚到对应证据卡并短暂高亮 */
function openCustomerIssue(anchorId) {
  switchCustomerTab('regress');
  var target = document.getElementById(anchorId);
  if (!target) return;
  initSliders(target);
  initShotPreview(target);
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
function copyReportText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
  return Promise.resolve();
}
function initRunIdCopy(root) {
  (root || document).querySelectorAll('.run-id-copy').forEach(function (btn) {
    if (btn.dataset.copyInit) return;
    btn.dataset.copyInit = '1';
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy') || btn.textContent || '';
      text = text.trim();
      if (!text) return;
      copyReportText(text).then(function () {
        btn.classList.add('copied');
        var prev = btn.getAttribute('title');
        btn.setAttribute('title', '已复制');
        setTimeout(function () {
          btn.classList.remove('copied');
          if (prev != null) btn.setAttribute('title', prev);
        }, 1200);
      });
    });
  });
}
document.addEventListener('DOMContentLoaded', function () {
  initSliders(document);
  initViewButtons(document);
  initRunIdCopy(document);
  initRunHistoryAnchor(document);
  initFeedbackAnnotate();
  initShotPreview(document);
  document.querySelectorAll('details').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) {
        initSliders(d);
        initShotPreview(d);
      }
    });
  });
});

function studioApiBase() {
  if (window.STUDIO_API_BASE) return window.STUDIO_API_BASE;
  if (location.protocol === 'file:') return 'http://localhost:3001';
  return location.origin;
}

function buildFeedbackDescription(card) {
  return (card.getAttribute('data-feedback-desc') || '').trim() || '发现页面变化';
}

var fbSubmitting = false;
var FB_REPORTER_DEFAULT = '机器人';

function setAnnotateBtnState(btn, state) {
  if (!btn) return;
  btn.classList.remove('submitting', 'done');
  if (state === 'submitting') {
    btn.classList.add('submitting');
    btn.textContent = '登记中…';
    btn.disabled = true;
  } else if (state === 'done') {
    btn.classList.add('done');
    btn.textContent = '已登记';
    btn.disabled = true;
  } else {
    btn.textContent = '登记问题';
    btn.title = '登记本条对比问题';
    btn.disabled = false;
  }
}

function submitFeedback(card) {
  if (fbSubmitting) return;
  var btn = card.querySelector('.fb-annotate-btn');
  fbSubmitting = true;
  setAnnotateBtnState(btn, 'submitting');
  var payload = {
    reporter: FB_REPORTER_DEFAULT,
    description: buildFeedbackDescription(card),
    scriptKey: card.getAttribute('data-script-key') || '',
    stepName: card.getAttribute('data-step-name') || '',
    stepNumber: Number(card.getAttribute('data-step-number') || 0) || undefined,
    screenshotPath: card.getAttribute('data-screenshot') || ''
  };
  fetch(studioApiBase() + '/api/manual-feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function (r) {
    return r.json().then(function (data) {
      if (!r.ok || !data.ok) throw new Error((data && data.error) || ('HTTP ' + r.status));
      return data;
    });
  }).then(function () {
    fbSubmitting = false;
    setAnnotateBtnState(btn, 'done');
    setTimeout(function () { setAnnotateBtnState(btn, 'idle'); }, 2000);
  }).catch(function (e) {
    fbSubmitting = false;
    setAnnotateBtnState(btn, 'idle');
    alert('登记失败（请确认通过 Studio 打开报告且 npm run studio 已启动）: ' + (e.message || e));
  });
}

function initFeedbackAnnotate() {
  if (document.body.dataset.fbInit === '1') return;
  document.body.dataset.fbInit = '1';

  document.querySelectorAll('.fb-annotate-btn').forEach(function (btn) {
    if (btn.dataset.fbBtnInit === '1') return;
    btn.dataset.fbBtnInit = '1';
    btn.addEventListener('click', function () {
      var card = btn.closest('.browser-card');
      if (!card || fbSubmitting) return;
      submitFeedback(card);
    });
  });
}

var shotPreviewState = { shots: [], index: -1, inited: false };

function buildShotCaption(img) {
  var parts = [];
  var seen = {};
  function push(text) {
    var t = String(text || '').replace(/\\s+/g, ' ').trim();
    if (!t || seen[t]) return;
    seen[t] = 1;
    parts.push(t);
  }
  var issue = img.closest('.issue-group');
  if (issue) push((issue.querySelector('.ig-title') || {}).textContent);
  var page = img.closest('.page-card');
  if (page) push(((page.querySelector('.page-title') || {}).textContent || '').replace(/过程截图/g, ''));
  var bc = img.closest('.browser-card');
  if (bc) push((bc.querySelector('.bc-head strong') || {}).textContent);
  var brief = img.closest('.brief');
  if (brief) push((brief.querySelector('.brief-title') || {}).textContent);
  var fig = img.closest('.run-history-shot');
  if (fig) push((fig.querySelector('figcaption') || {}).textContent);
  var sideCol = img.closest('.side-col');
  if (sideCol) push((sideCol.querySelector('.side-label') || {}).textContent);
  push(img.getAttribute('alt'));
  return parts.join(' · ');
}

function collectPreviewShots() {
  var shots = [];
  document.querySelectorAll('.brief-thumb img, .fb-shot-wrap img, .run-history-shot-img img').forEach(function (img) {
    var src = img.currentSrc || img.src;
    if (!src) return;
    shots.push({
      img: img,
      src: src,
      caption: buildShotCaption(img),
      markWrap: img.closest('.mark-wrap, .brief-thumb')
    });
  });
  return shots;
}

function ensureShotLightbox() {
  if (document.getElementById('shot-lightbox')) return;
  var lb = document.createElement('div');
  lb.id = 'shot-lightbox';
  lb.className = 'shot-lightbox';
  lb.setAttribute('aria-hidden', 'true');
  lb.innerHTML = ''
    + '<button type="button" class="shot-lb-close" aria-label="关闭">×</button>'
    + '<button type="button" class="shot-lb-prev" aria-label="上一张">‹</button>'
    + '<button type="button" class="shot-lb-next" aria-label="下一张">›</button>'
    + '<div class="shot-lb-inner">'
    + '  <img id="shot-lb-img" alt="" />'
    + '  <div id="shot-lb-overlay" class="shot-lb-overlay"></div>'
    + '</div>'
    + '<div id="shot-lb-cap" class="shot-lb-cap"></div>'
    + '<div id="shot-lb-counter" class="shot-lb-counter"></div>';
  document.body.appendChild(lb);

  lb.querySelector('.shot-lb-close').addEventListener('click', closeShotPreview);
  lb.querySelector('.shot-lb-prev').addEventListener('click', function () { stepShotPreview(-1); });
  lb.querySelector('.shot-lb-next').addEventListener('click', function () { stepShotPreview(1); });
  lb.addEventListener('click', function (e) {
    if (e.target === lb) closeShotPreview();
  });
  document.addEventListener('keydown', onShotPreviewKeydown);
}

function onShotPreviewKeydown(e) {
  var lb = document.getElementById('shot-lightbox');
  if (!lb || !lb.classList.contains('open')) return;
  if (e.key === 'Escape') closeShotPreview();
  else if (e.key === 'ArrowLeft') stepShotPreview(-1);
  else if (e.key === 'ArrowRight') stepShotPreview(1);
}

function renderShotPreviewAt(index) {
  var shots = shotPreviewState.shots;
  if (!shots.length || index < 0 || index >= shots.length) return;
  shotPreviewState.index = index;
  var shot = shots[index];
  var lb = document.getElementById('shot-lightbox');
  var lbImg = document.getElementById('shot-lb-img');
  var lbOverlay = document.getElementById('shot-lb-overlay');
  var lbCap = document.getElementById('shot-lb-cap');
  var lbCounter = document.getElementById('shot-lb-counter');
  if (!lb || !lbImg || !lbOverlay) return;

  lbImg.src = shot.src;
  lbImg.alt = shot.caption || '';
  lbOverlay.innerHTML = '';
  if (shot.markWrap) {
    shot.markWrap.querySelectorAll('.mark-box').forEach(function (box) {
      lbOverlay.appendChild(box.cloneNode(true));
    });
  }
  if (lbCap) lbCap.textContent = shot.caption || '';
  if (lbCounter) lbCounter.textContent = (index + 1) + ' / ' + shots.length;

  var prevBtn = lb.querySelector('.shot-lb-prev');
  var nextBtn = lb.querySelector('.shot-lb-next');
  if (prevBtn) prevBtn.disabled = index <= 0;
  if (nextBtn) nextBtn.disabled = index >= shots.length - 1;

  lb.classList.add('open');
  lb.setAttribute('aria-hidden', 'false');
}

function openShotPreview(img) {
  ensureShotLightbox();
  shotPreviewState.shots = collectPreviewShots();
  var idx = -1;
  for (var i = 0; i < shotPreviewState.shots.length; i++) {
    if (shotPreviewState.shots[i].img === img) { idx = i; break; }
  }
  if (idx < 0) return;
  renderShotPreviewAt(idx);
}

function stepShotPreview(delta) {
  var next = shotPreviewState.index + delta;
  if (next < 0 || next >= shotPreviewState.shots.length) return;
  renderShotPreviewAt(next);
}

function closeShotPreview() {
  var lb = document.getElementById('shot-lightbox');
  if (!lb) return;
  lb.classList.remove('open');
  lb.setAttribute('aria-hidden', 'true');
  var lbImg = document.getElementById('shot-lb-img');
  var lbOverlay = document.getElementById('shot-lb-overlay');
  var lbCap = document.getElementById('shot-lb-cap');
  var lbCounter = document.getElementById('shot-lb-counter');
  if (lbImg) lbImg.removeAttribute('src');
  if (lbOverlay) lbOverlay.innerHTML = '';
  if (lbCap) lbCap.textContent = '';
  if (lbCounter) lbCounter.textContent = '';
  shotPreviewState.index = -1;
}

function initShotPreview(root) {
  ensureShotLightbox();
  var scope = root || document;
  scope.querySelectorAll('.brief-thumb img, .fb-shot-wrap img, .run-history-shot-img img').forEach(function (img) {
    if (img.dataset.previewInit === '1') return;
    img.dataset.previewInit = '1';
    img.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openShotPreview(img);
    });
  });
}
`;
}
