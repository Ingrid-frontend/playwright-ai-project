import type { UiIssue, UiIssueCompareKind, UiIssuesReport, UiIssueSeverity } from './ui-issues.js';

export interface MergedStepIssue {
  scriptKey: string;
  stepNumber: number;
  stepLabel: string;
  maxDifference: number;
  maxDifferencePct: string;
  severity: UiIssueSeverity;
  browsers: string[];
  compareKinds: UiIssueCompareKind[];
  compareKindLabels: string[];
  rawCount: number;
  diffImagePath?: string;
  sizeMismatch: boolean;
  hint: string;
}

export interface ScriptAnalysisBlock {
  scriptKey: string;
  flowSummary: string;
  mergedSteps: MergedStepIssue[];
  blockerCount: number;
  warningCount: number;
  suggestions: string[];
}

export interface PlainLanguageAnalysis {
  generatedAt: string;
  markdown: string;
  html: string;
  overview: {
    rawIssueCount: number;
    mergedRowCount: number;
    blocker: number;
    warning: number;
    scriptCount: number;
    dedupeNote: string;
  };
  scripts: ScriptAnalysisBlock[];
}

const COMPARE_KIND_ZH: Record<UiIssueCompareKind, string> = {
  golden: 'Golden 基线',
  'last-green': '上次通过',
  'run-drift': '运行间对比',
  'cross-browser': '跨浏览器',
};

const SEVERITY_ORDER: Record<UiIssueSeverity, number> = {
  blocker: 3,
  warning: 2,
  noise: 1,
};

function normalizeStepLabel(stepName: string): string {
  return stepName
    .replace(/-before$/i, '')
    .replace(/-after$/i, '')
    .replace(/-skipped$/i, '')
    .trim();
}

function mergeKey(issue: UiIssue): string {
  return `${issue.scriptKey}|${issue.stepNumber}|${normalizeStepLabel(issue.stepName)}`;
}

function worstSeverity(a: UiIssueSeverity, b: UiIssueSeverity): UiIssueSeverity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

function stepHint(stepNumber: number, label: string): string {
  const l = label.toLowerCase();
  if (stepNumber === 1 || l.includes('导航') || l.includes('首页')) {
    return '多为首页动态区（待办、公告、时间等）';
  }
  if (l.includes('申请') || l.includes('列表') || l.includes('表格') || /^\d+$/.test(label)) {
    return '多为 iframe 内列表/表格数据或选中态';
  }
  if (l.includes('工作台') || l.includes('tab')) {
    return '多为 Tab 切换或 iframe 首屏';
  }
  return '请结合 diff 图查看红区位置';
}

function buildFlowSummary(steps: MergedStepIssue[]): string {
  const labels = [...new Map(steps.map((s) => [s.stepNumber, s.stepLabel])).entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, label]) => label);
  if (labels.length === 0) return '（未能解析步骤）';
  return labels.join(' → ');
}

function scriptSuggestions(
  script: ScriptAnalysisBlock,
  summary: UiIssuesReport['summary'],
): string[] {
  const tips: string[] = [];
  const kinds = new Set(script.mergedSteps.flatMap((s) => s.compareKinds));
  const top = script.mergedSteps.filter((s) => s.severity === 'blocker').slice(0, 2);

  if (kinds.has('run-drift') && !kinds.has('golden')) {
    tips.push('未检测到 Golden 对比：blocker 可能来自两次运行差异，建议确认正确界面后 promote Golden。');
  }
  if (top.length) {
    tips.push(`优先查看步骤 ${top.map((t) => `${t.stepNumber}（${t.stepLabel}）`).join('、')} 的 diff 图。`);
  }
  if ((summary.byCompareKind?.['cross-browser'] || 0) > 0) {
    tips.push('含跨浏览器差异：若仅关心 Chrome，可单独查看 chrome 行或关闭跨浏览器对比。');
  }
  return tips.slice(0, 3);
}

function mergeIssuesForScript(scriptKey: string, issues: UiIssue[]): MergedStepIssue[] {
  const groups = new Map<string, UiIssue[]>();
  for (const issue of issues) {
    const key = mergeKey(issue);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(issue);
  }

  const merged: MergedStepIssue[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const stepLabel = normalizeStepLabel(first.stepName);
    let maxDifference = 0;
    let severity: UiIssueSeverity = 'noise';
    let diffImagePath: string | undefined;
    let sizeMismatch = false;
    const browsers = new Set<string>();
    const compareKinds = new Set<UiIssueCompareKind>();

    for (const i of group) {
      if (i.difference > maxDifference) {
        maxDifference = i.difference;
        diffImagePath = i.diffImagePath;
      }
      severity = worstSeverity(severity, i.severity);
      if (i.sizeMismatch) sizeMismatch = true;
      browsers.add(i.browser);
      compareKinds.add(i.compareKind);
    }

    merged.push({
      scriptKey,
      stepNumber: first.stepNumber,
      stepLabel,
      maxDifference,
      maxDifferencePct: (maxDifference * 100).toFixed(2),
      severity,
      browsers: [...browsers].sort(),
      compareKinds: [...compareKinds],
      compareKindLabels: [...compareKinds].map((k) => COMPARE_KIND_ZH[k]),
      rawCount: group.length,
      diffImagePath,
      sizeMismatch,
      hint: stepHint(first.stepNumber, stepLabel),
    });
  }

  return merged.sort((a, b) => b.maxDifference - a.maxDifference);
}

function renderScriptTableHtml(script: ScriptAnalysisBlock): string {
  if (script.mergedSteps.length === 0) {
    return '<p class="analysis-hint">本脚本无 blocker / warning。</p>';
  }
  const rows = script.mergedSteps
    .map((row) => {
      const diff = row.diffImagePath
        ? `<a href="${row.diffImagePath}" target="_blank" rel="noopener">查看</a>`
        : '—';
      const sev = `<span class="severity-badge severity-${row.severity}">${row.severity}</span>`;
      return `<tr>
        <td>${sev}</td>
        <td>${row.stepNumber}</td>
        <td>${escapeHtml(row.stepLabel)}</td>
        <td><strong>${row.maxDifferencePct}%</strong></td>
        <td>${row.rawCount}</td>
        <td>${escapeHtml(row.browsers.join('、'))}</td>
        <td>${escapeHtml(row.compareKindLabels.join('、'))}</td>
        <td>${escapeHtml(row.hint)}</td>
        <td>${diff}</td>
      </tr>`;
    })
    .join('');

  return `
    <h4 class="analysis-script-title">${escapeHtml(script.scriptKey)}</h4>
    <p class="analysis-flow">流程：<strong>${escapeHtml(script.flowSummary)}</strong></p>
    <p class="analysis-meta">合并后 ${script.mergedSteps.length} 项 · blocker ${script.blockerCount} · warning ${script.warningCount}</p>
    <table class="issues-table analysis-table">
      <thead>
        <tr>
          <th>级别</th><th>步</th><th>步骤</th><th>最大差异</th><th>原始条数</th>
          <th>浏览器</th><th>对比类型</th><th>可能原因</th><th>Diff</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${script.suggestions.length ? `<ul class="analysis-suggestions">${script.suggestions.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(analysis: PlainLanguageAnalysis): string {
  const lines: string[] = [
    '# UI 对比分析摘要',
    '',
    `生成时间：${analysis.generatedAt}`,
    '',
    '## 总览',
    '',
    `| 指标 | 数值 |`,
    `|------|------|`,
    `| 原始问题条数 | ${analysis.overview.rawIssueCount} |`,
    `| 合并后行数 | ${analysis.overview.mergedRowCount} |`,
    `| blocker | ${analysis.overview.blocker} |`,
    `| warning | ${analysis.overview.warning} |`,
    `| 涉及脚本 | ${analysis.overview.scriptCount} |`,
    '',
    analysis.overview.dedupeNote,
    '',
  ];

  for (const script of analysis.scripts) {
    lines.push(`## ${script.scriptKey}`, '', `**流程**：${script.flowSummary}`, '');
    if (script.mergedSteps.length === 0) {
      lines.push('无 blocker / warning。', '');
      continue;
    }
    lines.push(
      '| 级别 | 步 | 步骤 | 最大差异 | 原始条数 | 浏览器 | 对比类型 |',
      '|------|-----|------|----------|----------|--------|----------|',
    );
    for (const row of script.mergedSteps) {
      lines.push(
        `| ${row.severity} | ${row.stepNumber} | ${row.stepLabel} | ${row.maxDifferencePct}% | ${row.rawCount} | ${row.browsers.join('、')} | ${row.compareKindLabels.join('、')} |`,
      );
    }
    lines.push('');
    if (script.suggestions.length) {
      lines.push('**建议**：', ...script.suggestions.map((s) => `- ${s}`), '');
    }
  }

  return lines.join('\n');
}

export function buildPlainLanguageAnalysis(report: UiIssuesReport): PlainLanguageAnalysis {
  const focusIssues = report.issues.filter((i) => i.severity === 'blocker' || i.severity === 'warning');
  const byScript = new Map<string, UiIssue[]>();
  for (const issue of focusIssues) {
    if (!byScript.has(issue.scriptKey)) byScript.set(issue.scriptKey, []);
    byScript.get(issue.scriptKey)!.push(issue);
  }

  const scripts: ScriptAnalysisBlock[] = [];
  let mergedRowCount = 0;
  let mergedBlocker = 0;
  let mergedWarning = 0;

  for (const [scriptKey, issues] of [...byScript.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], 'zh-CN'),
  )) {
    const mergedSteps = mergeIssuesForScript(scriptKey, issues);
    mergedRowCount += mergedSteps.length;
    mergedBlocker += mergedSteps.filter((s) => s.severity === 'blocker').length;
    mergedWarning += mergedSteps.filter((s) => s.severity === 'warning').length;

    const block: ScriptAnalysisBlock = {
      scriptKey,
      flowSummary: buildFlowSummary(mergedSteps),
      mergedSteps,
      blockerCount: mergedSteps.filter((s) => s.severity === 'blocker').length,
      warningCount: mergedSteps.filter((s) => s.severity === 'warning').length,
      suggestions: [],
    };
    block.suggestions = scriptSuggestions(block, report.summary);
    scripts.push(block);
  }

  const overview = {
    rawIssueCount: focusIssues.length,
    mergedRowCount,
    blocker: mergedBlocker,
    warning: mergedWarning,
    scriptCount: scripts.length,
    dedupeNote:
      '说明：下表按「脚本 + 步骤 + 步骤名」合并；「原始条数」为合并前的对比条数（含多浏览器、多对比类型）。',
  };

  const analysis: PlainLanguageAnalysis = {
    generatedAt: report.generatedAt,
    markdown: '',
    html: '',
    overview,
    scripts,
  };

  analysis.markdown = renderMarkdown(analysis);
  analysis.html = generateAnalysisTabHtml(analysis);
  return analysis;
}

export function generateAnalysisTabHtml(analysis: PlainLanguageAnalysis): string {
  if (analysis.overview.rawIssueCount === 0) {
    return `
    <div class="empty-state">
      <div class="empty-state-icon">✅</div>
      <div class="empty-state-title">暂无需要关注的差异</div>
      <div class="empty-state-description">当前阈值下无 blocker / warning。</div>
    </div>`;
  }

  const overviewTable = `
    <table class="issues-table analysis-table analysis-overview-table">
      <tbody>
        <tr><th>原始条数</th><td>${analysis.overview.rawIssueCount}</td><th>合并后</th><td>${analysis.overview.mergedRowCount}</td></tr>
        <tr><th>blocker（合并）</th><td>${analysis.overview.blocker}</td><th>warning（合并）</th><td>${analysis.overview.warning}</td></tr>
        <tr><th>脚本数</th><td colspan="3">${analysis.overview.scriptCount}</td></tr>
      </tbody>
    </table>
    <p class="analysis-hint">${escapeHtml(analysis.overview.dedupeNote)}</p>`;

  const scriptsHtml = analysis.scripts.map(renderScriptTableHtml).join('');

  return `
    <div class="analysis-wrap">
      <h3 class="analysis-heading">总览</h3>
      ${overviewTable}
      <h3 class="analysis-heading">分脚本（已合并重复）</h3>
      ${scriptsHtml}
    </div>`;
}
