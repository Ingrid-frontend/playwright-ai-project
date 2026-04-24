import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { compareImagesWithDiff, formatDifference, getDifferenceColor, getDifferenceLabel, ImageComparison } from './image-diff.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ScreenshotInfo {
  path: string;
  relativePath: string;
  timestamp: string;
  date: string;
  displayTimestamp: string;
  type: 'pom' | 'optimized';
  stepName: string;
  browser?: string;
  route?: string;
}

const POM_ENABLED = process.env.ENABLE_POM === '1';

/**
 * 「有差异」Tab：默认仅展示差异比例 ≥ 0.3%（difference ≥ 0.003）的对比。
 * 低于约 0.3% 的像素差在整页截图上通常可忽略，故不收录；更严/更松可用 PLAYWRIGHT_DIFF_ONLY_TAB_MIN_RATIO。
 * 设为 0 则任意 difference>0 都进该 Tab。
 */
const DIFF_ONLY_TAB_MIN_RATIO = (() => {
  const v = process.env.PLAYWRIGHT_DIFF_ONLY_TAB_MIN_RATIO;
  if (v !== undefined && v !== '' && !Number.isNaN(Number.parseFloat(v))) {
    return Number.parseFloat(v);
  }
  return 0.003;
})();

function passesDiffOnlyTabFilter(difference: number): boolean {
  if (!(difference > 0)) return false;
  if (DIFF_ONLY_TAB_MIN_RATIO <= 0) return true;
  return difference >= DIFF_ONLY_TAB_MIN_RATIO;
}

/**
 * pixelmatch 颜色阈值（0~1），越小越敏感。覆盖：PLAYWRIGHT_PIXELMATCH_THRESHOLD=0.05
 */
const PIXELMATCH_COLOR_THRESHOLD = (() => {
  const v = process.env.PLAYWRIGHT_PIXELMATCH_THRESHOLD;
  if (v !== undefined && v !== '' && !Number.isNaN(Number.parseFloat(v))) {
    return Number.parseFloat(v);
  }
  return 0.06;
})();

/** pixelmatch includeAA：false 时抗锯齿像素不计入差异（易与肉眼不一致）。覆盖：PLAYWRIGHT_PIXELMATCH_INCLUDE_AA=0 */
const PIXELMATCH_INCLUDE_AA = (() => {
  const v = (process.env.PLAYWRIGHT_PIXELMATCH_INCLUDE_AA ?? '').toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return false;
  return true;
})();

interface StepComparison {
  stepNumber: number;
  stepName?: string;
  pomScreenshots: ScreenshotInfo[];
  optimizedScreenshots: ScreenshotInfo[];
  pomComparisons: ImageComparison[];
  optimizedComparisons: ImageComparison[];
  outputPath?: string;
  testDir?: string;
}

interface TestDirComparisons {
  testDir: string;
  comparisons: StepComparison[];
}

const MENU_ITEMS = JSON.parse(fs.readFileSync(path.join(__dirname, '../../datasource/menu_items.json'), 'utf-8'));
const MENU_ROUTES = JSON.parse(fs.readFileSync(path.join(__dirname, '../../datasource/menu_routes.json'), 'utf-8'));

function getMenuNameByRoute(route: string): string {
  const normalizedRoute = '/' + route.replace(/_/g, '/');
  
  for (const [key, routeValue] of Object.entries(MENU_ROUTES)) {
    if (routeValue === normalizedRoute) {
      return MENU_ITEMS[key] || '';
    }
  }
  
  return '';
}

function getRouteDisplayName(route: string): string {
  for (const [key, routeValue] of Object.entries(MENU_ROUTES)) {
    const normalizedRouteValue = String(routeValue).replace(/\//g, '_').replace(/^_/, '');
    if (normalizedRouteValue === route) {
      return MENU_ITEMS[key] || route;
    }
  }
  
  return route;
}

async function generateComparisons(screenshots: ScreenshotInfo[], diffOutputDir: string, outputPath: string): Promise<ImageComparison[]> {
  if (screenshots.length < 2) {
    return [];
  }

  const comparisons: ImageComparison[] = [];
  const outputDir = path.dirname(outputPath);
  const relativeDiffDir = path.relative(outputDir, diffOutputDir);

  for (let i = 1; i < screenshots.length; i++) {
    const compareScreenshot = screenshots[i];
    const diffFileName = `diff-${compareScreenshot.timestamp}.png`;
    const diffOutputPath = path.join(diffOutputDir, diffFileName);
    const relativeDiffPath = path.join(relativeDiffDir, diffFileName);

    const result = await compareImagesWithDiff(
      screenshots[0].path,
      compareScreenshot.path,
      diffOutputPath,
      PIXELMATCH_COLOR_THRESHOLD,
      { includeAA: PIXELMATCH_INCLUDE_AA },
    );

    comparisons.push({
      image1Path: screenshots[0].relativePath,
      image2Path: compareScreenshot.relativePath,
      difference: result.difference,
      diffImagePath: relativeDiffPath,
      browser: compareScreenshot.browser
    });
  }

  return comparisons;
}

async function generateComparisonsByStepName(stepScreenshots: ScreenshotInfo[], stepNumber: number, diffOutputDir: string, outputPath: string): Promise<ImageComparison[]> {
  const groupedByStepName = new Map<string, ScreenshotInfo[]>();
  
  stepScreenshots.forEach(screenshot => {
    const name = screenshot.stepName;
    if (!groupedByStepName.has(name)) {
      groupedByStepName.set(name, []);
    }
    groupedByStepName.get(name)!.push(screenshot);
  });
  
  const allComparisons: ImageComparison[] = [];
  
  for (const [stepName, stepScreenshots] of groupedByStepName) {
    if (stepScreenshots.length < 2) {
      continue;
    }
    
    const stepDiffDir = path.join(diffOutputDir, `step-${stepNumber}-${stepName.replace(/[<>:"|?*\\/]/g, '_')}`);
    if (!fs.existsSync(stepDiffDir)) {
      fs.mkdirSync(stepDiffDir, { recursive: true });
    }
    
    const groupedByBrowser = new Map<string, ScreenshotInfo[]>();
    stepScreenshots.forEach(screenshot => {
      const browser = screenshot.browser || 'unknown';
      if (!groupedByBrowser.has(browser)) {
        groupedByBrowser.set(browser, []);
      }
      groupedByBrowser.get(browser)!.push(screenshot);
    });
    
    for (const [browser, browserScreenshots] of groupedByBrowser) {
      if (browserScreenshots.length < 2) {
        continue;
      }
      
      const browserComparisons = await generateComparisons(browserScreenshots, stepDiffDir, outputPath);
      allComparisons.push(...browserComparisons);
    }
  }
  
  return allComparisons;
}

function getAllScreenshots(dir: string, type: 'pom' | 'optimized', outputPath: string): Map<number, ScreenshotInfo[]> {
  const result = new Map<number, ScreenshotInfo[]>();
  
  if (!fs.existsSync(dir)) {
    console.log(`⚠️  目录不存在: ${dir}`);
    return result;
  }
  
  const outputDir = path.dirname(outputPath);
  const relativeDir = path.relative(outputDir, dir);
  
  function scanDirectory(currentDir: string, currentRelativePath: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    
    entries.forEach(entry => {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.join(currentRelativePath, entry.name);
      
      if (entry.isDirectory()) {
        scanDirectory(fullPath, relativePath);
      } else if (entry.isFile() && entry.name.endsWith('.png')) {
        const match = entry.name.match(/step-(\d+)-(.+)\.png/);
        if (match) {
          const stepNumber = parseInt(match[1]);
          const stepName = match[2];
          
          let route = '';
          const routeMatch = stepName.match(/^(.+)__(.+)$/);
          if (routeMatch) {
            route = routeMatch[2];
          }
          
          if (!result.has(stepNumber)) {
            result.set(stepNumber, []);
          }
          
          const browserMatch = currentDir.match(/-(chrome|firefox|safari|edge|webkit|chromium)-/);
          let browser = browserMatch ? browserMatch[1] : 'unknown';
          
          if (browser === 'chromium') {
            browser = 'chrome';
          }

          // optimized 项目默认使用 Desktop Chrome；截图目录不带浏览器信息时给出合理默认值
          if (browser === 'unknown' && type === 'optimized') {
            browser = 'chrome';
          }
          
          const dateMatch = currentDir.match(/^(\d{4}-\d{2}-\d{2})_/);
          const date = dateMatch ? dateMatch[1] : path.basename(currentDir);
          
          const timeMatch = currentDir.match(/(\d{2})-(\d{2})-(\d{2})-/);
          let displayTimestamp = path.basename(currentDir);
          if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const seconds = parseInt(timeMatch[3]);
            
            const dateObj = new Date();
            dateObj.setHours(hours, minutes, seconds, 0);
            
            const adjustedDate = new Date(dateObj.getTime() + 8 * 60 * 60 * 1000);
            
            displayTimestamp = `${String(adjustedDate.getHours()).padStart(2, '0')}:${String(adjustedDate.getMinutes()).padStart(2, '0')}:${String(adjustedDate.getSeconds()).padStart(2, '0')}`;
          }
          
          result.get(stepNumber)!.push({
            path: fullPath,
            // 输出 HTML 位于 results/ 下，直接基于 fullPath 计算相对路径，避免重复拼接导致路径错误
            relativePath: path.relative(outputDir, fullPath).replaceAll(path.sep, '/'),
            timestamp: path.basename(currentDir),
            date,
            displayTimestamp,
            type,
            stepName: routeMatch ? routeMatch[1] : stepName,
            browser,
            route
          } as ScreenshotInfo);
        } else {
          console.log(`    ⚠️  文件名不匹配: ${entry.name}`);
        }
      }
    });
  }
  
  console.log(`📁 开始递归扫描目录: ${dir}`);
  scanDirectory(dir, relativeDir);
  
  console.log(`✅ ${type} 目录扫描完成: ${result.size} 个步骤`);
  return result;
}

async function generateTestComparisons(testDir: string, screenshots: Map<number, ScreenshotInfo[]>, outputPath: string): Promise<StepComparison[]> {
  const allSteps = Array.from(screenshots.keys()).sort((a, b) => a - b);
  
  const diffOutputDir = path.join(path.dirname(outputPath), 'diffs', testDir);
  if (!fs.existsSync(diffOutputDir)) {
    fs.mkdirSync(diffOutputDir, { recursive: true });
  }

  const comparisons: StepComparison[] = [];
  
  for (const stepNumber of allSteps) {
    const stepScreenshots = screenshots.get(stepNumber) || [];

    const stepComparisons = await generateComparisonsByStepName(stepScreenshots, stepNumber, diffOutputDir, outputPath);

    comparisons.push({
      stepNumber,
      pomScreenshots: [],
      optimizedScreenshots: stepScreenshots,
      pomComparisons: [],
      optimizedComparisons: stepComparisons,
      outputPath,
      testDir
    });
  }
  
  return comparisons;
}

function generateOptimizedStep(comp: StepComparison, dirName: string): string {
  return generateStepSection(comp.stepNumber, comp.stepName, 'Optimized 版本', comp.optimizedScreenshots, dirName);
}

/** 同一步骤下多张子图：before 先于 after（文件名后缀 -before / -after） */
function compareScreenshotSubsectionNames(a: string, b: string): number {
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

function generateStepSection(stepNumber: number, stepName: string | undefined, title: string, screenshots: ScreenshotInfo[], dirName: string): string {
  const groupedByStepName = new Map<string, ScreenshotInfo[]>();
  
  screenshots.forEach(screenshot => {
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
      ${stepNames.map(name => {
        const nameScreenshots = groupedByStepName.get(name)!;
        const nameTotal = nameScreenshots.length;
        
        const route = nameScreenshots[0]?.route || '';
        const menuName = route ? getMenuNameByRoute(route) : '';
        const routeDisplay = menuName ? menuName : (route ? `/${route.replace(/_/g, '/')}` : '');
        const routeInfo = routeDisplay ? `<span class="route-info">📍 ${routeDisplay}</span>` : '';
        
        return `
        <div class="step-subsection">
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

function getTotalExecutions(comparisons: StepComparison[]): number {
  const timestamps = new Set<string>();
  comparisons.forEach(comp => {
    if (POM_ENABLED) {
      comp.pomScreenshots.forEach(s => timestamps.add(s.timestamp));
    }
    comp.optimizedScreenshots.forEach(s => timestamps.add(s.timestamp));
  });
  return timestamps.size;
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
  
  return `
  <div class="section">
    ${browserGroups.map(([browser, browserScreenshots]) => `
      <div class="browser-content-section ${browser === 'chrome' ? 'active' : ''}" data-browser="${browser}" data-count="${browserScreenshots.length}">
        ${generateBrowserContent(browser, browserScreenshots, dirName)}
      </div>
    `).join('')}
  </div>`;
}

function getBrowserIcon(browser: string): string {
  const icons: Record<string, string> = {
    'chrome': '🌐',
    'firefox': '🦊',
    'webkit': '🍎',
    'safari': '🍎',
    'edge': '📦'
  };
  return icons[browser] || '🌍';
}

function groupScreenshotsByBrowser(screenshots: ScreenshotInfo[]): Map<string, ScreenshotInfo[]> {
  const grouped = new Map<string, ScreenshotInfo[]>();
  
  screenshots.forEach(screenshot => {
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

function generateBrowserContent(browser: string, screenshots: ScreenshotInfo[], dirName: string): string {
  const groupedByDate = groupScreenshotsByDate(screenshots);
  const dateGroups = Array.from(groupedByDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  
  return `
  <div class="browser-content-inner">
    ${dateGroups.map(([date, dateScreenshots]) => generateDateGroup(date, dateScreenshots)).join('')}
  </div>`;
}

/** 从目录名、时间戳串等解析日历日，返回 YYYY-MM-DD 供分组合并 */
function extractCalendarDayKey(raw: string): string | null {
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

function calendarDayKeyForScreenshot(s: ScreenshotInfo): string {
  for (const raw of [s.date, s.timestamp]) {
    if (!raw) continue;
    const key = extractCalendarDayKey(String(raw));
    if (key) return key;
  }
  const fallback = String(s.date || s.timestamp || 'unknown');
  return `__unparsed__${fallback}`;
}

/** 分组键为 YYYY-MM-DD 时标题为 MMdd（如 0423）；无法解析时回退展示原文 */
function formatDateGroupTitle(groupKey: string): string {
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

function groupScreenshotsByDate(screenshots: ScreenshotInfo[]): Map<string, ScreenshotInfo[]> {
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

function generateDateGroup(date: string, screenshots: ScreenshotInfo[]): string {
  const sortedScreenshots = [...screenshots].sort((a, b) => {
    return a.displayTimestamp.localeCompare(b.displayTimestamp);
  });
  
  return `
  <div class="date-group">
    <div class="date-title">${formatDateGroupTitle(date)}</div>
    <div class="screenshot-grid">
      ${sortedScreenshots.map(s => generateScreenshotCard(s)).join('')}
    </div>
  </div>`;
}

function generateScreenshotCard(screenshot: ScreenshotInfo): string {
  return `
  <div class="screenshot-card">
    <div class="screenshot-time">${screenshot.displayTimestamp}</div>
    <img class="screenshot-image" src="${screenshot.relativePath}" alt="${screenshot.stepName}" onclick="openModal('${screenshot.relativePath}')">
  </div>`;
}

function groupImageComparisonsByCalendarDay(comparisons: ImageComparison[]): Map<string, ImageComparison[]> {
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

function generateDiffStep(comp: StepComparison, type: 'pom' | 'optimized' | 'all', onlyDiffs: boolean = false): string {
  const comparisons = type === 'pom' ? comp.pomComparisons : 
                     type === 'optimized' ? comp.optimizedComparisons : 
                     [...comp.pomComparisons, ...comp.optimizedComparisons];
  
  if (comparisons.length === 0) {
    return '';
  }
  
  const groupedByStepName = new Map<string, ImageComparison[]>();
  comparisons.forEach(comp => {
    const stepName = extractStepNameFromPath(comp.image1Path);
    if (!groupedByStepName.has(stepName)) {
      groupedByStepName.set(stepName, []);
    }
    groupedByStepName.get(stepName)!.push(comp);
  });
  
  const sortedStepNames = Array.from(groupedByStepName.keys()).sort(compareScreenshotSubsectionNames);
  
  const stepsToDisplay = sortedStepNames.map(stepName => {
    const comps = groupedByStepName.get(stepName)!;
    const diffComps = onlyDiffs ? comps.filter((c) => passesDiffOnlyTabFilter(c.difference)) : comps;
    const hasDiffs = onlyDiffs
      ? comps.some((c) => passesDiffOnlyTabFilter(c.difference))
      : comps.length > 0;
    return { stepName, diffComps, hasDiffs };
  });
  
  if (onlyDiffs && stepsToDisplay.every(s => !s.hasDiffs)) {
    return '';
  }
  
  const stepsWithContent = stepsToDisplay.filter(s => s.diffComps.length > 0);
  
  if (stepsWithContent.length === 0) {
    return '';
  }
  
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
              ${comps.map((c) => generateDiffCard(c, type)).join('')}
            </div>
          </div>`
            )
            .join('')}
        </div>
        `;
      }).join('')}
    </div>
  </div>`;
}

function getOptimizedDiffCountsForScript(tdc: TestDirComparisons): { all: number; only: number } {
  const all = tdc.comparisons.reduce((sum, comp) => sum + (comp.optimizedComparisons?.length || 0), 0);
  const only = tdc.comparisons.reduce(
    (sum, comp) => sum + (comp.optimizedComparisons?.filter((c) => passesDiffOnlyTabFilter(c.difference)).length || 0),
    0
  );
  return { all, only };
}

/** 与 getAllScreenshots 中 stepName 规则一致；勿依赖文件名里必须有 `__`（否则大量子图会落到 unknown，差异 Tab 分组错乱） */
function extractStepNameFromPath(imagePath: string): string {
  const base = path.basename(imagePath.replace(/\\/g, '/'));
  const m = base.match(/^step-\d+-(.+)\.png$/);
  if (!m) return 'unknown';
  const rest = m[1];
  const routeMatch = rest.match(/^(.+)__(.+)$/);
  return routeMatch ? routeMatch[1] : rest;
}

function extractImageLabel(path: string, index: number): string {
  const timeMatch = path.match(/(\d{2}-\d{2}-\d{2})-/);
  if (timeMatch) {
    const timeStr = timeMatch[1];
    const [hh, mm, ss] = timeStr.split('-').map(Number);
    
    const dateObj = new Date();
    dateObj.setHours(hh, mm, ss, 0);
    
    const adjustedDate = new Date(dateObj.getTime() + 8 * 60 * 60 * 1000);
    
    return `${String(adjustedDate.getHours()).padStart(2, '0')}:${String(adjustedDate.getMinutes()).padStart(2, '0')}:${String(adjustedDate.getSeconds()).padStart(2, '0')}`;
  }
  
  return `图片 ${index}`;
}

function extractImageLabelWithRoute(path: string, index: number): string {
  const timeMatch = path.match(/(\d{2}-\d{2}-\d{2})-/);
  if (timeMatch) {
    const timeStr = timeMatch[1];
    const [hh, mm, ss] = timeStr.split('-').map(Number);
    
    const dateObj = new Date();
    dateObj.setHours(hh, mm, ss, 0);
    
    const adjustedDate = new Date(dateObj.getTime() + 8 * 60 * 60 * 1000);
    
    const timeStrAdjusted = `${String(adjustedDate.getHours()).padStart(2, '0')}:${String(adjustedDate.getMinutes()).padStart(2, '0')}:${String(adjustedDate.getSeconds()).padStart(2, '0')}`;
    
    const routeMatch = path.match(/__(.+)\.png$/);
    if (routeMatch) {
      const route = routeMatch[1];
      const routeDisplayName = getRouteDisplayName(route);
      if (route !== routeDisplayName) {
        return `${timeStrAdjusted} (${routeDisplayName})`;
      }
    }
    
    return timeStrAdjusted;
  }
  
  return `图片 ${index}`;
}

function generateDiffCard(comparison: ImageComparison, type: string): string {
  const diffColor = getDifferenceColor(comparison.difference);
  const diffLabel = getDifferenceLabel(comparison.difference);
  const browser = comparison.browser || 'unknown';
  
  const image1Label = extractImageLabelWithRoute(comparison.image1Path, 1);
  const image2Label = extractImageLabelWithRoute(comparison.image2Path, 2);
  
  return `
  <div class="diff-card diff-browser-content" data-browser="${browser}">
    <div class="diff-header">
      <span class="diff-badge" style="background-color: ${diffColor};">${diffLabel}</span>
      <span class="diff-percentage">${formatDifference(comparison.difference)}</span>
    </div>
    <div class="diff-images">
      <div class="diff-image-container">
        <div class="diff-image-label">${image1Label}</div>
        <img src="${comparison.image1Path}" alt="${image1Label}" onclick="openModal('${comparison.image1Path}')">
      </div>
      <div class="diff-image-container">
        <div class="diff-image-label">${image2Label}</div>
        <img src="${comparison.image2Path}" alt="${image2Label}" onclick="openModal('${comparison.image2Path}')">
      </div>
      <div class="diff-image-container">
        <div class="diff-image-label">差异</div>
        <img src="${comparison.diffImagePath}" alt="差异" onclick="openModal('${comparison.diffImagePath}')">
      </div>
    </div>
  </div>`;
}

function generateHTML(testDirComparisons: TestDirComparisons[], pomDirName: string, optDirName: string, hasPomData: boolean, hasOptimizedData: boolean): string {
  const allComparisons = testDirComparisons.flatMap(tdc => tdc.comparisons);
  const optimizedSteps = hasOptimizedData ? allComparisons.map(comp => generateOptimizedStep(comp, optDirName)).join('') : '';
  
  // 约定：testDir = "<iteration>/<script>"
  const iterationMap = new Map<string, TestDirComparisons[]>();
  for (const tdc of testDirComparisons) {
    const [iteration, ...rest] = String(tdc.testDir).split('/');
    const iter = iteration || 'unknown-iteration';
    const script = rest.join('/') || tdc.testDir;
    if (!iterationMap.has(iter)) iterationMap.set(iter, []);
    iterationMap.get(iter)!.push({ ...tdc, testDir: script });
  }
  const iterations = Array.from(iterationMap.keys());
  const firstIteration = iterations[0];

  function stripScriptTimestamp(name: string): string {
    // e.g. 登录-click_2026-04-13_16-58-12 -> 登录-click
    return name.replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/, '');
  }

  const allBrowsers = new Set<string>();
  allComparisons.forEach(comp => {
    comp.optimizedScreenshots.forEach(s => {
      if (s.browser && s.browser !== 'firefox') {
        allBrowsers.add(s.browser);
      }
    });
  });
  const browserList = Array.from(allBrowsers).sort();
  
  const iterationTabs = iterations
    .map((iter, index) => `
    <button class="iteration-tab ${index === 0 ? 'active' : ''}" data-iteration="${iter}" onclick="switchIteration('${iter}')">
      <span>${iter}</span>
    </button>
  `)
    .join('');

  function buildScriptTabs(iter: string): string {
    const scripts = iterationMap.get(iter) || [];
    const displayCount = new Map<string, number>();
    return scripts
      .map((tdc, index) => {
        const rawName = String(tdc.testDir);
        const base = stripScriptTimestamp(rawName);
        const next = (displayCount.get(base) || 0) + 1;
        displayCount.set(base, next);
        const display = next > 1 ? `${base} (${next})` : base;
        return `
      <button class="script-tab ${index === 0 ? 'active' : ''}" data-iteration="${iter}" data-script="${rawName}" onclick="switchScript('${iter}', '${rawName}')" title="${rawName}">
        <span>${display}</span>
      </button>
    `;
      })
      .join('');
  }

  function buildScriptContents(
    iter: string,
    render: (tdc: TestDirComparisons) => string,
    extraAttrs?: (tdc: TestDirComparisons) => string
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

  const optimizedByIteration = iterations
    .map((iter, index) => `
    <div class="iteration-content" data-iteration="${iter}" ${index === 0 ? '' : 'style="display: none;"'}>
      ${buildScriptContents(iter, (tdc) => tdc.comparisons.map((comp) => generateOptimizedStep(comp, optDirName)).join(''))}
    </div>
  `)
    .join('');

  const optimizedDiffByIteration = iterations
    .map((iter, index) => `
    <div class="iteration-content" data-iteration="${iter}" ${index === 0 ? '' : 'style="display: none;"'}>
      ${buildScriptContents(
        iter,
        (tdc) => tdc.comparisons.map((comp) => generateDiffStep(comp, 'optimized')).join(''),
        (tdc) => {
          const c = getOptimizedDiffCountsForScript(tdc);
          return `data-diff-all="${c.all}" data-diff-only="${c.only}"`;
        }
      )}
    </div>
  `)
    .join('');

  const diffOnlyByIteration = iterations
    .map((iter, index) => `
    <div class="iteration-content" data-iteration="${iter}" ${index === 0 ? '' : 'style="display: none;"'}>
      ${buildScriptContents(
        iter,
        (tdc) => tdc.comparisons.map((comp) => generateDiffStep(comp, 'all', true)).join(''),
        (tdc) => {
          const c = getOptimizedDiffCountsForScript(tdc);
          return `data-diff-all="${c.all}" data-diff-only="${c.only}"`;
        }
      )}
    </div>
  `)
    .join('');
  
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>截图对比报告</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
      background: #f5f7fa;
      padding: 24px;
      color: #1d2129;
    }
    
    .header {
      background: white;
      color: #1d2129;
      padding: 24px 32px;
      border-radius: 8px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      border-bottom: 3px solid #1677ff;
    }
    
    .header h1 {
      font-size: 24px;
      font-weight: 600;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    
    .stat-card {
      background: white;
      padding: 20px 24px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      transition: all 0.2s ease;
      border: 1px solid #e8e8e8;
    }
    
    .stat-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    
    .stat-card h3 {
      font-size: 14px;
      color: #86909c;
      margin-bottom: 12px;
      font-weight: 400;
    }
    
    .stat-card .value {
      font-size: 32px;
      font-weight: 700;
      color: #1677ff;
    }
    
    .comparison {
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      margin-bottom: 16px;
      overflow: hidden;
      border: 1px solid #e8e8e8;
    }
    
    .comparison-header {
      background: #fafafa;
      padding: 12px 20px;
      border-bottom: 1px solid #e8e8e8;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }
    
    .comparison-header:hover {
      background: #f5f5f5;
    }
    
    .comparison-header h2 {
      font-size: 15px;
      color: #1d2129;
      margin-bottom: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
    }

    .controls-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 24px;
    }

    .filter-panel {
      flex: 1 1 auto;
      min-width: 320px;
      background: white;
      border: 1px solid #e8e8e8;
      border-radius: 10px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .filter-row {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .filter-label {
      font-size: 14px;
      font-weight: 500;
      color: #4e5969;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .global-browser-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      flex: 1;
      min-width: 0;
    }

    .controls-right {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      flex: 0 0 auto;
    }

    .control-button {
      padding: 8px 16px;
      background: white;
      border: 1px solid #d9d9d9;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 400;
      color: #1d2129;
      transition: all 0.2s ease;
    }

    .control-button:hover {
      color: #1677ff;
      border-color: #1677ff;
      background: #e6f4ff;
    }

    .control-input {
      height: 36px;
      padding: 0 12px;
      border: 1px solid #d9d9d9;
      border-radius: 6px;
      background: white;
      font-size: 14px;
      min-width: 240px;
      transition: all 0.2s ease;
      outline: none;
    }

    .control-input:hover {
      border-color: #1677ff;
    }

    .control-input:focus {
      border-color: #1677ff;
      box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.1);
    }
    
    .screenshot-badge {
      display: inline-block;
      background: #1677ff;
      color: white;
      font-size: 12px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 4px;
      white-space: nowrap;
    }
    
    .comparison-body {
      padding: 16px;
    }
    
    .step-subsection {
      margin-bottom: 16px;
      background: white;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid #e8e8e8;
    }
    
    .step-subsection:last-child {
      margin-bottom: 0;
    }
    
    .step-subsection-header {
      background: #fafafa;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid #e8e8e8;
    }
    
    .step-subsection-header h3 {
      font-size: 14px;
      font-weight: 600;
      color: #1d2129;
      margin: 0;
    }
    
    .route-info {
      font-size: 12px;
      font-weight: 400;
      color: #1677ff;
      background: #e6f4ff;
      padding: 4px 10px;
      border-radius: 4px;
      white-space: nowrap;
    }
    
    .section {
      margin-bottom: 15px;
    }
    
    .section:last-child {
      margin-bottom: 0;
    }
    
    .browser-group {
      margin-bottom: 20px;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      overflow: hidden;
    }
    
    .browser-group:last-child {
      margin-bottom: 0;
    }
    
    .test-dir-tabs {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
      padding: 16px 20px;
      background: white;
      border-radius: 10px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }

    .iteration-tabs-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      flex: 1;
      min-width: 0;
    }
    
    .iteration-tab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      background: #f7f8fa;
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 400;
      color: #4e5969;
      transition: all 0.2s ease;
    }
    
    .iteration-tab:hover {
      background: #e6f4ff;
      color: #1677ff;
    }
    
    .iteration-tab.active {
      background: #1677ff;
      color: white;
      font-weight: 500;
    }

    .script-tabs-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      flex: 1;
      min-width: 0;
    }

    .script-tabs-iteration {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    
    .script-tab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      background: #f7f8fa;
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 400;
      color: #4e5969;
      transition: all 0.2s ease;
    }
    
    .script-tab:hover {
      background: #e6f4ff;
      color: #1677ff;
    }
    
    .script-tab.active {
      background: #1677ff;
      color: white;
      font-weight: 500;
    }
    
    .test-dir-tabs-label {
      font-size: 15px;
      font-weight: 600;
      color: #495057;
      white-space: nowrap;
    }
    
    .test-dir-tab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: #f8f9fa;
      border: 2px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: #495057;
      transition: all 0.2s ease;
    }
    
    .test-dir-tab:hover {
      background: #e9ecef;
      color: #212529;
      border-color: #dee2e6;
    }
    
    .test-dir-tab.active {
      background: #667eea;
      color: white;
      font-weight: 600;
      border-color: #667eea;
      box-shadow: 0 2px 6px rgba(102, 126, 234, 0.2);
    }
    
    .global-browser-tab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      background: #f7f8fa;
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 400;
      color: #4e5969;
      transition: all 0.2s ease;
    }
    
    .global-browser-tab:hover {
      background: #e6f4ff;
      color: #1677ff;
    }
    
    .global-browser-tab.active {
      background: #1677ff;
      color: white;
      font-weight: 500;
    }
    
    .browser-content-section {
      display: none;
    }
    
    .browser-content-section.active {
      display: block;
    }
    
    .browser-content-inner {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    
    .date-group {
      min-width: 0;
      width: 100%;
      overflow-x: auto;
      background: white;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      border: 1px solid #e8e8e8;
    }
    
    .date-title {
      font-size: 14px;
      font-weight: 600;
      color: #1d2129;
      margin-bottom: 16px;
      padding: 8px 12px;
      background: #f7f8fa;
      border-left: 3px solid #1677ff;
      border-radius: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .date-title::before {
      content: '📅';
      font-size: 16px;
    }
    
    .screenshot-time {
      background: #f7f8fa;
      color: #86909c;
      font-size: 12px;
      font-weight: 500;
      padding: 6px 8px;
      text-align: center;
      white-space: nowrap;
      border-bottom: 1px solid #e8e8e8;
    }
    
    .screenshot-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(520px, 1fr));
      gap: 24px;
      width: 100%;
    }
    
    .screenshot-card {
      min-width: 0;
      background: white;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid #e8e8e8;
      display: flex;
      flex-direction: column;
      transition: box-shadow 0.2s ease, border-color 0.2s ease;
    }
    
    .screenshot-card:hover {
      border-color: #e8e8e8;
      box-shadow: 0 4px 16px rgba(22, 119, 255, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06);
    }
    
    .screenshot-image {
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      height: auto;
      background: white;
      cursor: pointer;
    }
    
    .no-screenshots {
      text-align: center;
      padding: 32px 16px;
      color: #86909c;
      font-size: 14px;
      background: #f7f8fa;
      border-radius: 6px;
    }
    
    .diff-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(520px, 1fr));
      gap: 24px;
      width: 100%;
    }
    
    .diff-step-group {
      margin-bottom: 20px;
    }
    
    .diff-step-group:last-child {
      margin-bottom: 0;
    }
    
    .diff-step-name {
      font-size: 14px;
      font-weight: 600;
      color: #1d2129;
      margin-bottom: 12px;
      padding: 8px 12px;
      background: #f7f8fa;
      border-left: 3px solid #1677ff;
      border-radius: 4px;
    }
    
    .diff-card {
      background: white;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #e8e8e8;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      transition: box-shadow 0.2s ease, border-color 0.2s ease;
    }
    
    .diff-card:hover {
      border-color: #e8e8e8;
      box-shadow: 0 4px 16px rgba(22, 119, 255, 0.1), 0 2px 6px rgba(0, 0, 0, 0.05);
    }
    
    .diff-card.diff-browser-content {
      display: none;
    }
    
    .diff-card.diff-browser-content.active {
      display: block;
    }
    
    .diff-header {
      background: #f7f8fa;
      padding: 10px 15px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid #e8e8e8;
    }
    
    .diff-badge {
      font-size: 11px;
      font-weight: bold;
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
    }
    
    .diff-percentage {
      font-size: 13px;
      font-weight: 600;
      color: #1d2129;
      margin-left: auto;
    }
    
    .diff-images {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 12px;
      align-items: start;
    }
    
    @media (max-width: 640px) {
      .diff-images {
        grid-template-columns: 1fr;
      }
    }
    
    .diff-image-container {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      overflow: hidden;
      border-radius: 6px;
    }
    
    .diff-image-label {
      font-size: 12px;
      color: #86909c;
      text-align: center;
      font-weight: 500;
    }
    
    .diff-image-container img {
      display: block;
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      height: auto;
      background: white;
      border: 1px solid #e8e8e8;
      border-radius: 6px;
      cursor: pointer;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
      box-shadow: none;
    }
    
    .diff-image-container img:hover {
      border-color: #1677ff;
      box-shadow: 0 4px 14px rgba(22, 119, 255, 0.1);
    }
    
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.75);
      z-index: 1000;
      justify-content: center;
      align-items: center;
    }
    
    .modal.active {
      display: flex;
    }
    
    .modal-content {
      max-width: 90%;
      max-height: 90%;
      background: white;
      border-radius: 8px;
      overflow: auto;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    }
    
    .modal-image {
      width: auto;
      height: auto;
      max-width: min(100%, 100vw);
      max-height: 90vh;
      display: block;
    }
    
    .modal-close {
      position: absolute;
      top: 24px;
      right: 24px;
      background: white;
      border: 1px solid #e8e8e8;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      font-size: 20px;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      z-index: 1001;
      color: #1d2129;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }
    
    .modal-close:hover {
      background: #f7f8fa;
      border-color: #1677ff;
      color: #1677ff;
    }
    
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      padding: 4px;
      background: #f7f8fa;
      border-radius: 8px;
    }
    
    .tab {
      padding: 10px 20px;
      background: transparent;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: #86909c;
      transition: all 0.2s ease;
    }
    
    .tab:hover {
      color: #1677ff;
      background: rgba(22, 119, 255, 0.05);
    }
    
    .tab.active {
      background: #1677ff;
      color: white;
      font-weight: 600;
    }
    
    .tab-content {
      display: none;
    }
    
    .tab-content.active {
      display: block;
      animation: fadeIn 0.3s ease;
    }
    
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      text-align: center;
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      border: 1px solid #e8e8e8;
    }
    
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    
    .empty-state-title {
      font-size: 16px;
      font-weight: 600;
      color: #1d2129;
      margin-bottom: 8px;
    }
    
    .empty-state-description {
      font-size: 14px;
      color: #86909c;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>📸 截图对比报告</h1>
  </div>
  
  <div class="stats">
    <div class="stat-card">
      <h3>总步骤数</h3>
      <div class="value">${allComparisons.length}</div>
    </div>
    ${hasOptimizedData ? `
    <div class="stat-card">
      <h3>Optimized 截图数</h3>
      <div class="value">${allComparisons.reduce((sum, c) => sum + c.optimizedScreenshots.length, 0)}</div>
    </div>` : ''}
    <div class="stat-card">
      <h3>执行次数</h3>
      <div class="value">${getTotalExecutions(allComparisons)}</div>
    </div>
  </div>
  
  <div class="controls-row">
    <div class="filter-panel" role="region" aria-label="筛选">
      <div class="filter-row">
        <span class="filter-label">迭代：</span>
        <div class="iteration-tabs-container">
          ${iterationTabs}
        </div>
      </div>
      <div class="filter-row">
        <span class="filter-label">脚本：</span>
        <div class="script-tabs-container">
          ${iterations
            .map((iter) => `<div class="script-tabs-iteration" data-iteration="${iter}" ${
              iter === firstIteration ? '' : 'style="display: none;"'
            }>${buildScriptTabs(iter)}</div>`)
            .join('')}
        </div>
      </div>
      ${hasOptimizedData ? `
      <div class="filter-row">
        <span class="filter-label">浏览器：</span>
        <div class="global-browser-buttons">
          ${browserList.map((browser, index) => `
          <button class="global-browser-tab ${index === 0 ? 'active' : ''}" data-browser="${browser}" onclick="switchGlobalBrowser('${browser}')">
            ${getBrowserIcon(browser)}
            <span>${browser}</span>
          </button>
          `).join('')}
        </div>
      </div>` : ''}
    </div>

    <div class="controls-right">
      <input class="control-input" id="scriptSearch" placeholder="搜索脚本（当前迭代）…" oninput="filterScripts(this.value)" />
      <button class="control-button" onclick="collapseAll(true)">折叠全部</button>
      <button class="control-button" onclick="collapseAll(false)">展开全部</button>
    </div>
  </div>
  
  <div class="tabs">
    <button class="tab active" onclick="switchTab('optimized')">Optimized 版本</button>
    <button class="tab" onclick="switchTab('optimized-diff')">Optimized 差异</button>
    <button class="tab" onclick="switchTab('diff-only')">有差异</button>
  </div>
  
  <div id="optimized-content" class="tab-content active">
    ${optimizedByIteration}
  </div>
  
  <div id="optimized-diff-content" class="tab-content">
    <div class="empty-state" id="optimized-diff-empty" style="display: none;">
      <div class="empty-state-icon">🎉</div>
      <div class="empty-state-title">暂无差异</div>
      <div class="empty-state-description">diff 数据为空</div>
    </div>
    ${optimizedDiffByIteration}
  </div>
  
  <div id="diff-only-content" class="tab-content">
    <div class="empty-state" id="diff-only-empty" style="display: none;">
      <div class="empty-state-icon">🎉</div>
      <div class="empty-state-title">暂无差异</div>
      <div class="empty-state-description">diff 数据为空</div>
    </div>
    ${diffOnlyByIteration}
  </div>
  
  <div class="modal" id="modal" onclick="if (event.target === this) closeModal()">
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <div class="modal-content">
      <img class="modal-image" id="modalImage" src="" alt="截图预览">
    </div>
  </div>
  
  <script>
    function openModal(src) {
      const modal = document.getElementById('modal');
      const modalImage = document.getElementById('modalImage');
      modalImage.src = src;
      modal.classList.add('active');
    }
    
    function closeModal() {
      const modal = document.getElementById('modal');
      modal.classList.remove('active');
    }
    
    function switchTab(tabName) {
      const tabs = document.querySelectorAll('.tab');
      const contents = document.querySelectorAll('.tab-content');
      
      tabs.forEach(function(tab) {
        tab.classList.remove('active');
      });
      contents.forEach(function(content) {
        content.classList.remove('active');
      });
      
      const targetTab = Array.from(tabs).find(function(tab) {
        return tab.getAttribute('onclick').includes(tabName);
      });
      if (targetTab) targetTab.classList.add('active');
      const targetContent = document.getElementById(tabName + '-content');
      if (targetContent) targetContent.classList.add('active');
      
      const activeBrowserTab = document.querySelector('.global-browser-tab.active');
      const gbTabs = document.querySelectorAll('.global-browser-tab');
      const browser = gbTabs.length
        ? (activeBrowserTab ? activeBrowserTab.getAttribute('data-browser') : gbTabs[0].getAttribute('data-browser'))
        : null;
      switchGlobalBrowser(browser);
    }
    
    function switchIteration(iteration) {
      const iterTabs = document.querySelectorAll('.iteration-tab');
      const iterContents = document.querySelectorAll('.iteration-content');
      
      iterTabs.forEach(function(tab) {
        tab.classList.remove('active');
      });
      iterContents.forEach(function(content) {
        content.style.display = 'none';
      });
      
      const targetTab = document.querySelector('.iteration-tab[data-iteration=\"' + iteration + '\"]');
      // 每个主 Tab 内各有一份 .iteration-content；只打开第一份会导致差异 Tab 整段仍为 display:none。
      document.querySelectorAll('.iteration-content[data-iteration=\"' + iteration + '\"]').forEach(function(content) {
        content.style.display = 'block';
      });
      if (targetTab) targetTab.classList.add('active');

      const allScriptRows = document.querySelectorAll('.script-tabs-iteration');
      allScriptRows.forEach(function(row) {
        row.style.display = 'none';
      });
      const scriptRow = document.querySelector('.script-tabs-iteration[data-iteration=\"' + iteration + '\"]');
      if (scriptRow) scriptRow.style.display = 'block';
      
      // 激活该迭代下第一个脚本
      const firstScriptTab = scriptRow ? scriptRow.querySelector('.script-tab') : null;
      if (firstScriptTab) {
        const script = firstScriptTab.getAttribute('data-script');
        if (script) switchScript(iteration, script);
      }
      
      const activeBrowserTab = document.querySelector('.global-browser-tab.active');
      const gbTabs = document.querySelectorAll('.global-browser-tab');
      const browser = gbTabs.length
        ? (activeBrowserTab ? activeBrowserTab.getAttribute('data-browser') : gbTabs[0].getAttribute('data-browser'))
        : null;
      switchGlobalBrowser(browser);
    }

    function switchScript(iteration, script) {
      const scriptTabs = document.querySelectorAll('.script-tab[data-iteration=\"' + iteration + '\"]');
      const scriptContents = document.querySelectorAll('.script-content[data-iteration=\"' + iteration + '\"]');

      scriptTabs.forEach(function(tab) {
        tab.classList.remove('active');
      });
      scriptContents.forEach(function(content) {
        content.style.display = 'none';
      });

      const targetTab = document.querySelector('.script-tab[data-iteration=\"' + iteration + '\"][data-script=\"' + script + '\"]');
      // 三个主 Tab 各有一份同名 .script-content；querySelector 只会打开 Optimized 里的第一份，差异 Tab 内面板会一直是 display:none。
      document.querySelectorAll('.script-content[data-iteration=\"' + iteration + '\"][data-script=\"' + script + '\"]').forEach(function(panel) {
        panel.style.display = 'block';
      });
      if (targetTab) targetTab.classList.add('active');

      const input = document.getElementById('scriptSearch');
      if (input) input.value = '';
      filterScripts('');

      const activeBrowserTab = document.querySelector('.global-browser-tab.active');
      const gbTabs = document.querySelectorAll('.global-browser-tab');
      const browser = gbTabs.length
        ? (activeBrowserTab ? activeBrowserTab.getAttribute('data-browser') : gbTabs[0].getAttribute('data-browser'))
        : null;
      switchGlobalBrowser(browser);
    }

    function filterScripts(query) {
      const activeIterTab = document.querySelector('.iteration-tab.active');
      const iteration = activeIterTab ? activeIterTab.getAttribute('data-iteration') : null;
      if (!iteration) return;

      const q = String(query || '').trim().toLowerCase();
      const tabs = document.querySelectorAll('.script-tab[data-iteration=\"' + iteration + '\"]');

      tabs.forEach(function(tab) {
        const label = (tab.textContent || '').trim().toLowerCase();
        const title = (tab.getAttribute('title') || '').toLowerCase();
        const hit = q.length === 0 || label.includes(q) || title.includes(q);
        tab.style.display = hit ? 'inline-flex' : 'none';
      });
    }

    function toggleStep(stepNumber) {
      const body = document.getElementById('step-body-' + stepNumber);
      if (!body) return;
      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
    }

    function collapseAll(collapse) {
      const bodies = document.querySelectorAll('.comparison-body');
      bodies.forEach(function(body) {
        body.style.display = collapse ? 'none' : 'block';
      });
    }

    function scriptDiffPanelHasVisibleDiff(panel) {
      if (!panel) return false;
      if (window.getComputedStyle(panel).display === 'none') return false;
      let found = false;
      panel.querySelectorAll('.comparison').forEach(function(comp) {
        if (window.getComputedStyle(comp).display === 'none') return;
        if (comp.querySelector('.diff-card.diff-browser-content')) {
          found = true;
        }
      });
      return found;
    }
    
    function updateDiffEmptyStates() {
      const activeIterTab = document.querySelector('.iteration-tab.active');
      const iteration = activeIterTab ? activeIterTab.getAttribute('data-iteration') : null;
      const activeScriptTab = iteration
        ? document.querySelector('.script-tab.active[data-iteration=\"' + iteration + '\"]')
        : null;
      const script = activeScriptTab ? activeScriptTab.getAttribute('data-script') : null;
      const activeTab = document.querySelector('.tab-content.active');

      if (!iteration || !script || !activeTab) return;

      if (activeTab.id === 'optimized-diff-content') {
        const target = document.querySelector(
          '#optimized-diff-content .script-content[data-iteration=\"' + iteration + '\"][data-script=\"' + script + '\"]'
        );
        const empty = document.getElementById('optimized-diff-empty');
        if (empty) {
          const visible = scriptDiffPanelHasVisibleDiff(target);
          empty.style.display = visible ? 'none' : 'flex';
        }
      }

      if (activeTab.id === 'diff-only-content') {
        const target = document.querySelector(
          '#diff-only-content .script-content[data-iteration=\"' + iteration + '\"][data-script=\"' + script + '\"]'
        );
        const empty = document.getElementById('diff-only-empty');
        if (empty) {
          const visible = scriptDiffPanelHasVisibleDiff(target);
          empty.style.display = visible ? 'none' : 'flex';
        }
      }
    }
    
    function switchGlobalBrowser(browser) {
      const tabs = document.querySelectorAll('.global-browser-tab');
      const sections = document.querySelectorAll('.browser-content-section');
      const diffCards = document.querySelectorAll('.diff-card.diff-browser-content');
      const activeTabForDiff = document.querySelector('.tab-content.active');
      const isDiffReportTab =
        activeTabForDiff &&
        (activeTabForDiff.id === 'diff-only-content' || activeTabForDiff.id === 'optimized-diff-content');
      
      tabs.forEach(function(tab) {
        tab.classList.remove('active');
      });
      sections.forEach(function(section) {
        section.classList.remove('active');
      });
      diffCards.forEach(function(card) {
        card.classList.remove('active');
      });
      
      if (tabs.length === 0) {
        sections.forEach(function(section) {
          section.classList.add('active');
        });
        diffCards.forEach(function(card) {
          card.classList.add('active');
        });
      } else {
        let targetTab = browser
          ? document.querySelector('.global-browser-tab[data-browser="' + browser + '"]')
          : null;
        if (!targetTab) {
          targetTab = tabs[0];
        }
        targetTab.classList.add('active');
        const effectiveBrowser = targetTab.getAttribute('data-browser') || '';

        const targetSections = document.querySelectorAll('.browser-content-section[data-browser="' + effectiveBrowser + '"]');
        targetSections.forEach(function(section) {
          section.classList.add('active');
          const count = section.getAttribute('data-count');
          if (count) {
            const subsection = section.closest('.step-subsection');
            
            if (subsection) {
              const subsectionCount = subsection.querySelector('.subsection-count');
              if (subsectionCount) subsectionCount.textContent = count + '张';
            }
          }
        });
        // 差异类 Tab：同一步骤常同时存在 chrome / webkit 等多套 diff；按全局浏览器过滤会导致未选中浏览器的卡片被 CSS 隐藏（display:none），看起来像「没生成差异」。此处始终展示当前 Tab 内全部 diff。
        if (isDiffReportTab) {
          activeTabForDiff.querySelectorAll('.diff-card.diff-browser-content').forEach(function(card) {
            card.classList.add('active');
          });
        } else {
          const targetDiffCards = document.querySelectorAll('.diff-card.diff-browser-content[data-browser="' + effectiveBrowser + '"]');
          if (targetDiffCards.length === 0 && diffCards.length > 0) {
            diffCards.forEach(function(card) {
              card.classList.add('active');
            });
          } else {
            targetDiffCards.forEach(function(card) {
              card.classList.add('active');
            });
          }
        }
      }
      
      const allSubsections = document.querySelectorAll('.step-subsection');
      allSubsections.forEach(function(subsection) {
        const hasActiveSection = subsection.querySelector('.browser-content-section.active');
        const subsectionCount = subsection.querySelector('.subsection-count');
        if (subsectionCount) {
          if (hasActiveSection) {
            const activeSection = subsection.querySelector('.browser-content-section.active');
            const count = activeSection.getAttribute('data-count');
            subsectionCount.textContent = count + '张';
          } else {
            subsectionCount.textContent = '0张';
          }
        }
      });
      
      const activeTab = document.querySelector('.tab-content.active');
      if (activeTab && (activeTab.id === 'diff-only-content' || activeTab.id === 'optimized-diff-content')) {
        activeTab.querySelectorAll('.comparison').forEach(function(comparison) {
          comparison.style.display = 'block';
        });
      } else if (activeTab && activeTab.id === 'optimized-content') {
        const comparisonsInTab = activeTab.querySelectorAll('.comparison');
        comparisonsInTab.forEach(function(comparison) {
          const hasActiveSection = comparison.querySelector('.browser-content-section.active');
          if (hasActiveSection) {
            comparison.style.display = 'block';
          } else {
            comparison.style.display = 'none';
          }
        });
      } else if (activeTab) {
        activeTab.querySelectorAll('.comparison').forEach(function(comparison) {
          comparison.style.display = 'block';
        });
      }

      updateDiffEmptyStates();
    }
    
    document.addEventListener('DOMContentLoaded', function() {
      const activeGb = document.querySelector('.global-browser-tab.active');
      const gbTabs = document.querySelectorAll('.global-browser-tab');
      const browser = gbTabs.length
        ? (activeGb ? activeGb.getAttribute('data-browser') : gbTabs[0].getAttribute('data-browser'))
        : null;
      switchGlobalBrowser(browser);

      const activeIterTab = document.querySelector('.iteration-tab.active');
      if (activeIterTab) {
        const iteration = activeIterTab.getAttribute('data-iteration');
        if (iteration) {
          switchIteration(iteration);
        }
      }

      updateDiffEmptyStates();
    });
    
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeModal();
      }
    });
  </script>
</body>
</html>`;
}

async function main() {
  const args = process.argv.slice(2);
  let outputPath = 'results/screenshot-comparison.html';
  
  if (args.length > 0) {
    outputPath = args[0];
  }
  
  const screenshotsDir = 'screenshots';
  
  if (!fs.existsSync(screenshotsDir)) {
    console.log(`⚠️  截图目录不存在: ${screenshotsDir}`);
    return;
  }
  
  // 目录结构约定：
  // screenshots/<dateDir>/<scriptDir>/<timestamp>/<step-*.png>
  const dateDirs = fs.readdirSync(screenshotsDir)
    .filter((f) => fs.statSync(path.join(screenshotsDir, f)).isDirectory())
    .filter((f) => !f.startsWith('.'))
    .sort()
    .reverse();
  
  console.log('📸 正在扫描截图目录...');
  console.log(`  截图根目录: ${screenshotsDir}`);
  console.log(`  找到 ${dateDirs.length} 个日期目录: ${dateDirs.join(', ')}`);
  console.log(`  输出文件: ${outputPath}`);
  
  const testDirComparisons: TestDirComparisons[] = [];
  
  for (const dateDir of dateDirs) {
    const datePath = path.join(screenshotsDir, dateDir);
    const scriptDirs = fs
      .readdirSync(datePath)
      .filter((f) => fs.statSync(path.join(datePath, f)).isDirectory())
      .filter((f) => !f.startsWith('.'))
      .sort();

    if (scriptDirs.length === 0) continue;

    console.log(`\n🗓️  处理日期目录: ${dateDir}（脚本数: ${scriptDirs.length}）`);

    for (const scriptDir of scriptDirs) {
      const scriptPath = path.join(datePath, scriptDir);
      const scriptKey = `${dateDir}/${scriptDir}`;
      console.log(`\n🔍 处理脚本目录: ${scriptKey}`);

      const screenshots = getAllScreenshots(scriptPath, 'optimized', outputPath);

      if (screenshots.size > 0) {
        const comparisons = await generateTestComparisons(scriptKey, screenshots, outputPath);
        testDirComparisons.push({
          testDir: scriptKey,
          comparisons,
        });
      }
    }
  }
  
  if (testDirComparisons.length === 0) {
    console.log('\n⚠️  没有找到任何截图');
    return;
  }
  
  const html = generateHTML(testDirComparisons, '', '', false, true);
  
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, html, 'utf-8');
  console.log(`\n✅ 对比报告已生成: ${outputPath}`);
}

main();
