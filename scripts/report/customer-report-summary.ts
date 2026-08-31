import fs from 'fs';
import path from 'path';
import type { CustomerReportModel } from './customer-report-model.js';

export type CustomerReportSummary = {
  generatedAt: string;
  headline: string;
  shipAdvice: CustomerReportModel['shipAdvice'];
  shipAdviceLabel: string;
  regressGroupCount: number;
  regressSteps: number;
  minorSteps: number;
  passSteps: number;
  comparedSteps: number;
  expectedSteps: number;
  uncoveredSteps: number;
  passRate: number;
  coveragePct: number;
  envLabel?: string;
  releaseTag?: string;
  actionItems: string[];
  issues: Array<{
    title: string;
    reason: string;
    maxDifferenceLabel: string;
    affectedSteps: number;
    priority: 'P0' | 'P1';
    natureLabel?: string;
  }>;
};

export const CUSTOMER_SUMMARY_FILE = 'results/customer-report-summary.json';

export function buildCustomerReportSummary(model: CustomerReportModel): CustomerReportSummary {
  const c = model.coverage;
  const coveragePct =
    c.expectedSteps > 0 ? Math.round((c.comparedSteps / c.expectedSteps) * 100) : 0;
  const headline =
    c.regressSteps > 0
      ? `发现 ${model.regressionGroups.length} 个问题需要修复`
      : c.minorSteps > 0
        ? `存在 ${c.minorSteps} 处轻微变化，建议人工确认`
        : c.comparedSteps === 0
          ? '本次无有效对比，无法给出结论'
          : '本次未发现需要修复的问题';

  return {
    generatedAt: model.generatedAt,
    headline,
    shipAdvice: model.shipAdvice,
    shipAdviceLabel: model.shipAdviceLabel,
    regressGroupCount: model.regressionGroups.length,
    regressSteps: c.regressSteps,
    minorSteps: c.minorSteps,
    passSteps: c.passSteps,
    comparedSteps: c.comparedSteps,
    expectedSteps: c.expectedSteps,
    uncoveredSteps: c.uncoveredSteps,
    passRate: c.passRate,
    coveragePct,
    envLabel: model.envLabel,
    releaseTag: model.releaseTag,
    actionItems: model.actionItems,
    issues: model.regressionGroups.map((g) => {
      const card = g.representative.browsers[0];
      const region = card?.regions.find((r) => r.actionable) || card?.regions[0];
      return {
        title: g.title,
        reason: g.reason || '检测到与验收基线的差异',
        maxDifferenceLabel: g.maxDifferenceLabel,
        affectedSteps: g.affectedSteps,
        priority: g.status === 'regress' ? 'P0' : 'P1',
        natureLabel: region?.natureLabel,
      };
    }),
  };
}

export function writeCustomerReportSummary(
  model: CustomerReportModel,
  filePath = CUSTOMER_SUMMARY_FILE,
): CustomerReportSummary {
  const summary = buildCustomerReportSummary(model);
  const abs = path.resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(summary, null, 2), 'utf-8');
  return summary;
}

export function readCustomerReportSummary(
  filePath = CUSTOMER_SUMMARY_FILE,
): CustomerReportSummary | null {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8')) as CustomerReportSummary;
  } catch {
    return null;
  }
}

export function formatCustomerSummaryMarkdown(s: CustomerReportSummary): string {
  const ctx = [s.envLabel, s.releaseTag ? `v${s.releaseTag}` : ''].filter(Boolean).join(' · ');
  const lines: string[] = [
    `**${s.headline}**`,
    ...(ctx ? [`环境：${ctx}`] : []),
    `发版建议：${s.shipAdviceLabel}`,
    `检测覆盖：${s.coveragePct}%（已对比 ${s.comparedSteps}/${s.expectedSteps} 步）`,
    `需要修复 ${s.regressSteps} 步 · 无需处理 ${s.minorSteps} 步 · 通过率 ${(s.passRate * 100).toFixed(1)}%`,
  ];
  if (s.uncoveredSteps > 0) {
    lines.push(`待建基线 ${s.uncoveredSteps} 步（未参与判定）`);
  }
  if (s.issues.length > 0) {
    lines.push('', '**问题清单**：');
    for (const [i, issue] of s.issues.slice(0, 5).entries()) {
      const nature = issue.natureLabel ? ` · ${issue.natureLabel}` : '';
      lines.push(
        `${i + 1}. [${issue.priority}] ${issue.title}（${issue.maxDifferenceLabel}，影响 ${issue.affectedSteps} 步${nature}）`,
      );
      lines.push(`   ${issue.reason}`);
    }
    if (s.issues.length > 5) {
      lines.push(`… 另有 ${s.issues.length - 5} 个问题，见完整报告`);
    }
  }
  if (s.actionItems.length > 0) {
    lines.push('', '**建议操作**：');
    for (const [i, item] of s.actionItems.entries()) {
      lines.push(`${i + 1}. ${item}`);
    }
  }
  return lines.join('\n');
}

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderCustomerSummaryPrintHtml(s: CustomerReportSummary): string {
  const ctx = [s.envLabel, s.releaseTag ? `v${s.releaseTag}` : ''].filter(Boolean).join(' · ');
  const issueRows =
    s.issues.length > 0
      ? s.issues
          .map(
            (issue, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(issue.priority)}</td>
        <td>${esc(issue.title)}</td>
        <td>${esc(issue.reason)}</td>
        <td>${esc(issue.maxDifferenceLabel)}</td>
        <td>${issue.affectedSteps}</td>
      </tr>`,
          )
          .join('')
      : '<tr><td colspan="6" style="text-align:center;color:#666">本次未发现需要修复的问题</td></tr>';
  const actions =
    s.actionItems.length > 0
      ? `<ol>${s.actionItems.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>`
      : '<p style="color:#666">无额外操作建议</p>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>UI 验收检测摘要</title>
  <style>
    @page { size: A4; margin: 18mm; }
    body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2329; font-size: 13px; line-height: 1.5; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .meta { color: #646a73; font-size: 12px; margin-bottom: 16px; }
    .headline { font-size: 16px; font-weight: 650; margin: 12px 0 8px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
    .stat { border: 1px solid #e5e6eb; border-radius: 6px; padding: 8px; text-align: center; }
    .stat .n { font-size: 18px; font-weight: 700; }
    .stat .l { font-size: 11px; color: #646a73; }
    .bar { height: 8px; background: #e9ecef; border-radius: 999px; overflow: hidden; margin: 8px 0; }
    .bar > i { display: block; height: 100%; background: #228be6; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    th, td { border: 1px solid #e5e6eb; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f1f3f5; }
    h2 { font-size: 14px; margin: 16px 0 8px; }
    .foot { margin-top: 20px; font-size: 11px; color: #868e96; }
  </style>
</head>
<body>
  <h1>UI 验收检测摘要</h1>
  <div class="meta">${esc(ctx)}${ctx ? ' · ' : ''}生成时间 ${esc(s.generatedAt)}</div>
  <div class="headline">${esc(s.headline)}</div>
  <p>发版建议：${esc(s.shipAdviceLabel)}</p>
  <p>检测覆盖 ${s.coveragePct}%（已对比 ${s.comparedSteps} / ${s.expectedSteps} 步）${s.uncoveredSteps > 0 ? ` · 待建基线 ${s.uncoveredSteps} 步` : ''}</p>
  <div class="bar"><i style="width:${s.coveragePct}%"></i></div>
  <div class="stats">
    <div class="stat"><div class="n" style="color:#e03131">${s.regressSteps}</div><div class="l">需要修复</div></div>
    <div class="stat"><div class="n" style="color:#f08c00">${s.minorSteps}</div><div class="l">无需处理</div></div>
    <div class="stat"><div class="n" style="color:#2f9e44">${s.passSteps}</div><div class="l">完全一致</div></div>
    <div class="stat"><div class="n">${(s.passRate * 100).toFixed(1)}%</div><div class="l">通过率</div></div>
  </div>
  <h2>问题清单</h2>
  <table>
    <thead><tr><th>#</th><th>优先级</th><th>页面</th><th>说明</th><th>差异</th><th>影响步数</th></tr></thead>
    <tbody>${issueRows}</tbody>
  </table>
  <h2>建议操作</h2>
  ${actions}
  <div class="foot">完整图文报告见 results/ui-regression-customer.html</div>
</body>
</html>`;
}

export function customerCardHeader(s: CustomerReportSummary): {
  title: string;
  template: 'green' | 'red' | 'orange' | 'blue';
} {
  if (s.shipAdvice === 'fix') {
    return { title: `🔴 UI 验收：${s.regressGroupCount} 个问题需修复`, template: 'red' };
  }
  if (s.shipAdvice === 'baseline') {
    return { title: '🟠 UI 验收：检测覆盖不足', template: 'orange' };
  }
  if (s.shipAdvice === 'confirm') {
    return { title: '🟡 UI 验收：建议确认轻微变化', template: 'orange' };
  }
  return { title: '🟢 UI 验收：可以发版', template: 'green' };
}

export function getCustomerReportUrl(): string | null {
  const base = process.env.PUBLIC_REPORT_URL?.replace(/\/$/, '');
  if (base) return `${base}/customer-report/index.html`;
  const local = path.resolve('results/ui-regression-customer.html');
  if (fs.existsSync(local)) return `file://${local}`;
  return null;
}
