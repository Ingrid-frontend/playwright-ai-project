import fs from 'fs';
import path from 'path';
import type { FeishuMode } from './test-jobs-config.js';
import { fetchWithRetry } from '../feishu/feishu-utils.js';
import { BITABLE_RESULT_FILE } from '../feishu/bitable-schema.js';

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

/* ── 主内容构建 ── */


function translateTrigger(t: string): string {
  const map: Record<string, string> = {
    schedule: '定时运行',
    manual: '手动触发',
    ci: '代码提交',
    cli: '手动触发',
  };
  return map[t] || t;
}

function buildResultMarkdown(summary: JobNotifySummary): string {
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
    const hasButtons =
      process.env.ENABLE_GITHUB === '1' ||
      process.env.FEISHU_CALLBACK_URL ||
      process.env.FEISHU_REPORT_URL ||
      fs.existsSync('results/feishu-doc-url.txt') ||
      fs.existsSync(BITABLE_RESULT_FILE);
    const reportHint = hasButtons
      ? '📎 完整报告与看板数据已生成，可通过下方按钮查看'
      : '📎 完整差异报告已生成，请联系测试团队获取详情';
    lines.push(reportHint);
  }
  if (summary.errorSummary) {
    lines.push(summary.errorSummary);
  }

  // 趋势线
  const trendSection = buildTrendSection();
  if (trendSection) lines.push('', trendSection);

  // 历史对比
  const histSection = buildHistoricalComparison();
  if (histSection) lines.push('', histSection);

  // 失败详情（最多 3 条）
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

/* ── 差异趋势线（从历史快照读取各脚本 avgDifference 趋势） ── */

/* ── 清理脚本标签 ── */

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

/* ── 与上次运行的历史对比（含 blocker/warning 数字变化） ── */

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

/* ── 卡片头部 ── */

function cardHeader(summary: JobNotifySummary): { title: string; template: 'green' | 'red' } {
  if (summary.testPassed && !summary.aborted) {
    return { title: '🎉 自动化测试通过', template: 'green' };
  }
  return { title: '⚠️ 自动化测试未通过', template: 'red' };
}

/* ── 按钮构建 ── */

function buildGithubActionsButtons(githubEnabled: boolean): Array<Record<string, unknown>> {
  if (!githubEnabled) return [];
  const githubRepository = process.env.GITHUB_REPOSITORY || 'Ingrid-frontend/playwright-ai-project';
  const githubRunId = process.env.GITHUB_RUN_ID || '';
  const githubRunUrl = `https://github.com/${githubRepository}/actions/runs/${githubRunId}`;
  const [owner, repo] = githubRepository.split('/');
  const publicBase =
    process.env.PUBLIC_REPORT_URL?.replace(/\/$/, '') || `https://${owner}.github.io/${repo}`;
  return [
    {
      tag: 'button',
      text: { tag: 'plain_text', content: '📊 完整报告' },
      type: 'primary',
      url: `${publicBase}/`,
    },
    {
      tag: 'button',
      text: { tag: 'plain_text', content: '📥 CI 产物' },
      type: 'default',
      url: githubRunUrl,
    },
  ];
}

function buildFeishuDocButton(): Array<Record<string, unknown>> {
  const feishuDocUrlPath = 'results/feishu-doc-url.txt';
  if (!fs.existsSync(feishuDocUrlPath)) return [];
  try {
    const feishuDocUrl = fs.readFileSync(feishuDocUrlPath, 'utf-8').trim();
    if (feishuDocUrl) {
      return [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '📄 飞书文档' },
          type: 'primary',
          url: feishuDocUrl,
        },
      ];
    }
  } catch { /* ignore */ }
  return [];
}

function buildBitableButtons(): Array<Record<string, unknown>> {
  if (!fs.existsSync(BITABLE_RESULT_FILE)) return [];
  try {
    const record = JSON.parse(fs.readFileSync(BITABLE_RESULT_FILE, 'utf-8')) as BitableRecordFile;
    const buttons: Array<Record<string, unknown>> = [];
    if (record.runRecordUrl) {
      buttons.push({
        tag: 'button',
        text: { tag: 'plain_text', content: '📋 多维表记录' },
        type: 'primary',
        url: record.runRecordUrl,
      });
    }
    if (record.dashboardUrl) {
      buttons.push({
        tag: 'button',
        text: { tag: 'plain_text', content: '📈 质量看板' },
        type: 'default',
        url: record.dashboardUrl,
      });
    }
    return buttons;
  } catch {
    return [];
  }
}


function buildFallbackReportButton(reportUrl?: string | null): Array<Record<string, unknown>> {
  const url = reportUrl || process.env.FEISHU_REPORT_URL?.trim();
  if (!url) return [];
  return [
    {
      tag: 'button',
      text: { tag: 'plain_text', content: '📊 查看报告' },
      type: 'primary',
      url,
    },
  ];
}


async function autoDetectReportUrl(): Promise<string | null> {
  const explicit = process.env.FEISHU_REPORT_URL?.trim();
  if (explicit) return explicit;

  // 报告文件必须存在
  const reportFile = path.join(process.cwd(), 'results', 'screenshot-comparison.html');
  if (!fs.existsSync(reportFile)) return null;

  // 尝试常见端口
  const ports = [3001, 8080, 3000, 8000, 3333, 5000, 9000];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 400);

  for (const port of ports) {
    try {
      const url = `http://localhost:${port}/results/screenshot-comparison.html`;
      const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
      if (res.ok || res.status === 200) {
        clearTimeout(timeout);
        return url;
      }
    } catch { /* port not available, try next */ }
  }
  clearTimeout(timeout);
  return null;
}

function buildInteractButtons(_callbackUrl: string): Array<Record<string, unknown>> {
  return [
    {
      tag: 'button',
      text: { tag: 'plain_text', content: '🔄 重跑失败用例' },
      type: 'default',
      value: { action: 'rerun_failed' },
    },
    {
      tag: 'button',
      text: { tag: 'plain_text', content: '✅ 批准基线' },
      type: 'primary',
      value: { action: 'approve_baseline' },
    },
  ];
}

function buildCardElements(
  summary: JobNotifySummary,
  effectiveMode: FeishuMode,
  githubEnabled: boolean,
  callbackUrl: string | undefined,
  reportUrl?: string | null,
): Array<Record<string, unknown>> {
  const resultMd = buildResultMarkdown(summary);
  const elements: Array<Record<string, unknown>> = [
    { tag: 'div', text: { tag: 'lark_md', content: resultMd } },
  ];

  const reportButtons = [
    ...buildGithubActionsButtons(githubEnabled),
    ...buildBitableButtons(),
    ...buildFeishuDocButton(),
    ...buildFallbackReportButton(reportUrl),
  ];
  if (reportButtons.length > 0) {
    elements.push({ tag: 'action', actions: reportButtons });
  }

  if (callbackUrl) {
    const interactBtns = buildInteractButtons(callbackUrl);
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: '**⚡ 快捷操作**：' } });
    elements.push({ tag: 'action', actions: interactBtns });
  }

  return elements;
}

/* ── 发送通知 ── */

export async function sendJobFeishuNotification(
  mode: FeishuMode,
  summary: JobNotifySummary,
): Promise<boolean> {
  if (mode === 'none') {
    console.log('ℹ️  feishu-mode=none，跳过飞书通知');
    return true;
  }

  let effectiveMode = mode;
  const githubEnabled = process.env.ENABLE_GITHUB === '1';
  if (mode === 'links' && !githubEnabled) {
    console.log('ℹ️  未启用 GitHub 链接（ENABLE_GITHUB!=1），降级为 interactive');
    effectiveMode = 'interactive';
  }

  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  const webhookSecret = process.env.FEISHU_WEBHOOK_SECRET;
  const callbackUrl = process.env.FEISHU_CALLBACK_URL?.trim();
  const sensitiveLogsEnabled = process.env.ENABLE_SENSITIVE_LOGS === '1';

  console.log('🔍 飞书通知配置检查：');
  console.log('  - Webhook URL:', webhookUrl ? '已配置' : '未配置');

  if (!webhookUrl) {
    console.log('⚠️  未配置飞书 Webhook URL，跳过通知');
    return true;
  }

  const { title: cardTitle, template: cardTemplate } = cardHeader(summary);
  
  // 自动更新飞书报告文档
  const feishuAppId = process.env.FEISHU_APP_ID?.trim();
  if (feishuAppId && !process.env.SKIP_FEISHU_DOC) {
    try {
      const { execSync } = await import('child_process');
      const repoRoot = process.cwd();
      const script = path.join(repoRoot, 'scripts', 'feishu', 'update-feishu-report.ts');
      if (fs.existsSync(script)) {
        execSync(`npx tsx "${script}"`, { cwd: repoRoot, stdio: 'pipe', timeout: 30000 });
      }
    } catch (e: any) {
      console.log('⚠️  飞书文档更新失败（不影响通知）:', e.message?.slice(0, 100));
    }
  }
  
  const timestamp = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  let body: object;

  if (effectiveMode === 'text') {
    const resultMd = buildResultMarkdown(summary);
    body = {
      msg_type: 'text',
      content: { text: `${cardTitle}\n\n${resultMd}` },
    };
  } else {
    const detectedUrl = await autoDetectReportUrl();
    const elements = buildCardElements(summary, effectiveMode, githubEnabled, callbackUrl, detectedUrl);
    body = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: cardTitle },
          template: cardTemplate,
        },
        elements,
      },
    };
  }

  if (webhookSecret) {
    const crypto = await import('crypto');
    const bodyString = JSON.stringify(body);
    const signString = `${timestamp}\n${bodyString}`;
    if (sensitiveLogsEnabled) {
      console.log('  - 签名字符串:', signString);
    }
    headers['X-Lark-Request-Timestamp'] = String(timestamp);
    headers['X-Lark-Signature'] = crypto.createHmac('sha256', webhookSecret).update(signString).digest('base64');
  }

  // 应用层重试：最多 2 次尝试（网络失败或 5xx 时 fetchWithRetry 已重试，此处针对业务层失败重试）
  const MAX_NOTIFY_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_NOTIFY_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithRetry(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const responseText = await response.text();
      if (response.ok) {
        console.log(`✅ 飞书通知发送成功${attempt > 1 ? `（第 ${attempt} 次尝试）` : ''}`);
        return true;
      }
      console.log(`❌ 飞书通知发送失败 (attempt ${attempt}/${MAX_NOTIFY_ATTEMPTS}):`, response.status, responseText);
      if (attempt < MAX_NOTIFY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return false;
    } catch (error) {
      console.log(`❌ 飞书通知发送异常 (attempt ${attempt}/${MAX_NOTIFY_ATTEMPTS}):`, error);
      if (attempt < MAX_NOTIFY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return false;
    }
  }
  return false;
}

/* ── UI Issues 读取 ── */

export function readUiIssuesSummaryLine(): string | undefined {
  const counts = readUiIssuesSummaryCounts();
  if (!counts) return undefined;
  return `**界面差异**：严重 ${counts.blocker} 项 · 轻微 ${counts.warning} 项 · 共 ${counts.total} 项`;
}

export function readUiIssuesSummaryCounts():
  | { blocker: number; warning: number; total: number }
  | undefined {
  const p = path.join(process.cwd(), 'results/ui-issues.json');
  if (!fs.existsSync(p)) return undefined;
  try {
    const report = JSON.parse(fs.readFileSync(p, 'utf-8')) as {
      summary?: { blocker: number; warning: number; total: number };
    };
    if (!report.summary) return undefined;
    return {
      blocker: report.summary.blocker ?? 0,
      warning: report.summary.warning ?? 0,
      total: report.summary.total ?? 0,
    };
  } catch {
    return undefined;
  }
}

export function buildJobFailReasons(input: {
  testPassed: boolean;
  comparePassed: boolean;
  compareSkipped: boolean;
  aborted: boolean;
  failCount: number;
  executedCount?: number;
  compareGate?: boolean;
  feishuDocPassed?: boolean;
  feishuDocAttempted?: boolean;
  uiIssuesBlocker?: number;
}): string[] {
  const reasons: string[] = [];
  if (input.aborted) reasons.push('执行已中断');
  if (input.failCount > 0) {
    reasons.push(`${input.failCount} 个用例执行失败`);
  } else if (!input.testPassed && (input.executedCount ?? 0) === 0) {
    reasons.push('未匹配到可执行用例');
  } else if (!input.testPassed) {
    reasons.push('用例执行未通过');
  }

  if (!input.compareSkipped && !input.comparePassed) {
    if (input.compareGate) {
      const b = input.uiIssuesBlocker;
      reasons.push(
        b != null && b > 0 ? `截图对比 gate 未通过（blocker ${b}）` : '截图对比 gate 未通过',
      );
    } else {
      reasons.push('截图对比失败');
    }
  }

  if (input.feishuDocAttempted && input.feishuDocPassed === false) {
    reasons.push('飞书文档创建失败');
  }

  return reasons;
}
