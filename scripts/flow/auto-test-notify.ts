import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { UiIssuesReport } from '../report/ui-issues-index.js';

export type FeishuMode = 'interactive' | 'text' | 'links' | 'none';

export type AutoTestNotifySummary = {
  recordSkipped: boolean;
  testPassed: boolean;
  comparePassed: boolean;
  feishuDocAttempted: boolean;
  feishuDocPassed: boolean;
  uiIssues?: UiIssuesReport['summary'];
  errorSummary?: string;
};

function buildNotifyResultMarkdown(s: AutoTestNotifySummary): string {
  const lines = [
    '**测试结果**：',
    s.recordSkipped ? '⏭️ 录制：跳过（CI）' : '✅ 录制：成功',
    '✅ 优化：成功（pipeline-raw-to-optimized）',
    `${s.testPassed ? '✅' : '❌'} 执行：${s.testPassed ? '成功' : '失败'}`,
    `${s.comparePassed ? '✅' : '❌'} 对比：${s.comparePassed ? '成功' : '失败'}`,
  ];
  if (s.feishuDocAttempted) {
    lines.push(`${s.feishuDocPassed ? '✅' : '❌'} 飞书文档：${s.feishuDocPassed ? '成功' : '失败'}`);
  }
  if (s.uiIssues) {
    lines.push(
      `**UI 问题**：blocker ${s.uiIssues.blocker} · warning ${s.uiIssues.warning} · 共 ${s.uiIssues.total} 项`,
    );
    lines.push(`报告：results/screenshot-comparison.html · results/ui-issues.json`);
  }
  if (s.errorSummary) lines.push(s.errorSummary);

  // ── 差异趋势线 ──
  const trendSection = buildTrendSection();
  if (trendSection) lines.push('', trendSection);

  return lines.join('\n');
}

/* ── 趋势线（读 results/history/step-trends.json） ── */
function buildTrendSection(): string | null {
  const trendFile = path.join(process.cwd(), 'results', 'history', 'step-trends.json');
  if (!fs.existsSync(trendFile)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(trendFile, 'utf8'));
    const steps = raw.steps;
    if (!steps || Object.keys(steps).length === 0) return null;

    const scored: Array<{ label: string; current: number; prev: number; delta: number; points: number[] }> = [];
    for (const [key, points] of Object.entries(steps as Record<string, Array<{ v: number }>>)) {
      if (points.length < 2) continue;
      const vals = points.map((p) => p.v);
      scored.push({
        label: key.split('|').slice(1).join('·'),
        current: vals[vals.length - 1],
        prev: vals[vals.length - 2],
        delta: vals[vals.length - 1] - vals[vals.length - 2],
        points: vals,
      });
    }
    if (scored.length === 0) return null;

    const top = scored.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
    const days = Math.min(top[0]?.points.length ?? 7, 14);
    const lines = [`**📈 差异趋势（近${days}天）**：`];

    for (const item of top) {
      const bar = renderMiniBar(item.points);
      const pct = (item.current * 100).toFixed(1);
      let arrow = '➡️';
      let deltaNote = '';
      if (item.delta > 0.001) { arrow = '🔺'; deltaNote = `↑${(item.delta * 100).toFixed(1)}%`; }
      else if (item.delta < -0.001) { arrow = '🟢'; deltaNote = `↓${(Math.abs(item.delta) * 100).toFixed(1)}%`; }
      const label = item.label.length > 22 ? item.label.slice(0, 20) + '…' : item.label;
      lines.push(`  ${bar} ${pct}% ${arrow} ${deltaNote} · ${label}`);
    }
    return lines.join('\n');
  } catch {
    return null;
  }
}

function renderMiniBar(points: number[]) {
  const MAX_BARS = 10;
  const sampled = points.length <= MAX_BARS ? points : sampleArray(points, MAX_BARS);
  const max = Math.max(...sampled, 0.001);
  return sampled.map((v) => {
    const ratio = v / max;
    if (ratio > 0.875) return '█';
    if (ratio > 0.625) return '▆';
    if (ratio > 0.375) return '▄';
    if (ratio > 0.125) return '▂';
    return '▁';
  }).join('');
}

function sampleArray(arr: number[], n: number) {
  if (arr.length <= n) return [...arr];
  const step = (arr.length - 1) / (n - 1);
  const result = [];
  for (let i = 0; i < n; i++) {
    result.push(arr[Math.min(Math.round(i * step), arr.length - 1)]);
  }
  return result;
}

function notifyCardHeader(s: AutoTestNotifySummary): { title: string; template: string } {
  if (s.testPassed) {
    return { title: '🎉 自动化测试通过', template: 'green' };
  }
  return { title: '⚠️ 自动化测试未通过', template: 'red' };
}

export async function sendFeishuNotification(mode: FeishuMode, summary: AutoTestNotifySummary): Promise<void> {
  if (mode === 'none') {
    console.log('ℹ️  feishu-mode=none，跳过飞书通知');
    return;
  }

  let effectiveMode = mode;
  const githubEnabled = process.env.ENABLE_GITHUB === '1';
  if (mode === 'links' && !githubEnabled) {
    console.log('ℹ️  未启用 GitHub 链接（ENABLE_GITHUB!=1），降级为 interactive');
    effectiveMode = 'interactive';
  }

  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  const webhookSecret = process.env.FEISHU_WEBHOOK_SECRET;
  if (!webhookUrl) {
    console.log('⚠️  未配置飞书 Webhook URL，跳过通知');
    return;
  }

  const resultMd = buildNotifyResultMarkdown(summary);
  const { title: cardTitle, template: cardTemplate } = notifyCardHeader(summary);

    const body =
      effectiveMode === 'text'
        ? {
          msg_type: 'text',
          content: { text: `${cardTitle}\n\n${resultMd}` },
        }
        : {
          msg_type: 'interactive',
          card: {
            header: {
              title: { tag: 'plain_text', content: cardTitle },
              template: cardTemplate,
            },
            elements: buildCardElements(resultMd),
          },
        };

  const timestamp = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (webhookSecret) {
    const bodyString = JSON.stringify(body);
    const sign = crypto.createHmac('sha256', webhookSecret).update(`${timestamp}\n${bodyString}`).digest('base64');
    headers['X-Lark-Request-Timestamp'] = String(timestamp);
    headers['X-Lark-Signature'] = sign;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    console.log(response.ok ? '✅ 飞书通知发送成功' : `❌ 飞书通知失败: ${await response.text()}`);
  } catch (error) {
    console.log('❌ 飞书通知发送异常:', error);
  }
}

/* ── 增强卡片元素（含操作按钮） ── */
function buildCardElements(resultMd: string): Array<Record<string, unknown>> {
  const elements: Array<Record<string, unknown>> = [
    { tag: 'div', text: { tag: 'lark_md', content: resultMd } },
  ];

  // GitHub 报告按钮
  const githubEnabled = process.env.ENABLE_GITHUB === '1';
  if (githubEnabled) {
    const githubRepository = process.env.GITHUB_REPOSITORY || 'Ingrid-frontend/playwright-ai-project';
    const githubRunId = process.env.GITHUB_RUN_ID || '';
    const githubRunUrl = `https://github.com/${githubRepository}/actions/runs/${githubRunId}`;
    const [owner, repo] = githubRepository.split('/');
    const publicBase = process.env.PUBLIC_REPORT_URL?.replace(/\/$/, '') || `https://${owner}.github.io/${repo}`;
    elements.push({
      tag: 'action',
      actions: [
        { tag: 'button', text: { tag: 'plain_text', content: '📊 完整报告' }, type: 'primary', url: `${publicBase}/` },
        { tag: 'button', text: { tag: 'plain_text', content: '📥 CI 产物' }, type: 'default', url: githubRunUrl },
      ],
    });
  }

  // 飞书文档按钮
  const feishuDocUrlPath = 'results/feishu-doc-url.txt';
  if (fs.existsSync(feishuDocUrlPath)) {
    try {
      const feishuDocUrl = fs.readFileSync(feishuDocUrlPath, 'utf-8').trim();
      if (feishuDocUrl) {
        elements.push({
          tag: 'action',
          actions: [{ tag: 'button', text: { tag: 'plain_text', content: '📄 飞书文档' }, type: 'primary', url: feishuDocUrl }],
        });
      }
    } catch { /* ignore */ }
  }

  // 快捷操作（回调）
  const callbackUrl = process.env.FEISHU_CALLBACK_URL?.trim();
  if (callbackUrl) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: '**⚡ 快捷操作**：' } });
    elements.push({
      tag: 'action',
      actions: [
        { tag: 'button', text: { tag: 'plain_text', content: '🔄 重跑失败用例' }, type: 'default', value: { action: 'rerun_failed' } },
        { tag: 'button', text: { tag: 'plain_text', content: '✅ 批准基线' }, type: 'primary', value: { action: 'approve_baseline' } },
      ],
    });
  }

  return elements;
}
