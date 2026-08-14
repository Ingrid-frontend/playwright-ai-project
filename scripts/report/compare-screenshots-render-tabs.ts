import type { SummaryRow } from './compare-report-viz.js';

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
