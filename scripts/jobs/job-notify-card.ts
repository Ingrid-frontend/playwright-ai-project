import fs from 'fs';
import path from 'path';
import type { FeishuMode } from './test-jobs-config.js';
import {
  BITABLE_RESULT_FILE,
  buildChartCardElements,
  isChartCardEnabled,
} from '../feishu/index.js';

type BitableRecordFile = {
  runRecordUrl?: string;
  dashboardUrl?: string;
};

export type JobNotifySummary = {
  jobId?: string;
  jobDescription?: string;
  trigger?: string;
  testPassed: boolean;
  comparePassed: boolean;
  compareSkipped?: boolean;
  feishuDocAttempted: boolean;
  feishuDocPassed: boolean;
  aborted?: boolean;
  uiIssuesSummary?: string;
  errorSummary?: string;
  failureDetails?: string[];
};

function translateTrigger(t: string): string {
  const map: Record<string, string> = {
    schedule: '定时运行',
    manual: '手动触发',
    ci: '代码提交',
    cli: '手动触发',
  };
  return map[t] || t;
}

export function buildResultMarkdown(summary: JobNotifySummary): string {
  const lines: string[] = [
    '**测试结果**：',
    ...(summary.jobId ? [`**任务**：\`${summary.jobId}\`${summary.jobDescription ? ` — ${summary.jobDescription}` : ''}`] : []),
    ...(summary.trigger ? [`**触发**：${translateTrigger(summary.trigger)}`] : []),
    summary.aborted ? '⏹️ 执行：已中断（失败即停）' : `${summary.testPassed ? '✅' : '❌'} 执行：${summary.testPassed ? '成功' : '失败'}`,
    summary.compareSkipped
      ? '⏭️ 对比：已跳过'
      : `${summary.comparePassed ? '✅' : '❌'} 对比：${summary.comparePassed ? '成功' : '失败'}`,
  ];
  if (summary.feishuDocAttempted) {
    lines.push(`${summary.feishuDocPassed ? '✅' : '❌'} 飞书文档：${summary.feishuDocPassed ? '成功' : '失败'}`);
  }
  if (summary.uiIssuesSummary) {
    lines.push(summary.uiIssuesSummary);
    const reportHint = getDashboardUrl()
      ? '📎 可通过下方「打开仪表盘」查看详情'
      : '📎 完整差异报告已生成，请联系测试团队获取详情';
    lines.push(reportHint);
  }
  if (summary.errorSummary) {
    lines.push(summary.errorSummary);
  }

  const trendSection = buildTrendSection();
  if (trendSection) lines.push('', trendSection);

  const histSection = buildHistoricalComparison();
  if (histSection) lines.push('', histSection);

  if (summary.failureDetails && summary.failureDetails.length > 0) {
    const maxShow = 3;
    const shown = summary.failureDetails.slice(0, maxShow);
    lines.push('', '**❌ 失败用例**：');
    for (const detail of shown) {
      lines.push(`  • ${detail}`);
    }
    if (summary.failureDetails.length > maxShow) {
      lines.push(`  … 另有 ${summary.failureDetails.length - maxShow} 个失败用例，查看完整报告获取详情`);
    }
  }

  if (process.env.GITHUB_RUN_ID) {
    lines.push('**报告**：Actions 下载 Artifact `full-report-*`，解压后打开 `public-reports/index.html`');
  }
  return lines.join('\n');
}

function cleanScriptLabel(key: string): string {
  let label = key.replace(/^stage\//, "").replace(/^uat\//, "").replace(/^dev\//, "");
  const slashIdx = label.indexOf("/");
  if (slashIdx > 0) {
    label = label.slice(slashIdx + 1);
  }
  label = label.replace(/[_]\d{4}-\d{2}-\d{2}.*$/, "");
  return label || key;
}

function buildTrendSection(): string | null {
  const historyDir = path.join(process.cwd(), 'results', 'history');
  if (!fs.existsSync(historyDir)) return null;
  try {
    const files = fs.readdirSync(historyDir)
      .filter((f: string) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .slice(-14);
    if (files.length < 2) return null;

    const scriptSnapshots: Record<string, { date: string; v: number }[]> = {};
    for (const file of files) {
      const date = file.replace(/\.json$/, '');
      const raw = JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf-8')) as {
        byScript?: Record<string, { blocker: number; warning: number; avgDifference: number }>;
      };
      if (!raw.byScript) continue;
      for (const [script, data] of Object.entries(raw.byScript)) {
        if (!scriptSnapshots[script]) scriptSnapshots[script] = [];
        scriptSnapshots[script].push({ date, v: data.avgDifference });
      }
    }

    const scored: { label: string; current: number; prev: number; delta: number; points: number[] }[] = [];
    for (const [key, points] of Object.entries(scriptSnapshots)) {
      if (points.length < 2) continue;
      const vals = points.map((p) => p.v);
      scored.push({
        label: cleanScriptLabel(key),
        current: vals[vals.length - 1],
        prev: vals[vals.length - 2],
        delta: vals[vals.length - 1] - vals[vals.length - 2],
        points: vals,
      });
    }
    if (scored.length === 0) return null;

    const top = scored.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
    const days = files.length;
    const lines: string[] = [`**📈 差异趋势（近${days}天）**：`];

    for (const item of top) {
      const bar = renderMiniBar(item.points);
      const pct = (item.current * 100).toFixed(1);
      let arrow = '➡️';
      let deltaNote = '';
      if (item.delta > 0.001) {
        arrow = '🔺';
        deltaNote = `↑${(item.delta * 100).toFixed(1)}%`;
      } else if (item.delta < -0.001) {
        arrow = '🟢';
        deltaNote = `↓${(Math.abs(item.delta) * 100).toFixed(1)}%`;
      }
      const label = item.label.length > 22 ? item.label.slice(0, 20) + '…' : item.label;
      lines.push(`  ${bar} ${pct}% ${arrow} ${deltaNote} · ${label}`);
    }
    return lines.join('\n');
  } catch {
    return null;
  }
}

function renderMiniBar(points: number[]): string {
  const MAX_BARS = 10;
  const sampled = points.length <= MAX_BARS ? points : sampleArray(points, MAX_BARS);
  const max = Math.max(...sampled, 0.001);
  return sampled
    .map((v) => {
      const ratio = v / max;
      if (ratio > 0.875) return '█';
      if (ratio > 0.625) return '▆';
      if (ratio > 0.375) return '▄';
      if (ratio > 0.125) return '▂';
      return '▁';
    })
    .join('');
}

function sampleArray<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return [...arr];
  const step = (arr.length - 1) / (n - 1);
  const result: T[] = [];
  for (let i = 0; i < n; i++) {
    result.push(arr[Math.min(Math.round(i * step), arr.length - 1)]);
  }
  return result;
}

function buildHistoricalComparison(): string | null {
  const historyDir = path.join(process.cwd(), 'results', 'history');
  if (!fs.existsSync(historyDir)) return null;
  const files = fs.readdirSync(historyDir).filter((f: string) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (files.length < 2) return null;
  try {
    const currentRaw = JSON.parse(fs.readFileSync(path.join(historyDir, files[files.length - 1]), 'utf-8')) as {
      summary?: { total: number; blocker: number; warning: number };
    };
    const lastRaw = JSON.parse(fs.readFileSync(path.join(historyDir, files[files.length - 2]), 'utf-8')) as {
      summary?: { total: number; blocker: number; warning: number };
    };
    if (!currentRaw.summary || !lastRaw.summary) return null;

    const curr = currentRaw.summary;
    const last = lastRaw.summary;
    const lastDate = files[files.length - 2].replace(/\.json$/, '');

    const blockerDiff = curr.blocker - last.blocker;
    const warningDiff = curr.warning - last.warning;
    const totalDiff = curr.total - last.total;

    const arrow = (d: number) => (d > 0 ? '🔺' : d < 0 ? '🟢' : '➡️');

    const parts: string[] = [];
    parts.push(`严重 ${last.blocker}→${curr.blocker} ${arrow(blockerDiff)}`);
    parts.push(`轻微 ${last.warning}→${curr.warning} ${arrow(warningDiff)}`);
    parts.push(`共 ${last.total}→${curr.total} ${arrow(totalDiff)}`);

    return `**📊 较上次运行 (${lastDate})**：${parts.join(' · ')}`;
  } catch {
    return null;
  }
}

export function cardHeader(summary: JobNotifySummary): { title: string; template: 'green' | 'red' } {
  if (summary.testPassed && !summary.aborted) {
    return { title: '🎉 自动化测试通过', template: 'green' };
  }
  return { title: '⚠️ 自动化测试未通过', template: 'red' };
}

function getDashboardUrl(): string | null {
  if (fs.existsSync(BITABLE_RESULT_FILE)) {
    try {
      const record = JSON.parse(fs.readFileSync(BITABLE_RESULT_FILE, 'utf-8')) as BitableRecordFile;
      if (record.dashboardUrl) return record.dashboardUrl;
    } catch {
      /* ignore */
    }
  }

  const publicBase = process.env.PUBLIC_REPORT_URL?.replace(/\/$/, '');
  if (publicBase) return `${publicBase}/dashboard/`;

  const reportUrl = process.env.FEISHU_REPORT_URL?.trim();
  if (reportUrl) return reportUrl;

  return null;
}

function buildDashboardPrimaryButton(): Array<Record<string, unknown>> {
  const url = getDashboardUrl();
  if (!url) return [];
  return [
    {
      tag: 'button',
      text: { tag: 'plain_text', content: '打开仪表盘' },
      type: 'primary',
      url,
    },
  ];
}

function buildTestStatusLine(summary: JobNotifySummary): string {
  const parts: string[] = [
    summary.aborted
      ? '⏹️ 执行已中断'
      : `${summary.testPassed ? '✅' : '❌'} 执行${summary.testPassed ? '通过' : '失败'}`,
  ];
  if (summary.compareSkipped) {
    parts.push('⏭️ 对比已跳过');
  } else {
    parts.push(`${summary.comparePassed ? '✅' : '❌'} 对比${summary.comparePassed ? '通过' : '失败'}`);
  }
  if (summary.uiIssuesSummary) {
    parts.push(summary.uiIssuesSummary.replace(/\*\*/g, ''));
  }
  return parts.join(' · ');
}

function buildReportActionButtons(): Array<Record<string, unknown>> {
  return buildDashboardPrimaryButton();
}

function buildCardFooterNote(): Record<string, unknown> {
  return {
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: process.env.FEISHU_CARD_SOURCE || '来自 Playwright UI 回归',
      },
    ],
  };
}

export async function buildCardPayload(
  summary: JobNotifySummary,
  effectiveMode: FeishuMode,
): Promise<{ header: { title: string; template: string }; elements: Array<Record<string, unknown>> }> {
  const { title: defaultTitle, template: defaultTemplate } = cardHeader(summary);
  const reportButtons = buildReportActionButtons();

  if (effectiveMode !== 'text' && isChartCardEnabled()) {
    const chartCard = await buildChartCardElements();
    if (chartCard) {
      const elements: Array<Record<string, unknown>> = [
        ...chartCard.elements,
        { tag: 'div', text: { tag: 'lark_md', content: buildTestStatusLine(summary) } },
      ];
      if (reportButtons.length > 0) {
        elements.push({ tag: 'action', actions: reportButtons });
      }
      elements.push(buildCardFooterNote());
      return {
        header: { title: chartCard.header.title, template: chartCard.header.template },
        elements,
      };
    }
  }

  const elements = buildCardElements(summary, reportButtons);
  return {
    header: { title: defaultTitle, template: defaultTemplate },
    elements,
  };
}

function buildCardElements(
  summary: JobNotifySummary,
  reportButtons = buildReportActionButtons(),
): Array<Record<string, unknown>> {
  const resultMd = buildResultMarkdown(summary);
  const elements: Array<Record<string, unknown>> = [
    { tag: 'div', text: { tag: 'lark_md', content: resultMd } },
  ];

  if (reportButtons.length > 0) {
    elements.push({ tag: 'action', actions: reportButtons });
  }

  return elements;
}
