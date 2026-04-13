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

const MENU_ITEMS = JSON.parse(fs.readFileSync(path.join(__dirname, '../datasource/menu_items.json'), 'utf-8'));
const MENU_ROUTES = JSON.parse(fs.readFileSync(path.join(__dirname, '../datasource/menu_routes.json'), 'utf-8'));

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
      diffOutputPath
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
            relativePath: path.join('screenshots', relativePath),
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

function generateStepSection(stepNumber: number, stepName: string | undefined, title: string, screenshots: ScreenshotInfo[], dirName: string): string {
  const groupedByStepName = new Map<string, ScreenshotInfo[]>();
  
  screenshots.forEach(screenshot => {
    const name = screenshot.stepName;
    if (!groupedByStepName.has(name)) {
      groupedByStepName.set(name, []);
    }
    groupedByStepName.get(name)!.push(screenshot);
  });
  
  const stepNames = Array.from(groupedByStepName.keys()).sort((a, b) => {
    if (a.startsWith('before') && !b.startsWith('before')) return -1;
    if (!a.startsWith('before') && b.startsWith('before')) return 1;
    return a.localeCompare(b);
  });
  
  const totalScreenshots = screenshots.length;
  
  return `
  <div class="comparison">
    <div class="comparison-header">
      <h2>
        步骤 ${stepNumber}
      </h2>
    </div>
    <div class="comparison-body">
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
            <h3>步骤 ${stepNumber} ${name}</h3>
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
    comp.pomScreenshots.forEach(s => timestamps.add(s.timestamp));
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

function groupScreenshotsByDate(screenshots: ScreenshotInfo[]): Map<string, ScreenshotInfo[]> {
  const grouped = new Map<string, ScreenshotInfo[]>();
  
  screenshots.forEach(screenshot => {
    const date = screenshot.date || screenshot.timestamp;
    if (!grouped.has(date)) {
      grouped.set(date, []);
    }
    grouped.get(date)!.push(screenshot);
  });
  
  return grouped;
}

function generateDateGroup(date: string, screenshots: ScreenshotInfo[]): string {
  const sortedScreenshots = [...screenshots].sort((a, b) => {
    return a.displayTimestamp.localeCompare(b.displayTimestamp);
  });
  
  return `
  <div class="date-group">
    <div class="date-title">${date}</div>
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
  
  const sortedStepNames = Array.from(groupedByStepName.keys()).sort((a, b) => {
    if (a.startsWith('before') && !b.startsWith('before')) return -1;
    if (!a.startsWith('before') && b.startsWith('before')) return 1;
    return a.localeCompare(b);
  });
  
  const stepsToDisplay = sortedStepNames.map(stepName => {
    const comps = groupedByStepName.get(stepName)!;
    const diffComps = onlyDiffs ? comps.filter(c => c.difference >= 0.001) : comps;
    return { stepName, diffComps, hasDiffs: comps.some(c => c.difference >= 0.001) };
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
        return `
        <div class="diff-step-group">
          <div class="diff-step-name">步骤 ${comp.stepNumber} ${stepName}</div>
          <div class="diff-grid">
            ${diffComps.map(c => generateDiffCard(c, type)).join('')}
          </div>
        </div>
        `;
      }).join('')}
    </div>
  </div>`;
}

function extractStepNameFromPath(path: string): string {
  const match = path.match(/step-\d+-([^_]+(?:_[^_]+)*)__/);
  return match ? match[1] : 'unknown';
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
  
  const allBrowsers = new Set<string>();
  allComparisons.forEach(comp => {
    comp.optimizedScreenshots.forEach(s => {
      if (s.browser && s.browser !== 'firefox') {
        allBrowsers.add(s.browser);
      }
    });
  });
  const browserList = Array.from(allBrowsers).sort();
  
  const testDirTabs = testDirComparisons.map((tdc, index) => `
    <button class="test-dir-tab ${index === 0 ? 'active' : ''}" data-test-dir="${tdc.testDir}" onclick="switchTestDir('${tdc.testDir}')">
      <span>${tdc.testDir}</span>
    </button>
  `).join('');
  
  const testDirContents = testDirComparisons.map(tdc => `
    <div class="test-dir-content" data-test-dir="${tdc.testDir}" ${tdc.testDir === testDirComparisons[0].testDir ? '' : 'style="display: none;"'}>
      ${tdc.comparisons.map(comp => generateOptimizedStep(comp, optDirName)).join('')}
    </div>
  `).join('');
  
  const testDirDiffContents = testDirComparisons.map(tdc => `
    <div class="test-dir-content" data-test-dir="${tdc.testDir}" ${tdc.testDir === testDirComparisons[0].testDir ? '' : 'style="display: none;"'}>
      ${tdc.comparisons.map(comp => generateDiffStep(comp, 'optimized')).join('')}
    </div>
  `).join('');
  
  const testDirDiffOnlyContents = testDirComparisons.map(tdc => `
    <div class="test-dir-content" data-test-dir="${tdc.testDir}" ${tdc.testDir === testDirComparisons[0].testDir ? '' : 'style="display: none;"'}>
      ${tdc.comparisons.map(comp => generateDiffStep(comp, 'all', true)).join('')}
    </div>
  `).join('');
  
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
      background: #f5f5f5;
      padding: 20px;
    }
    
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 10px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    
    .header h1 {
      font-size: 32px;
      margin-bottom: 10px;
    }
    
    .header p {
      font-size: 16px;
      opacity: 0.9;
    }
    
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .stat-card {
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    
    .stat-card h3 {
      font-size: 14px;
      color: #666;
      margin-bottom: 10px;
    }
    
    .stat-card .value {
      font-size: 32px;
      font-weight: bold;
      color: #667eea;
    }
    
    .comparison {
      background: white;
      border-radius: 10px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      margin-bottom: 30px;
      overflow: hidden;
    }
    
    .comparison-header {
      background: #f8f9fa;
      padding: 10px 15px;
      border-bottom: 1px solid #dee2e6;
    }
    
    .comparison-header h2 {
      font-size: 16px;
      color: #333;
      margin-bottom: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .screenshot-badge {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-size: 11px;
      font-weight: bold;
      padding: 3px 10px;
      border-radius: 12px;
      white-space: nowrap;
    }
    
    .comparison-body {
      padding: 12px;
    }
    
    .step-subsection {
      margin-bottom: 20px;
      background: #f8f9fa;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #dee2e6;
    }
    
    .step-subsection:last-child {
      margin-bottom: 0;
    }
    
    .step-subsection-header {
      background: #e9ecef;
      padding: 10px 15px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid #dee2e6;
    }
    
    .step-subsection-header h3 {
      font-size: 14px;
      font-weight: 600;
      color: #495057;
      margin: 0;
    }
    
    .route-info {
      font-size: 12px;
      font-weight: 500;
      color: #667eea;
      background: #f0f3ff;
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
    
    .global-browser-tabs {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
      padding: 16px 20px;
      background: white;
      border-radius: 10px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }
    
    .global-browser-tabs-label {
      font-size: 15px;
      font-weight: 600;
      color: #495057;
      white-space: nowrap;
    }
    
    .global-browser-tab {
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
    
    .global-browser-tab:hover {
      background: #e9ecef;
      color: #212529;
      border-color: #dee2e6;
    }
    
    .global-browser-tab.active {
      background: #667eea;
      color: white;
      font-weight: 600;
      border-color: #667eea;
      box-shadow: 0 2px 6px rgba(102, 126, 234, 0.2);
    }
    
    .browser-content-section {
      display: none;
    }
    
    .browser-content-section.active {
      display: block;
    }
    
    .browser-content-inner {
      padding: 16px;
    }
    
    .date-group {
      margin-bottom: 16px;
      background: #fff;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    
    .date-group:last-child {
      margin-bottom: 0;
    }
    
    .date-title {
      font-size: 14px;
      font-weight: 600;
      color: #2c3e50;
      margin-bottom: 12px;
      padding: 8px 12px;
      background: #f8f9fa;
      border-left: 3px solid #667eea;
      border-radius: 4px;
    }
    
    .date-title::before {
      content: '📅';
      font-size: 16px;
      margin-right: 8px;
    }
    
    .screenshot-time {
      background: #f8f9fa;
      color: #495057;
      font-size: 11px;
      font-weight: 500;
      padding: 4px 8px;
      text-align: center;
      white-space: nowrap;
      border-bottom: 1px solid #e9ecef;
    }
    
    .screenshot-route {
      background: #fff3cd;
      color: #fff;
      font-size: 10px;
      font-weight: 600;
      padding: 3px 8px;
      text-align: center;
      border-bottom: 1px solid #e9ecef;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .screenshot-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(500px, 1fr));
      gap: 12px;
    }
    
    .screenshot-card {
      background: #f8f9fa;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid #dee2e6;
      display: flex;
      flex-direction: column;
    }
    
    .screenshot-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      transition: all 0.3s ease;
    }
    
    .screenshot-image {
      width: 100%;
      height: 350px;
      object-fit: contain;
      background: white;
      cursor: pointer;
    }
    
    .screenshot-image:hover {
      transform: scale(1.05);
      transition: transform 0.3s ease;
    }
    
    .no-screenshots {
      text-align: center;
      padding: 40px;
      color: #999;
      font-size: 14px;
      background: #f8f9fa;
      border-radius: 8px;
    }
    
    .diff-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(900px, 1fr));
      gap: 20px;
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
      color: #495057;
      margin-bottom: 12px;
      padding: 8px 12px;
      background: #f8f9fa;
      border-left: 3px solid #667eea;
      border-radius: 4px;
    }
    
    .diff-browser-content {
      display: none;
    }
    
    .diff-browser-content.active {
      display: block;
    }
    
    .diff-card {
      background: white;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #dee2e6;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    
    .diff-card.diff-browser-content {
      display: none;
    }
    
    .diff-card.diff-browser-content.active {
      display: block;
    }
    
    .diff-header {
      background: #f8f9fa;
      padding: 10px 15px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid #dee2e6;
    }
    
    .diff-type {
      font-size: 12px;
      font-weight: bold;
      color: #667eea;
      background: #e9ecef;
      padding: 4px 8px;
      border-radius: 4px;
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
      font-weight: bold;
      color: #333;
      margin-left: auto;
    }
    
    .diff-images {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      padding: 10px;
    }
    
    .diff-image-container {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    
    .diff-image-label {
      font-size: 11px;
      color: #666;
      text-align: center;
      font-weight: 500;
    }
    
    .diff-image-container img {
      width: 100%;
      height: 200px;
      object-fit: contain;
      background: white;
      border: 1px solid #dee2e6;
      border-radius: 4px;
      cursor: pointer;
      transition: transform 0.3s ease;
    }
    
    .diff-image-container img:hover {
      transform: scale(1.05);
    }
    
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.9);
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
      border-radius: 10px;
      overflow: hidden;
    }
    
    .modal-image {
      max-width: 100%;
      max-height: 90vh;
      display: block;
      transition: transform 0.3s ease;
    }
    
    .modal-image:hover {
      transform: scale(1.02);
    }
    
    .modal-close {
      position: absolute;
      top: 20px;
      right: 20px;
      background: white;
      border: none;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      font-size: 24px;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      z-index: 1001;
    }
    
    .modal-close:hover {
      background: #f0f0f0;
    }
    
    .tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      border-bottom: 2px solid #dee2e6;
      padding-bottom: 2px;
    }
    
    .tab {
      padding: 12px 24px;
      background: white;
      border: none;
      border-radius: 8px 8px 0 0;
      cursor: pointer;
      font-size: 16px;
      font-weight: 500;
      color: #666;
      transition: all 0.3s ease;
    }
    
    .tab:hover {
      background: #f8f9fa;
      color: #333;
    }
    
    .tab.active {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-weight: bold;
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
      padding: 80px 20px;
      text-align: center;
      background: white;
      border-radius: 10px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }
    
    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 20px;
      animation: bounce 2s ease-in-out infinite;
    }
    
    @keyframes bounce {
      0%, 100% {
        transform: translateY(0);
      }
      50% {
        transform: translateY(-10px);
      }
    }
    
    .empty-state-title {
      font-size: 20px;
      font-weight: 600;
      color: #495057;
      margin-bottom: 10px;
    }
    
    .empty-state-description {
      font-size: 14px;
      color: #6c757d;
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
  
  ${testDirComparisons.length > 1 ? `
  <div class="test-dir-tabs">
    <div class="test-dir-tabs-label">选择测试目录：</div>
    ${testDirTabs}
  </div>` : ''}
  
  ${hasOptimizedData ? `
  <div class="global-browser-tabs">
    <div class="global-browser-tabs-label">选择浏览器：</div>
    ${browserList.map((browser, index) => `
      <button class="global-browser-tab ${index === 0 ? 'active' : ''}" data-browser="${browser}" onclick="switchGlobalBrowser('${browser}')">
        ${getBrowserIcon(browser)}
        <span>${browser}</span>
      </button>
    `).join('')}
  </div>` : ''}
  
  <div class="tabs">
    <button class="tab active" onclick="switchTab('optimized')">Optimized 版本</button>
    <button class="tab" onclick="switchTab('optimized-diff')">Optimized 差异</button>
    <button class="tab" onclick="switchTab('diff-only')">有差异</button>
  </div>
  
  <div id="optimized-content" class="tab-content active">
    ${testDirContents}
  </div>
  
  <div id="optimized-diff-content" class="tab-content">
    <div class="empty-state" id="optimized-diff-empty" style="display: none;">
      <div class="empty-state-icon">🎉</div>
      <div class="empty-state-title">太棒了！没有发现任何差异</div>
      <div class="empty-state-description">所有截图都完全一致，无需修改</div>
    </div>
    ${testDirDiffContents}
  </div>
  
  <div id="diff-only-content" class="tab-content">
    <div class="empty-state" id="diff-only-empty" style="display: none;">
      <div class="empty-state-icon">🎉</div>
      <div class="empty-state-title">太棒了！没有发现任何差异</div>
      <div class="empty-state-description">所有截图都完全一致，无需修改</div>
    </div>
    ${testDirDiffOnlyContents}
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
      if (activeBrowserTab) {
        const browser = activeBrowserTab.getAttribute('data-browser');
        if (browser) {
          switchGlobalBrowser(browser);
        }
      }
    }
    
    function switchTestDir(testDir) {
      const tabs = document.querySelectorAll('.test-dir-tab');
      const contents = document.querySelectorAll('.test-dir-content');
      
      tabs.forEach(function(tab) {
        tab.classList.remove('active');
      });
      contents.forEach(function(content) {
        content.style.display = 'none';
      });
      
      const targetTab = document.querySelector('.test-dir-tab[data-test-dir="' + testDir + '"]');
      const targetContents = document.querySelectorAll('.test-dir-content[data-test-dir="' + testDir + '"]');
      
      if (targetTab) targetTab.classList.add('active');
      targetContents.forEach(function(content) {
        content.style.display = 'block';
      });
      
      const activeBrowserTab = document.querySelector('.global-browser-tab.active');
      if (activeBrowserTab) {
        const browser = activeBrowserTab.getAttribute('data-browser');
        if (browser) {
          switchGlobalBrowser(browser);
        }
      }
    }
    
    function switchGlobalBrowser(browser) {
      const tabs = document.querySelectorAll('.global-browser-tab');
      const sections = document.querySelectorAll('.browser-content-section');
      const diffCards = document.querySelectorAll('.diff-card.diff-browser-content');
      
      tabs.forEach(function(tab) {
        tab.classList.remove('active');
      });
      sections.forEach(function(section) {
        section.classList.remove('active');
      });
      diffCards.forEach(function(card) {
        card.classList.remove('active');
      });
      
      const targetTab = document.querySelector('.global-browser-tab[data-browser="' + browser + '"]');
      const targetSections = document.querySelectorAll('.browser-content-section[data-browser="' + browser + '"]');
      const targetDiffCards = document.querySelectorAll('.diff-card.diff-browser-content[data-browser="' + browser + '"]');
      
      if (targetTab) targetTab.classList.add('active');
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
      targetDiffCards.forEach(function(card) {
        card.classList.add('active');
      });
      
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
        const allComparisons = document.querySelectorAll('.comparison');
        allComparisons.forEach(function(comparison) {
          const hasActiveDiffCard = comparison.querySelector('.diff-card.diff-browser-content.active');
          if (hasActiveDiffCard) {
            comparison.style.display = 'block';
          } else {
            comparison.style.display = 'none';
          }
        });
        
        if (activeTab.id === 'diff-only-content') {
          const emptyState = document.getElementById('diff-only-empty');
          const hasAnyDiff = Array.from(allComparisons).some(function(comparison) {
            return comparison.querySelector('.diff-card.diff-browser-content.active');
          });
          if (emptyState) {
            emptyState.style.display = hasAnyDiff ? 'none' : 'flex';
          }
        } else if (activeTab.id === 'optimized-diff-content') {
          const emptyState = document.getElementById('optimized-diff-empty');
          const hasAnyDiff = Array.from(allComparisons).some(function(comparison) {
            return comparison.querySelector('.diff-card.diff-browser-content.active');
          });
          if (emptyState) {
            emptyState.style.display = hasAnyDiff ? 'none' : 'flex';
          }
        }
      } else if (activeTab && activeTab.id === 'optimized-content') {
        const allComparisons = document.querySelectorAll('.comparison');
        allComparisons.forEach(function(comparison) {
          const hasActiveSection = comparison.querySelector('.browser-content-section.active');
          if (hasActiveSection) {
            comparison.style.display = 'block';
          } else {
            comparison.style.display = 'none';
          }
        });
      } else {
        const allComparisons = document.querySelectorAll('.comparison');
        allComparisons.forEach(function(comparison) {
          comparison.style.display = 'block';
        });
      }
    }
    
    document.addEventListener('DOMContentLoaded', function() {
      const firstTab = document.querySelector('.global-browser-tab.active');
      if (firstTab) {
        const browser = firstTab.getAttribute('data-browser');
        if (browser) {
          switchGlobalBrowser(browser);
        }
      }
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
  
  const testDirs = fs.readdirSync(screenshotsDir)
    .filter(f => fs.statSync(path.join(screenshotsDir, f)).isDirectory())
    .filter(f => !f.startsWith('.'))
    .sort()
    .reverse();
  
  console.log('📸 正在扫描截图目录...');
  console.log(`  截图根目录: ${screenshotsDir}`);
  console.log(`  找到 ${testDirs.length} 个测试目录: ${testDirs.join(', ')}`);
  console.log(`  输出文件: ${outputPath}`);
  
  const testDirComparisons: TestDirComparisons[] = [];
  
  for (const testDir of testDirs) {
    const testPath = path.join(screenshotsDir, testDir);
    console.log(`\n🔍 处理测试目录: ${testDir}`);
    
    const screenshots = getAllScreenshots(testPath, 'optimized', outputPath);
    
    if (screenshots.size > 0) {
      const comparisons = await generateTestComparisons(testDir, screenshots, outputPath);
      testDirComparisons.push({
        testDir,
        comparisons
      });
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
