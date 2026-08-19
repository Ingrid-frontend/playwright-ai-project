import {
  comparisonToUiIssue,
  mergeIssuesForDisplay,
  type UiIssue,
} from './ui-issues.js';
import type { ImageComparison } from './image-diff.js';
import { collectStructureUiIssues } from './structure-check.js';
import { collectStyleDriftUiIssues } from './style-drift-check.js';
import {
  extractStepNameFromPath,
  routeFromScreenshotPath,
} from './compare-screenshots-utils.js';

interface TestDirComparisons {
  testDir: string;
  comparisons: Array<{
    stepNumber: number;
    optimizedComparisons: ImageComparison[];
    crossBrowserComparisons: ImageComparison[];
    optimizedScreenshots: Array<{
      path: string;
      stepName: string;
      browser?: string;
      route?: string;
      timestamp: string;
    }>;
  }>;
}

export function collectAllUiIssues(testDirComparisons: TestDirComparisons[]): UiIssue[] {
  const issues: UiIssue[] = [];
  for (const tdc of testDirComparisons) {
    const structureShots: Array<{
      path: string;
      stepNumber: number;
      stepName: string;
      browser?: string;
      route?: string;
      timestamp: string;
    }> = [];

    for (const comp of tdc.comparisons) {
      const comparisons = [...comp.optimizedComparisons, ...comp.crossBrowserComparisons];
      for (const c of comparisons) {
        const shotPath = c.image2Path || c.image1Path;
        const stepName = extractStepNameFromPath(shotPath);
        const route = routeFromScreenshotPath(shotPath);
        const issue = comparisonToUiIssue(c, {
          scriptKey: tdc.testDir,
          stepNumber: comp.stepNumber,
          stepName,
          browser: c.browser || c.browser2 || 'chrome',
          route,
        });
        if (issue) issues.push(issue);
      }

      for (const s of comp.optimizedScreenshots) {
        structureShots.push({
          path: s.path,
          stepNumber: comp.stepNumber,
          stepName: s.stepName,
          browser: s.browser,
          route: s.route,
          timestamp: s.timestamp,
        });
      }
    }

    issues.push(...collectStructureUiIssues(tdc.testDir, structureShots));
    issues.push(...collectStyleDriftUiIssues(tdc.testDir, structureShots));
  }
  return issues;
}

export function generateIssuesTabHtml(
  issues: UiIssue[],
  deps: {
    isCompareCrossBrowserEnabled: () => boolean;
    renderInlineDiffThumb: (diffImagePath?: string) => string;
  },
): string {
  const { isCompareCrossBrowserEnabled, renderInlineDiffThumb } = deps;
  const crossBrowserOn = isCompareCrossBrowserEnabled();
  if (issues.length === 0) {
    return `
    <div class="empty-state">
      <div class="empty-state-icon">✅</div>
      <div class="empty-state-title">未发现需关注的 UI 问题</div>
      <div class="empty-state-description">当前阈值下无 blocker / warning 项。</div>
    </div>`;
  }

  const merged = mergeIssuesForDisplay(issues);
  const rows = merged
    .map((issue) => {
      const diffCell = renderInlineDiffThumb(issue.diffImagePath);
      const pct = (issue.difference * 100).toFixed(3);
      const countCell =
        issue.rawCount > 1
          ? `<span class="issues-raw-count" title="同日多次运行产生的重复对比已合并">${issue.rawCount}</span>`
          : '1';
      return `<tr class="issues-filter-row" data-severity="${issue.severity}" data-kind="${issue.compareKind}" data-browser="${issue.browser}"
        data-sort-severity="${issue.severity === 'blocker' ? '3' : issue.severity === 'warning' ? '2' : '1'}"
        data-sort-kind="${issue.compareKind}"
        data-sort-script="${issue.scriptKey}"
        data-sort-step="${issue.stepNumber}"
        data-sort-stepName="${issue.stepName}"
        data-sort-browser="${issue.browser}"
        data-sort-diff="${issue.difference}"
        data-sort-count="${issue.rawCount}">
        <td><span class="severity-badge severity-${issue.severity}">${issue.severity}</span></td>
        <td>${issue.compareKind}</td>
        <td>${issue.scriptKey}</td>
        <td>${issue.stepNumber}</td>
        <td>${issue.stepName}</td>
        <td>${issue.browser}</td>
        <td>${pct}%</td>
        <td>${countCell}</td>
        <td>${diffCell}</td>
      </tr>`;
    })
    .join('');

  const deduped = issues.length - merged.length;
  const dedupeNote =
    deduped > 0
      ? ` · 已合并 <strong>${deduped}</strong> 条重复（原始 ${issues.length} 条）`
      : '';

  return `
    <div class="issues-summary">
      <p>共 <strong id="issues-visible-count">${merged.length}</strong> 项<span id="issues-dedupe-note">${dedupeNote}</span><span id="issues-filter-note"></span> · blocker: <strong id="issues-blocker-count">${merged.filter((i) => i.severity === 'blocker').length}</strong> · warning: <strong id="issues-warning-count">${merged.filter((i) => i.severity === 'warning').length}</strong></p>
      <p class="issues-hint">结构化清单见 <code>results/ui-issues.json</code>（含未合并原始条数）· 随上方「浏览器」筛选联动${crossBrowserOn ? ' · 跨浏览器差异展示最高为 warning' : ''}</p>
    </div>
    <div class="empty-state issues-browser-empty" id="issues-browser-empty" style="display: none;">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-title">当前浏览器筛选下暂无问题</div>
      <div class="empty-state-description">可切换 chrome、webkit${crossBrowserOn ? ' 或「跨浏览器」' : ''}查看其他对比类型。</div>
    </div>
    <table class="issues-table" id="issues-table">
      <thead>
        <tr>
          <th data-sort="severity" onclick="sortIssues('severity')">严重度<span class="sort-arrow active">↓</span></th>
          <th data-sort="kind" onclick="sortIssues('kind')">类型<span class="sort-arrow">↕</span></th>
          <th data-sort="script" onclick="sortIssues('script')">脚本<span class="sort-arrow">↕</span></th>
          <th data-sort="step" onclick="sortIssues('step')">步骤<span class="sort-arrow">↕</span></th>
          <th data-sort="stepName" onclick="sortIssues('stepName')">步骤名<span class="sort-arrow">↕</span></th>
          <th data-sort="browser" onclick="sortIssues('browser')">浏览器<span class="sort-arrow">↕</span></th>
          <th data-sort="diff" onclick="sortIssues('diff')">差异<span class="sort-arrow">↕</span></th>
          <th data-sort="count" onclick="sortIssues('count')">条数<span class="sort-arrow">↕</span></th>
          <th>Diff</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}
