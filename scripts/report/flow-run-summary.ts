#!/usr/bin/env tsx
/**
 * 申请单 / 审批流程运行汇总报告（时间点、接口报错、报告链接）。
 */
import fs from 'fs';
import path from 'path';
import {
  flowLabel,
  flowRunsDir,
  readApiFailures,
  readLastRun,
  type FlowId,
  type FlowRunManifest,
} from '../../src/utils/flow-run-report.js';

const FLOW_IDS: FlowId[] = ['request-flow', 'approval-flow'];
const DEFAULT_OUT = 'results/flow-run-summary.html';

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false });
}

function loadHistory(flowId: FlowId, limit = 20): FlowRunManifest[] {
  const dir = path.join(flowRunsDir(flowId), 'history');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const rows: FlowRunManifest[] = [];
  for (const f of files) {
    try {
      const batch = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as FlowRunManifest[];
      rows.push(...batch);
    } catch {
      /* ignore */
    }
  }
  return rows
    .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime())
    .slice(0, limit);
}

function apiFailureCount(flowId: FlowId, runId: string): number {
  return readApiFailures(flowId, runId).reduce((n, e) => n + e.failures.length, 0);
}

function reportHref(rel?: string): string {
  if (!rel) return '';
  return `/repo-report/${rel.replace(/^\/+/, '')}`;
}

function aiBtn(flowId: FlowId, run: FlowRunManifest): string {
  if (!run.runId) return '';
  return `<button type="button" class="ai-btn" data-flow-id="${esc(flowId)}" data-run-id="${esc(run.runId)}" title="复制排查包给 AI" onclick="copyFlowRunAiDebug(this)">AI 排查</button>`;
}

function fmtPassTotal(run: FlowRunManifest): string {
  const passed = run.passed ?? 0;
  const total = run.total ?? 0;
  const skipped = run.skipped ?? 0;
  if (!skipped) return `${passed}/${total}`;
  return `${passed}/${total}（跳过 ${skipped}）`;
}

function buildSkipSections(runs: Array<{ id: FlowId; run: FlowRunManifest }>): string {
  return runs
    .map(({ id, run }) => {
      const items = run.skips || [];
      if (!items.length) return '';
      const rows = items
        .map(
          (s) =>
            `<tr><td>${esc(s.title || '未命名用例')}</td><td>${esc(s.reason || '已跳过（未记录原因）')}</td></tr>`,
        )
        .join('');
      return `<h2>${esc(flowLabel(id))} · 跳过用例</h2>
<table><thead><tr><th>用例</th><th>原因</th></tr></thead><tbody>${rows}</tbody></table>`;
    })
    .filter(Boolean)
    .join('\n');
}

function buildHtml(generatedAt: string): string {
  const lastRuns = FLOW_IDS.map((id) => ({ id, run: readLastRun(id) }));
  const historyEntries = FLOW_IDS.flatMap((id) => loadHistory(id, 50).map((run) => ({ id, run })))
    .sort((a, b) => new Date(b.run.startedAt || 0).getTime() - new Date(a.run.startedAt || 0).getTime())
    .slice(0, 20);

  const cards = lastRuns
    .map(({ id, run }) => {
      if (!run) {
        return `<div class="card"><h3>${esc(flowLabel(id))}</h3><p class="muted">暂无运行记录</p></div>`;
      }
      const apiN = apiFailureCount(id, run.runId);
      const passN = Number(run.passed) || 0;
      const totalN = Number(run.total) || 0;
      const skipN = Number(run.skipped) || 0;
      const status =
        run.ok === false ? 'fail' : passN === totalN && totalN > 0 ? 'ok' : totalN > 0 ? 'fail' : 'unk';
      const resultLabel =
        run.ok === false
          ? '失败'
          : passN === totalN && totalN > 0
            ? '通过'
            : skipN === totalN && totalN > 0
              ? '全部跳过'
              : totalN > 0
                ? '未完成'
                : '未知';
      const links = [
        run.playwrightReportRel ? `<a href="${esc(reportHref(run.playwrightReportRel))}" target="_blank">Playwright 报告</a>` : '',
        run.replayReportRel ? `<a href="${esc(reportHref(run.replayReportRel))}" target="_blank">步骤回放</a>` : '',
        run.compareReportRel ? `<a href="${esc(reportHref(run.compareReportRel))}" target="_blank">截图对比</a>` : '',
        run.customerReportRel ? `<a href="${esc(reportHref(run.customerReportRel))}" target="_blank">客户报告</a>` : '',
        aiBtn(id, run),
      ]
        .filter(Boolean)
        .join(' · ');
      return `<div class="card ${status}">
<h3>${esc(run.flowLabel || flowLabel(id))}</h3>
<ul>
<li>开始：${esc(fmtTime(run.startedAt))}</li>
<li>结束：${esc(fmtTime(run.finishedAt))}</li>
<li>环境：${esc(run.env)} · ${esc(run.spec)}</li>
<li>结果：${esc(resultLabel)}（${esc(fmtPassTotal(run))}，${run.durationSec ?? '-'}s）</li>
<li>跳过：${skipN} 条</li>
<li>接口报错：${apiN} 条</li>
<li>Trace：${esc(run.traceMode || 'on-first-retry')}</li>
</ul>
${links ? `<p class="links">${links}</p>` : ''}
</div>`;
    })
    .join('\n');

  const historyRows = historyEntries
    .map(({ id, run: r }) => {
      const apiN = apiFailureCount(id, r.runId);
      const cls = r.ok === true ? 'ok' : r.ok === false ? 'fail' : 'unk';
      return `<tr class="${cls}">
<td>${esc(flowLabel(id))}</td>
<td>${esc(fmtTime(r.startedAt))}</td>
<td>${esc(fmtTime(r.finishedAt))}</td>
<td>${esc(r.env)}</td>
<td>${r.ok ? '通过' : r.ok === false ? '失败' : '-'}</td>
<td>${esc(fmtPassTotal(r))}</td>
<td>${(r.skipped ?? 0) || '-'}</td>
<td>${apiN || '-'}</td>
<td>${esc(r.spec)}</td>
<td>${aiBtn(id, r)}</td>
</tr>`;
    })
    .join('\n');

  const apiSections = lastRuns
    .map(({ id, run }) => {
      if (!run) return '';
      const entries = readApiFailures(id, run.runId);
      if (!entries.length) return '';
      const rows = entries
        .flatMap((e) =>
          e.failures.map(
            (f) =>
              `<tr><td>${esc(e.testTitle)}</td><td>${esc(f.kind)}</td><td>${esc(f.method)} ${esc(f.url)}</td><td>${f.status ?? '-'}</td><td>${esc(f.bodySummary || f.errorText || '')}</td></tr>`,
          ),
        )
        .join('');
      return `<h2>${esc(flowLabel(id))} · 接口报错</h2>
<table><thead><tr><th>用例</th><th>类型</th><th>接口</th><th>状态</th><th>摘要</th></tr></thead><tbody>${rows}</tbody></table>`;
    })
    .filter(Boolean)
    .join('\n');

  const skipSections = buildSkipSections(lastRuns.filter((x) => x.run) as Array<{ id: FlowId; run: FlowRunManifest }>);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>业务流程运行汇总</title>
<style>
body{font-family:ui-sans-serif,system-ui,sans-serif;margin:24px;color:#1a1a1a;background:#f7f8fa;line-height:1.6}
h1{font-size:22px;margin:0 0 8px}
.meta{color:#666;font-size:13px;margin-bottom:20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:24px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px}
.card.ok{border-color:#86efac}
.card.fail{border-color:#fca5a5}
.card h3{margin:0 0 8px;font-size:16px}
.card ul{margin:0;padding-left:18px;font-size:13px}
.links{font-size:13px;margin:10px 0 0}
.links a{color:#2563eb}
.links .ai-btn{margin-left:4px}
.ai-btn{font-size:12px;line-height:1.4;padding:2px 8px;border:1px solid #c4b5fd;border-radius:6px;background:#f5f3ff;color:#6d28d9;cursor:pointer}
.ai-btn:hover{background:#ede9fe}
.ai-btn:disabled{opacity:.55;cursor:wait}
.ai-toast{position:fixed;right:20px;bottom:20px;z-index:9999;padding:10px 14px;border-radius:8px;background:#111827;color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.18);opacity:0;transform:translateY(8px);transition:.2s ease}
.ai-toast.show{opacity:1;transform:translateY(0)}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:13px;margin-bottom:24px}
th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
th{background:#f3f4f6}
tr.ok td:nth-child(5){color:#15803d}
tr.fail td:nth-child(5){color:#b91c1c}
h2{font-size:16px;margin:24px 0 10px}
.muted{color:#6b7280}
</style>
</head>
<body>
<h1>业务流程运行汇总</h1>
<div class="meta">生成时间：${esc(generatedAt)} · 含申请单流程与审批流程 · 其他回归用例不在此报告</div>
<div class="cards">${cards}</div>
<h2>运行历史</h2>
<table>
<thead><tr><th>流程</th><th>开始</th><th>结束</th><th>环境</th><th>结果</th><th>通过/总数</th><th>跳过</th><th>接口报错</th><th>用例</th><th>AI 排查</th></tr></thead>
<tbody>${historyRows || '<tr><td colspan="10">暂无历史</td></tr>'}</tbody>
</table>
${skipSections || ''}
${apiSections || '<p class="muted">最近一次运行无接口报错记录。</p>'}
<p class="muted">回放/trace：默认 on-first-retry；设置 FLOW_TRACE=retain-on-failure 可保留失败 trace。点击「AI 排查」可复制该次运行的排查包，粘贴给 Cursor / ChatGPT 排查脚本。</p>
<div id="aiToast" class="ai-toast" role="status" aria-live="polite"></div>
<script>
function showAiToast(msg, ok) {
  var el = document.getElementById('aiToast');
  if (!el) return;
  el.textContent = msg;
  el.style.background = ok === false ? '#b91c1c' : '#111827';
  el.classList.add('show');
  clearTimeout(showAiToast._t);
  showAiToast._t = setTimeout(function () { el.classList.remove('show'); }, 2400);
}
async function copyFlowRunAiDebug(btn) {
  if (!btn || btn.disabled) return;
  var flowId = btn.getAttribute('data-flow-id');
  var runId = btn.getAttribute('data-run-id');
  if (!flowId || !runId) {
    showAiToast('缺少 run 标识', false);
    return;
  }
  var label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    var res = await fetch('/api/flow-run/ai-debug?flowId=' + encodeURIComponent(flowId) + '&runId=' + encodeURIComponent(runId));
    var data = await res.json();
    if (!res.ok || !data.ok || !data.markdown) {
      throw new Error((data && data.error) || ('HTTP ' + res.status));
    }
    await navigator.clipboard.writeText(data.markdown);
    showAiToast('已复制排查包');
  } catch (e) {
    showAiToast('复制失败: ' + (e && e.message ? e.message : String(e)), false);
  } finally {
    btn.disabled = false;
    btn.textContent = label || 'AI 排查';
  }
}
</script>
</body>
</html>`;
}

function main(): void {
  const args = process.argv.slice(2);
  const out = args.find((a) => a.startsWith('--out='))?.slice('--out='.length) || DEFAULT_OUT;
  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false });
  const html = buildHtml(generatedAt);
  const abs = path.resolve(out);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, html, 'utf-8');
  console.log(`✅ 流程运行汇总: ${out}`);
}

main();
