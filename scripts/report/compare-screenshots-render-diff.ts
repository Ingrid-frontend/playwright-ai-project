import type { ImageComparison } from './image-diff.js';
import type { StepTrendPoint } from './ui-regression-history.js';
import { buildDiffCardHtml } from './compare-report-viz.js';
import {
  escapeHtmlAttr,
  extractImageLabelWithRoute,
  type ScreenshotInfo,
} from './compare-screenshots-utils.js';
import {
  compareScreenshotSubsectionNames,
  generateDateGroup,
  groupScreenshotsByBrowser,
  groupScreenshotsByDate,
} from './compare-screenshots-render-date.js';

interface TestDirComparisons {
  testDir: string;
  comparisons: Array<{
    optimizedComparisons: ImageComparison[];
    crossBrowserComparisons: ImageComparison[];
    baselineComparisons?: ImageComparison[];
  }>;
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

  function generateBrowserContent(browser: string, screenshots: ScreenshotInfo[]): string {
    const groupedByDate = groupScreenshotsByDate(screenshots);
    const dateGroups = Array.from(groupedByDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return `
  <div class="browser-content-inner">
    ${dateGroups.map(([date, dateScreenshots]) => generateDateGroup(date, dateScreenshots)).join('')}
  </div>`;
  }

  function generateSection(title: string, screenshots: ScreenshotInfo[]): string {
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
        ${generateBrowserContent(browser, browserScreenshots)}
      </div>
    `).join('')}
    <div class="optimized-browser-empty-state" style="display: none;">
      <div class="no-screenshots optimized-browser-empty-inner"></div>
    </div>
  </div>`;
  }

  function generateStepSection(stepNumber: number, stepName: string | undefined, title: string, screenshots: ScreenshotInfo[]): string {
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
          ${generateSection(title, nameScreenshots)}
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
    void dirName;
    return generateStepSection(comp.stepNumber, comp.stepName, 'Optimized 版本', comp.optimizedScreenshots);
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
