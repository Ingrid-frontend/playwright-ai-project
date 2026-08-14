import {
  comparisonToUiIssue,
  mergeIssuesForDisplay,
  type UiIssue,
} from './ui-issues.js';
import { collectStructureUiIssues } from './structure-check.js';
import type { ImageComparison } from './image-diff.js';
import type { StepTrendPoint } from './ui-regression-history.js';
import { buildDiffCardHtml, type SummaryRow } from './compare-report-viz.js';
import {
  escapeHtmlAttr,
  extractStepNameFromPath,
  extractImageLabelWithRoute,
  routeFromScreenshotPath,
  type ScreenshotInfo,
} from './compare-screenshots-utils.js';

interface TestDirComparisons {
  testDir: string;
  comparisons: Array<{
    stepNumber: number;
    optimizedComparisons: Array<{
      image1Path: string;
      image2Path?: string;
      browser?: string;
      browser2?: string;
      compareKind?: string;
    }>;
    crossBrowserComparisons: Array<{
      image1Path: string;
      image2Path?: string;
      browser?: string;
      browser2?: string;
      compareKind?: string;
    }>;
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
  }
  return issues;
}

export function createDiffCardRenderer(deps: {
  getBrowserIcon: (browser: string) => string;
}): {
  renderInlineDiffThumb: (diffImagePath?: string) => string;
  generateDiffCard: (
    comparison: ImageComparison,
    type: string,
    trendPoints?: StepTrendPoint[],
  ) => string;
} {
  const { getBrowserIcon } = deps;

  function renderInlineDiffThumb(diffImagePath?: string): string {
    if (!diffImagePath) return '—';
    const src = escapeHtmlAttr(diffImagePath);
    return `<img class="issues-diff-thumb" src="${src}" alt="diff" loading="lazy" onclick="openModal('${src}')" title="点击放大">`;
  }

  function generateDiffCard(
    comparison: ImageComparison,
    _type: string,
    trendPoints?: StepTrendPoint[],
  ): string {
    const isCross = comparison.compareKind === 'cross-browser';
    const browser = isCross ? 'cross' : comparison.browser || 'unknown';
    const sizeHint = comparison.sizeMismatch
      ? '<span class="diff-size-hint" title="两张图尺寸不一致，仅对比重叠区域">尺寸不一致</span>'
      : '';
    const browserPairHint = isCross
      ? `<span class="diff-browser-pair" title="Chrome 为基线，对比 WebKit">${getBrowserIcon('chrome')} Chrome ↔ ${getBrowserIcon('webkit')} WebKit</span>`
      : '';
    const pairLabelHint = comparison.pairLabel
      ? `<span class="diff-pair-label" title="配对规则">${comparison.pairLabel}</span>`
      : '';

    const image1Label = isCross
      ? `Chrome · ${extractImageLabelWithRoute(comparison.image1Path, 1)}`
      : extractImageLabelWithRoute(comparison.image1Path, 1);
    const image2Label = isCross
      ? `WebKit · ${extractImageLabelWithRoute(comparison.image2Path, 2)}`
      : extractImageLabelWithRoute(comparison.image2Path, 2);

    return buildDiffCardHtml(comparison, {
      image1Label,
      image2Label,
      browser,
      isCross,
      pairLabelHint,
      browserPairHint,
      sizeHint,
      ctx: { trendPoints },
    });
  }

  return { renderInlineDiffThumb, generateDiffCard };
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

export function createCountHelpers(deps: {
  runDriftComparisons: (comparisons?: ImageComparison[]) => ImageComparison[];
  passesDiffOnlyTabFilter: (difference: number) => boolean;
}): {
  getRunDriftDiffCountsForScript: (tdc: TestDirComparisons) => { all: number; only: number };
  getDiffOnlyTabCountsForScript: (tdc: TestDirComparisons) => { all: number; only: number };
  getOptimizedDiffCountsForScript: (tdc: TestDirComparisons) => { all: number; only: number };
  getCrossBrowserDiffCountsForScript: (tdc: TestDirComparisons) => { all: number; only: number };
  getTotalCrossBrowserComparisons: (testDirComparisons: TestDirComparisons[]) => number;
} {
  const { runDriftComparisons, passesDiffOnlyTabFilter } = deps;

  function getRunDriftDiffCountsForScript(tdc: TestDirComparisons): { all: number; only: number } {
    const all = tdc.comparisons.reduce(
      (sum, comp) => sum + runDriftComparisons(comp.optimizedComparisons).length,
      0,
    );
    const only = tdc.comparisons.reduce(
      (sum, comp) =>
        sum +
        runDriftComparisons(comp.optimizedComparisons).filter((c) => passesDiffOnlyTabFilter(c.difference)).length,
      0,
    );
    return { all, only };
  }

  function getCrossBrowserDiffCountsForScript(tdc: TestDirComparisons): { all: number; only: number } {
    const all = tdc.comparisons.reduce((sum, comp) => sum + (comp.crossBrowserComparisons?.length || 0), 0);
    const only = tdc.comparisons.reduce(
      (sum, comp) => sum + (comp.crossBrowserComparisons?.filter((c) => passesDiffOnlyTabFilter(c.difference)).length || 0),
      0,
    );
    return { all, only };
  }

  function getDiffOnlyTabCountsForScript(tdc: TestDirComparisons): { all: number; only: number } {
    let all = 0;
    let only = 0;
    for (const comp of tdc.comparisons) {
      const items = [
        ...runDriftComparisons(comp.optimizedComparisons),
        ...(comp.baselineComparisons || []),
      ];
      all += items.length;
      only += items.filter((c) => passesDiffOnlyTabFilter(c.difference)).length;
    }
    const x = getCrossBrowserDiffCountsForScript(tdc);
    return { all: all + x.all, only: only + x.only };
  }

  function getOptimizedDiffCountsForScript(tdc: TestDirComparisons): { all: number; only: number } {
    return getRunDriftDiffCountsForScript(tdc);
  }

  function getTotalCrossBrowserComparisons(testDirComparisons: TestDirComparisons[]): number {
    return testDirComparisons.reduce(
      (sum, tdc) => sum + tdc.comparisons.reduce((s, c) => s + (c.crossBrowserComparisons?.length || 0), 0),
      0,
    );
  }

  return {
    getRunDriftDiffCountsForScript,
    getDiffOnlyTabCountsForScript,
    getOptimizedDiffCountsForScript,
    getCrossBrowserDiffCountsForScript,
    getTotalCrossBrowserComparisons,
  };
}

export function getTotalExecutions(comparisons: Array<{
  pomScreenshots: Array<{ timestamp: string }>;
  optimizedScreenshots: Array<{ timestamp: string }>;
}>, pomEnabled: boolean): number {
  const timestamps = new Set<string>();
  comparisons.forEach((comp) => {
    if (pomEnabled) {
      comp.pomScreenshots.forEach((s) => timestamps.add(s.timestamp));
    }
    comp.optimizedScreenshots.forEach((s) => timestamps.add(s.timestamp));
  });
  return timestamps.size;
}

export function getBrowserFilterLabel(browser: string): string {
  if (browser === 'cross') return '跨浏览器';
  return browser;
}

export function extractCalendarDayKey(raw: string): string | null {
  if (!raw) return null;

  const runMatch = raw.match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (runMatch) return runMatch[1];

  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]);
    const d = Number(iso[3]);
    const dt = new Date(y, mo - 1, d);
    if (!Number.isNaN(dt.getTime())) {
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
  }

  const compact = raw.match(/(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?:[^\d]|$)/);
  if (compact) {
    const y = Number(compact[1]);
    const mo = Number(compact[2]);
    const d = Number(compact[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(y, mo - 1, d);
      if (!Number.isNaN(dt.getTime())) {
        return `${compact[1]}-${compact[2]}-${compact[3]}`;
      }
    }
  }

  return null;
}

export function calendarDayKeyForScreenshot(s: ScreenshotInfo): string {
  for (const raw of [s.date, s.timestamp]) {
    if (!raw) continue;
    const key = extractCalendarDayKey(String(raw));
    if (key) return key;
  }
  const fallback = String(s.date || s.timestamp || 'unknown');
  return `__unparsed__${fallback}`;
}

export function formatDateGroupTitle(groupKey: string): string {
  if (groupKey.startsWith('__unparsed__')) {
    const raw = groupKey.slice('__unparsed__'.length);
    return raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const iso = groupKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return `${iso[2]}${iso[3]}`;
  }

  return groupKey
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function groupScreenshotsByDate(screenshots: ScreenshotInfo[]): Map<string, ScreenshotInfo[]> {
  const grouped = new Map<string, ScreenshotInfo[]>();
  screenshots.forEach((screenshot) => {
    const key = calendarDayKeyForScreenshot(screenshot);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(screenshot);
  });
  return grouped;
}

export function generateDateGroup(date: string, screenshots: ScreenshotInfo[]): string {
  const sortedScreenshots = [...screenshots].sort((a, b) => {
    return a.displayTimestamp.localeCompare(b.displayTimestamp);
  });
  return `
  <div class="date-group">
    <div class="date-title">${formatDateGroupTitle(date)}</div>
    <div class="screenshot-grid">
      ${sortedScreenshots.map((s) => generateScreenshotCard(s)).join('')}
    </div>
  </div>`;
}

export function generateScreenshotCard(screenshot: ScreenshotInfo): string {
  return `
  <div class="screenshot-card">
    <div class="screenshot-time">${screenshot.displayTimestamp}</div>
    <img class="screenshot-image" src="${screenshot.relativePath}" alt="${screenshot.stepName}" loading="lazy" onclick="openModal('${screenshot.relativePath}')">
  </div>`;
}

export function groupImageComparisonsByCalendarDay(
  comparisons: ImageComparison[],
): Map<string, ImageComparison[]> {
  const grouped = new Map<string, ImageComparison[]>();
  comparisons.forEach((c) => {
    const key =
      extractCalendarDayKey(c.image1Path) ||
      extractCalendarDayKey(c.image2Path) ||
      '__unparsed__其他';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(c);
  });
  return grouped;
}

/** 同一步骤下多张子图：before 先于 after（文件名后缀 -before / -after） */
export function compareScreenshotSubsectionNames(a: string, b: string): number {
  const aBefore = a.endsWith('-before');
  const bBefore = b.endsWith('-before');
  const aAfter = a.endsWith('-after');
  const bAfter = b.endsWith('-after');
  if (aBefore && bAfter) return -1;
  if (aAfter && bBefore) return 1;
  if (a.startsWith('before') && !b.startsWith('before')) return -1;
  if (!a.startsWith('before') && b.startsWith('before')) return 1;
  return a.localeCompare(b, 'zh-CN');
}

export function groupScreenshotsByBrowser(screenshots: ScreenshotInfo[]): Map<string, ScreenshotInfo[]> {
  const grouped = new Map<string, ScreenshotInfo[]>();
  screenshots.forEach((screenshot) => {
    const browser = screenshot.browser || 'unknown';
    if (browser === 'firefox') {
      return;
    }
    if (!grouped.has(browser)) {
      grouped.set(browser, []);
    }
    grouped.get(browser)!.push(screenshot);
  });
  return grouped;
}

export function createScreenshotSectionRenderer(deps: {
  getMenuNameByRoute: (route: string) => string;
}): {
  generateOptimizedStep: (
    comp: {
      stepNumber: number;
      stepName?: string;
      optimizedScreenshots: ScreenshotInfo[];
    },
    dirName: string,
  ) => string;
} {
  const { getMenuNameByRoute } = deps;

  function generateBrowserContent(browser: string, screenshots: ScreenshotInfo[], dirName: string): string {
    const groupedByDate = groupScreenshotsByDate(screenshots);
    const dateGroups = Array.from(groupedByDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return `
  <div class="browser-content-inner">
    ${dateGroups.map(([date, dateScreenshots]) => generateDateGroup(date, dateScreenshots)).join('')}
  </div>`;
  }

  function generateSection(title: string, screenshots: ScreenshotInfo[], dirName: string): string {
    if (screenshots.length === 0) {
      return `
    <div class="section">
      <div class="no-screenshots">暂无截图</div>
    </div>`;
    }

    const groupedByBrowser = groupScreenshotsByBrowser(screenshots);
    const browserGroups = Array.from(groupedByBrowser.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const availCsv = browserGroups.map(([b]) => b).join(',');

    return `
  <div class="section" data-available-browsers="${availCsv}">
    ${browserGroups.map(([browser, browserScreenshots]) => `
      <div class="browser-content-section ${browser === 'chrome' ? 'active' : ''}" data-browser="${browser}" data-count="${browserScreenshots.length}">
        ${generateBrowserContent(browser, browserScreenshots, dirName)}
      </div>
    `).join('')}
    <div class="optimized-browser-empty-state" style="display: none;">
      <div class="no-screenshots optimized-browser-empty-inner"></div>
    </div>
  </div>`;
  }

  function generateStepSection(stepNumber: number, stepName: string | undefined, title: string, screenshots: ScreenshotInfo[], dirName: string): string {
    const groupedByStepName = new Map<string, ScreenshotInfo[]>();
    screenshots.forEach((screenshot) => {
      const name = screenshot.stepName;
      if (!groupedByStepName.has(name)) {
        groupedByStepName.set(name, []);
      }
      groupedByStepName.get(name)!.push(screenshot);
    });

    const stepNames = Array.from(groupedByStepName.keys()).sort(compareScreenshotSubsectionNames);
    const totalScreenshots = screenshots.length;

    return `
  <div class="comparison" data-step="${stepNumber}">
    <div class="comparison-header" onclick="toggleStep(${stepNumber})" role="button" tabindex="0" title="点击折叠/展开">
      <h2>
        步骤 ${stepNumber}
      </h2>
      <span class="screenshot-badge">${totalScreenshots}张</span>
    </div>
    <div class="comparison-body" id="step-body-${stepNumber}">
      ${stepNames.map((name) => {
        const nameScreenshots = groupedByStepName.get(name)!;
        const nameTotal = nameScreenshots.length;
        const route = nameScreenshots[0]?.route || '';
        const menuName = route ? getMenuNameByRoute(route) : '';
        const routeDisplay = menuName ? menuName : (route ? `/${route.replace(/_/g, '/')}` : '');
        const routeInfo = routeDisplay ? `<span class="route-info">📍 ${routeDisplay}</span>` : '';
        return `
        <div class="step-subsection" data-screenshot-total="${nameTotal}">
          <div class="step-subsection-header">
            <h3>${name}</h3>
            <span class="screenshot-badge subsection-count">${nameTotal}张</span>
            ${routeInfo}
          </div>
          ${generateSection(title, nameScreenshots, dirName)}
        </div>
        `;
      }).join('')}
    </div>
  </div>`;
  }

  function generateOptimizedStep(
    comp: {
      stepNumber: number;
      stepName?: string;
      optimizedScreenshots: ScreenshotInfo[];
    },
    dirName: string,
  ): string {
    return generateStepSection(comp.stepNumber, comp.stepName, 'Optimized 版本', comp.optimizedScreenshots, dirName);
  }

  return { generateOptimizedStep };
}

export function createDiffStepRenderer(deps: {
  runDriftComparisons: (comparisons?: ImageComparison[]) => ImageComparison[];
  passesDiffOnlyTabFilter: (difference: number) => boolean;
  extractStepNameFromPath: (imagePath: string) => string;
  compareScreenshotSubsectionNames: (a: string, b: string) => number;
  groupImageComparisonsByCalendarDay: (comparisons: ImageComparison[]) => Map<string, ImageComparison[]>;
  formatDateGroupTitle: (groupKey: string) => string;
  generateDiffCard: (
    comparison: ImageComparison,
    type: string,
    trendPoints?: StepTrendPoint[],
  ) => string;
  getCurrentStepTrends: (key: string) => StepTrendPoint[] | undefined;
}): {
  generateDiffStep: (
    comp: {
      stepNumber: number;
      pomComparisons: ImageComparison[];
      optimizedComparisons: ImageComparison[];
      baselineComparisons?: ImageComparison[];
      testDir?: string;
    },
    type: 'pom' | 'optimized' | 'all',
    onlyDiffs?: boolean,
  ) => string;
  generateCrossBrowserDiffStep: (
    comp: {
      stepNumber: number;
      crossBrowserComparisons: ImageComparison[];
      testDir?: string;
    },
    onlyDiffs?: boolean,
  ) => string;
} {
  const {
    runDriftComparisons,
    passesDiffOnlyTabFilter,
    extractStepNameFromPath,
    compareScreenshotSubsectionNames,
    groupImageComparisonsByCalendarDay,
    formatDateGroupTitle,
    generateDiffCard,
    getCurrentStepTrends,
  } = deps;

  function generateDiffStepFromComparisons(
    comp: {
      stepNumber: number;
      testDir?: string;
    },
    comparisons: ImageComparison[],
    onlyDiffs = false,
    cardType = '',
  ): string {
    if (comparisons.length === 0) return '';

    const groupedByStepName = new Map<string, ImageComparison[]>();
    comparisons.forEach((comp) => {
      const stepName = extractStepNameFromPath(comp.image1Path);
      if (!groupedByStepName.has(stepName)) {
        groupedByStepName.set(stepName, []);
      }
      groupedByStepName.get(stepName)!.push(comp);
    });

    const sortedStepNames = Array.from(groupedByStepName.keys()).sort(compareScreenshotSubsectionNames);
    const stepsToDisplay = sortedStepNames.map((stepName) => {
      const comps = groupedByStepName.get(stepName)!;
      const diffComps = onlyDiffs ? comps.filter((c) => passesDiffOnlyTabFilter(c.difference)) : comps;
      const hasDiffs = onlyDiffs
        ? comps.some((c) => passesDiffOnlyTabFilter(c.difference))
        : comps.length > 0;
      return { stepName, diffComps, hasDiffs };
    });

    if (onlyDiffs && stepsToDisplay.every((s) => !s.hasDiffs)) return '';
    const stepsWithContent = stepsToDisplay.filter((s) => s.diffComps.length > 0);
    if (stepsWithContent.length === 0) return '';

    return `
  <div class="comparison">
    <div class="comparison-header">
      <h2>
        步骤 ${comp.stepNumber}
      </h2>
    </div>
    <div class="comparison-body">
      ${stepsWithContent.map(({ stepName, diffComps }) => {
        const byDate = groupImageComparisonsByCalendarDay(diffComps);
        const dateEntries = Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        return `
        <div class="diff-step-group">
          <div class="diff-step-name">${stepName}</div>
          ${dateEntries
            .map(
              ([dateKey, comps]) => `
          <div class="date-group">
            <div class="date-title">${formatDateGroupTitle(dateKey)}</div>
            <div class="diff-grid">
              ${comps.map((c) => {
                const trendKey = `${comp.testDir}|${comp.stepNumber}|${stepName}`;
                return generateDiffCard(c, cardType, getCurrentStepTrends(trendKey));
              }).join('')}
            </div>
          </div>`,
            )
            .join('')}
        </div>
        `;
      }).join('')}
    </div>
  </div>`;
  }

  function generateDiffStep(
    comp: {
      stepNumber: number;
      pomComparisons: ImageComparison[];
      optimizedComparisons: ImageComparison[];
      baselineComparisons?: ImageComparison[];
      testDir?: string;
    },
    type: 'pom' | 'optimized' | 'all',
    onlyDiffs = false,
  ): string {
    const comparisons =
      type === 'pom'
        ? comp.pomComparisons
        : type === 'optimized'
          ? runDriftComparisons(comp.optimizedComparisons)
          : [
              ...comp.pomComparisons,
              ...runDriftComparisons(comp.optimizedComparisons),
              ...(comp.baselineComparisons || []),
            ];
    return generateDiffStepFromComparisons(comp, comparisons, onlyDiffs, type);
  }

  function generateCrossBrowserDiffStep(
    comp: {
      stepNumber: number;
      crossBrowserComparisons: ImageComparison[];
      testDir?: string;
    },
    onlyDiffs = false,
  ): string {
    return generateDiffStepFromComparisons(comp, comp.crossBrowserComparisons, onlyDiffs, 'cross-browser');
  }

  return { generateDiffStep, generateCrossBrowserDiffStep };
}

export function stripScriptTimestamp(name: string): string {
  return name.replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/, '');
}

export function scriptTabDisambiguatorSuffix(rawName: string, base: string): string {
  if (rawName === base) return rawName;
  if (rawName.startsWith(base)) {
    const rest = rawName.slice(base.length).replace(/^_+/, '');
    return rest || rawName;
  }
  return rawName;
}

export function formatScriptTabDisambiguatorSuffix(suffix: string): string {
  const m = suffix.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(.*)$/);
  if (!m) return suffix;
  const [, y, mo, d, h, mi, s, rest] = m;
  const compact = `${y.slice(2)}${mo}${d}_${h}:${mi}:${s}`;
  return rest ? `${compact}${rest}` : compact;
}

export function buildScriptTabs<T extends { testDir: string }>(
  iter: string,
  iterationMap: Map<string, T[]>,
): string {
  const scripts = iterationMap.get(iter) || [];
  const baseCount = new Map<string, number>();
  for (const tdc of scripts) {
    const rawName = String(tdc.testDir);
    const base = stripScriptTimestamp(rawName);
    baseCount.set(base, (baseCount.get(base) || 0) + 1);
  }
  return scripts
    .map((tdc, index) => {
      const rawName = String(tdc.testDir);
      const base = stripScriptTimestamp(rawName);
      const collide = (baseCount.get(base) || 0) > 1;
      const rawSuffix = scriptTabDisambiguatorSuffix(rawName, base);
      const compactSuffix = formatScriptTabDisambiguatorSuffix(rawSuffix);
      const hasDateTimeSuffix = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/.test(rawSuffix);
      const display =
        collide || hasDateTimeSuffix ? `${base} · ${compactSuffix}` : base;
      return `
      <button class="script-tab ${index === 0 ? 'active' : ''}" data-iteration="${iter}" data-script="${rawName}" onclick="switchScript('${iter}', '${rawName}')" title="${iter}/${rawName}">
        <span>${display}</span>
      </button>
    `;
    })
    .join('');
}

export function buildScriptContents<T extends { testDir: string }>(
  iter: string,
  render: (tdc: T) => string,
  extraAttrs: ((tdc: T) => string) | undefined,
  iterationMap: Map<string, T[]>,
): string {
  const scripts = iterationMap.get(iter) || [];
  const firstScript = scripts[0]?.testDir;
  return scripts
    .map((tdc) => `
      <div class="script-content" data-iteration="${iter}" data-script="${tdc.testDir}" ${tdc.testDir === firstScript ? '' : 'style="display: none;"'} ${extraAttrs ? extraAttrs(tdc) : ''}>
        ${render(tdc)}
      </div>
    `)
    .join('');
}

export function buildIterationMap<T extends { testDir: string }>(
  testDirComparisons: T[],
): Map<string, T[]> {
  const iterationMap = new Map<string, T[]>();
  for (const tdc of testDirComparisons) {
    const [iteration, ...rest] = String(tdc.testDir).split('/');
    const iter = iteration || 'unknown-iteration';
    const script = rest.join('/') || tdc.testDir;
    if (!iterationMap.has(iter)) iterationMap.set(iter, []);
    iterationMap.get(iter)!.push({ ...tdc, testDir: script });
  }
  return iterationMap;
}

export function sortIterationScripts<T extends { testDir: string }>(
  iterationMap: Map<string, T[]>,
  scriptDirTimestampMs: (scriptDir: string) => number,
): void {
  for (const scripts of iterationMap.values()) {
    scripts.sort((a, b) => {
      const ta = scriptDirTimestampMs(String(a.testDir));
      const tb = scriptDirTimestampMs(String(b.testDir));
      const ka = ta > 0 ? ta : Number.POSITIVE_INFINITY;
      const kb = tb > 0 ? tb : Number.POSITIVE_INFINITY;
      if (ka !== kb) return ka - kb;
      return String(a.testDir).localeCompare(String(b.testDir), 'zh-CN');
    });
  }
}

export function buildSummaryRows(
  testDirComparisons: any[],
  extractStepNameFromPath: (imagePath: string) => string,
): SummaryRow[] {
  const summaryRows: SummaryRow[] = [];
  for (const tdc of testDirComparisons) {
    for (const comp of tdc.comparisons) {
      for (const c of [...comp.optimizedComparisons, ...comp.crossBrowserComparisons]) {
        const shotPath = c.image2Path || c.image1Path;
        const stepName = extractStepNameFromPath(shotPath);
        const diff = c.difference;
        const severity = diff >= 0.005 ? 'blocker' : diff >= 0.001 ? 'warning' : 'noise';
        summaryRows.push({
          script: tdc.testDir,
          step: comp.stepNumber,
          stepName,
          browser: c.browser || c.browser2 || 'chrome',
          compareKind: c.compareKind || 'same-browser',
          difference: diff,
          severity,
        });
      }
    }
  }
  return summaryRows;
}
