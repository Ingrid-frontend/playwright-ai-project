#!/usr/bin/env tsx
/**
 * 流程调试汇总报告：汇总 full-flow / travel-submit 等非 Golden 回归的运行与步骤截图。
 */
import fs from 'fs';
import path from 'path';
import {
  flowLabel,
  flowRunsDir,
  readApiFailures,
  readFlowRunProgress,
  type FlowId,
  type FlowRunManifest,
} from '../../src/utils/flow-run-report.js';
import { discoverProbeFlowScanTargets, RUN_SEGMENT_DIR } from './compare-screenshots-scan.js';
import {
  friendlyScriptLabel,
  friendlyStepLabel,
} from './customer-report-naming.js';
import {
  listRunIdsFromScreenshots,
  resolveRunScreenshotMeta,
} from './customer-report-run-meta.js';

const FLOW_ROOT = path.join('screenshots', 'flows');
const DEFAULT_OUT = 'results/flow-probe-report.html';
const FLOW_IDS: FlowId[] = ['request-flow', 'approval-flow'];

type ProbeManifest = FlowRunManifest & { pipeline?: string };

type StepShot = {
  file: string;
  rel: string;
  stepNum: number;
  label: string;
};

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

function reportHref(rel?: string): string {
  if (!rel) return '';
  return `/repo-report/${rel.replace(/^\/+/, '')}`;
}

function normalizeScriptKey(key: string): string {
  return String(key || '').replace(/\\/g, '/').replace(/^screenshots\//, '').replace(/^flows\//, '');
}

function scriptKeysMatch(a: string, b: string): boolean {
  return normalizeScriptKey(a) === normalizeScriptKey(b);
}

function isProbeManifest(m: ProbeManifest): boolean {
  if (m.pipeline === 'golden') return false;
  const spec = (m.spec || '').toLowerCase();
  if (spec.includes('golden-regression')) return false;
  return FLOW_IDS.includes(m.flowId);
}

function loadProbeManifests(): ProbeManifest[] {
  const rows: ProbeManifest[] = [];
  for (const flowId of FLOW_IDS) {
    const histDir = path.join(flowRunsDir(flowId), 'history');
    if (!fs.existsSync(histDir)) continue;
    for (const name of fs.readdirSync(histDir).filter((f) => f.endsWith('.json'))) {
      try {
        const batch = JSON.parse(fs.readFileSync(path.join(histDir, name), 'utf-8')) as ProbeManifest[];
        rows.push(...batch.filter(isProbeManifest));
      } catch {
        /* ignore */
      }
    }
    const lastPath = path.join(flowRunsDir(flowId), 'last-run.json');
    if (fs.existsSync(lastPath)) {
      try {
        const last = JSON.parse(fs.readFileSync(lastPath, 'utf-8')) as ProbeManifest;
        if (isProbeManifest(last)) rows.push(last);
      } catch {
        /* ignore */
      }
    }
  }
  const seen = new Set<string>();
  return rows
    .filter((m) => {
      const k = `${m.flowId}::${m.runId}`;
      if (!m.runId || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());
}

function findRunRoot(scriptPath: string): string {
  for (const name of fs.readdirSync(scriptPath).filter((f) => !f.startsWith('.'))) {
    const p = path.join(scriptPath, name);
    if (fs.statSync(p).isDirectory() && RUN_SEGMENT_DIR.test(name)) return p;
  }
  return '';
}

function listStepShots(scriptPath: string, runId: string, outAbs: string): StepShot[] {
  const runRoot = findRunRoot(scriptPath);
  if (!runRoot) return [];
  const runDir = path.join(runRoot, runId);
  if (!fs.existsSync(runDir)) return [];
  const outDir = path.dirname(outAbs);
  const shots: StepShot[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!name.endsWith('.png') || name.includes('-stuck')) continue;
      const m = name.match(/^step-(\d+)-(.+)\.png$/);
      if (!m) continue;
      const snap = m[2].replace(/__(normal|after|before|skipped)__.*$/, '').replace(/-before$|-after$|-skipped$/, '');
      shots.push({
        file: name,
        rel: path.relative(outDir, p).replace(/\\/g, '/'),
        stepNum: Number(m[1]),
        label: friendlyStepLabel(snap),
      });
    }
  };
  walk(runDir);
  return shots.sort((a, b) => a.stepNum - b.stepNum || a.file.localeCompare(b.file));
}

function resultLabel(m: ProbeManifest): string {
  const passed = m.passed ?? 0;
  const total = m.total ?? 0;
  const skipped = m.skipped ?? 0;
  if (m.ok === false) return '失败';
  if (passed === total && total > 0) return '通过';
  if (skipped === total && total > 0) return '全部跳过';
  if (total > 0) return '未完成';
  return '未知';
}

function buildManifestLinks(id: FlowId, m: ProbeManifest): string {
  const links = [
    m.replayReportRel ? `<a href="${esc(reportHref(m.replayReportRel))}" target="_blank">回放</a>` : '',
    m.playwrightReportRel ? `<a href="${esc(reportHref(m.playwrightReportRel))}" target="_blank">Playwright</a>` : '',
    m.uiAuditReportRel ? `<a href="${esc(reportHref(m.uiAuditReportRel))}" target="_blank">UI 审计</a>` : '',
    m.summaryReportRel ? `<a href="${esc(reportHref(m.summaryReportRel))}" target="_blank">运行汇总</a>` : '',
  ].filter(Boolean);
  return links.join(' · ');
}

function buildProgressBlock(id: FlowId, m: ProbeManifest, scriptPath: string): string {
  const runRoot = findRunRoot(scriptPath);
  const runDir = runRoot ? path.join(runRoot, m.runId) : '';
  const progress = readFlowRunProgress(runDir, id, m.runId);
  if (!progress) return '';
  const lines: string[] = [];
  if (progress.currentStep) {
    lines.push(`卡住/进行中：#${progress.currentStep.num} ${esc(progress.currentStep.name)}`);
  }
  if (progress.error) lines.push(`错误：${esc(progress.error)}`);
  if (progress.completedSteps?.length) {
    lines.push(`已完成 ${progress.completedSteps.length} 步`);
  }
  return lines.length ? `<p class="muted">${lines.join(' · ')}</p>` : '';
}

function buildScriptSection(
  testDir: string,
  scriptPath: string,
  manifests: ProbeManifest[],
  outAbs: string,
): string {
  const runIds = listRunIdsFromScreenshots(scriptPath);
  const latestRunId = runIds[runIds.length - 1] || '';
  const manifest = manifests.find((m) => scriptKeysMatch(m.scriptKey || '', testDir) && m.runId === latestRunId)
    || manifests.find((m) => scriptKeysMatch(m.scriptKey || '', testDir));
  const runId = manifest?.runId || latestRunId;
  const shotMeta = runId ? resolveRunScreenshotMeta(scriptPath, runId) : { count: 0, pruned: false };
  const shots = runId ? listStepShots(scriptPath, runId, outAbs) : [];

  const shotGrid = shots.length
    ? `<div class="shots">${shots
        .map(
          (s) =>
            `<figure><img src="${esc(s.rel)}" alt="${esc(s.label)}" loading="lazy"/><figcaption>#${s.stepNum} ${esc(s.label)}</figcaption></figure>`,
        )
        .join('')}</div>`
    : shotMeta.pruned
      ? '<p class="muted">截图已归档清理，见运行回放或 progress.json</p>'
      : '<p class="muted">暂无步骤截图（可能未全通过已被丢弃，或未跑 flowStep 用例）</p>';

  const meta = manifest
    ? `<ul class="meta-list">
<li>最近运行：${esc(fmtTime(manifest.startedAt))} → ${esc(fmtTime(manifest.finishedAt))}</li>
<li>结果：${esc(resultLabel(manifest))}（${manifest.passed ?? 0}/${manifest.total ?? 0}，${manifest.durationSec ?? '-'}s）</li>
<li>用例：<code>${esc(manifest.spec || '-')}</code> · 模式 ${esc(manifest.mode || '-')}</li>
<li>runId：<code>${esc(manifest.runId)}</code>${manifest.runMarker ? ` · 标记 <code>${esc(manifest.runMarker)}</code>` : ''}</li>
</ul>
${buildManifestLinks(manifest.flowId, manifest)}
${buildProgressBlock(manifest.flowId, manifest, scriptPath)}`
    : '<p class="muted">暂无 manifest 记录</p>';

  return `<section class="script-card">
<h2>${esc(friendlyScriptLabel(testDir.startsWith('flows/') ? testDir : `flows/${testDir}`))}</h2>
<p class="sub">${esc(testDir)} · 截图 ${shotMeta.count} 张${shotMeta.pruned ? '（已清理）' : ''}</p>
${meta}
${shotGrid}
</section>`;
}

function buildHistoryTable(manifests: ProbeManifest[]): string {
  const rows = manifests.slice(0, 40).map((m) => {
    const apiN = readApiFailures(m.flowId, m.runId).reduce((n, e) => n + e.failures.length, 0);
    const cls = m.ok === true ? 'ok' : m.ok === false ? 'fail' : 'unk';
    return `<tr class="${cls}">
<td>${esc(flowLabel(m.flowId))}</td>
<td>${esc(fmtTime(m.startedAt))}</td>
<td>${esc(resultLabel(m))}</td>
<td>${m.passed ?? 0}/${m.total ?? 0}</td>
<td>${m.skipped ?? 0}</td>
<td>${apiN || '-'}</td>
<td><code>${esc(m.spec || '')}</code></td>
<td><code>${esc(m.runMarker || m.runId)}</code></td>
<td>${buildManifestLinks(m.flowId, m)}</td>
</tr>`;
  });
  return `<table>
<thead><tr><th>流程</th><th>开始</th><th>结果</th><th>通过/总数</th><th>跳过</th><th>接口报错</th><th>用例</th><th>标记</th><th>链接</th></tr></thead>
<tbody>${rows.join('') || '<tr><td colspan="9">暂无流程调试运行记录</td></tr>'}</tbody>
</table>`;
}

function buildLatestCards(manifests: ProbeManifest[]): string {
  return FLOW_IDS.map((id) => {
    const hit = manifests.find((m) => m.flowId === id);
    if (!hit) {
      return `<div class="card"><h3>${esc(flowLabel(id))}</h3><p class="muted">暂无调试运行</p></div>`;
    }
  const apiN = readApiFailures(id, hit.runId).reduce((n, e) => n + e.failures.length, 0);
    const status = hit.ok === false ? 'fail' : hit.ok ? 'ok' : 'unk';
    return `<div class="card ${status}">
<h3>${esc(flowLabel(id))}</h3>
<ul>
<li>开始：${esc(fmtTime(hit.startedAt))}</li>
<li>结果：${esc(resultLabel(hit))}（${hit.passed ?? 0}/${hit.total ?? 0}，${hit.durationSec ?? '-'}s）</li>
<li>用例：<code>${esc(hit.spec || '')}</code></li>
<li>接口报错：${apiN} 条</li>
<li>截图：${hit.screenshotsDiscarded ? '已丢弃（未全通过）' : '已保留'}</li>
</ul>
<p class="links">${buildManifestLinks(id, hit)}</p>
</div>`;
  }).join('\n');
}

function buildHtml(generatedAt: string, outAbs: string): string {
  const manifests = loadProbeManifests();
  const scanRoot = fs.existsSync(FLOW_ROOT) ? FLOW_ROOT : 'screenshots';
  const targets = discoverProbeFlowScanTargets(scanRoot);
  const sections = targets.map((t) => buildScriptSection(t.testDir, t.scriptPath, manifests, outAbs)).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>流程调试汇总</title>
<style>
body{font-family:ui-sans-serif,system-ui,sans-serif;margin:24px;color:#1a1a1a;background:#f7f8fa;line-height:1.6}
h1{font-size:22px;margin:0 0 8px}
.head-meta{color:#666;font-size:13px;margin-bottom:20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:24px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px}
.card.ok{border-color:#86efac}
.card.fail{border-color:#fca5a5}
.card h3{margin:0 0 8px;font-size:16px}
.card ul{margin:0;padding-left:18px;font-size:13px}
.links{font-size:13px;margin:8px 0 0}
.links a{color:#7c3aed;margin-right:8px}
.script-card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px 18px;margin-bottom:20px}
.script-card h2{margin:0 0 4px;font-size:17px}
.sub{margin:0 0 10px;color:#6b7280;font-size:12px}
.meta-list{margin:0 0 8px;padding-left:18px;font-size:13px}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:12px}
.shots figure{margin:0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#fff}
.shots img{display:block;width:100%;height:auto;background:#f3f4f6}
.shots figcaption{font-size:11px;padding:6px 8px;color:#4b5563}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:13px;margin:24px 0}
th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
th{background:#f3f4f6}
tr.ok td:nth-child(3){color:#15803d}
tr.fail td:nth-child(3){color:#b91c1c}
h2.section-title{font-size:16px;margin:28px 0 10px}
.muted{color:#6b7280;font-size:13px}
code{font-size:12px}
</style>
</head>
<body>
<h1>流程调试汇总</h1>
<div class="head-meta">生成时间：${esc(generatedAt)} · 汇总 full-flow / travel-submit 等非 Golden 回归数据 · 客户报告仅含 Golden</div>
<div class="cards">${buildLatestCards(manifests)}</div>
<h2 class="section-title">调试脚本 · 最近步骤截图</h2>
${sections || '<p class="muted">screenshots/flows 下暂无流程调试截图目录，请先跑「流程调试」用例。</p>'}
<h2 class="section-title">调试运行历史</h2>
${buildHistoryTable(manifests)}
<p class="muted">提示：未全通过时步骤截图会被丢弃，但回放录像与 progress.json 仍可用于排查；可点「申请单并审计」生成 UI 审计报告。</p>
</body>
</html>`;
}

function main(): void {
  const args = process.argv.slice(2);
  const out = args.find((a) => a.startsWith('--out='))?.slice('--out='.length) || DEFAULT_OUT;
  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false });
  const outAbs = path.resolve(out);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, buildHtml(generatedAt, outAbs), 'utf-8');
  console.log(`✅ 流程调试汇总: ${out}`);
}

main();
