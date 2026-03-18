import * as fs from 'fs';
import * as path from 'path';

interface Action {
  index: number;
  type: 'click' | 'fill' | 'type' | 'check' | 'selectOption' | 'press';
  selector: string;
  text?: string;
  originalLine: number;
}

interface TestBlock {
  start: number;
  end: number;
  bodyStart: number;
}

class ChromeRecorderOptimizer {
  private filePath: string;
  private content: string;
  private lines: string[];
  private actions: Action[] = [];
  private testBlock: TestBlock | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.content = fs.readFileSync(filePath, 'utf-8');
    this.lines = this.content.split('\n');
  }

  optimize(): string {
    this.analyzeActions();
    this.identifyTestBlock();
    this.generateOptimizedCode();
    
    return this.lines.join('\n');
  }

  private analyzeActions(): void {
    this.lines.forEach((line, index) => {
      const clickMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.click\(\)/);
      const fillMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.(fill|type)\(.+\)/);
      const checkMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.check\(\)/);
      const selectMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.selectOption\(.+\)/);
      const pressMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.press\(.+\)/);

      if (clickMatch) {
        this.actions.push({
          index: this.actions.length,
          type: 'click',
          selector: this.extractSelector(line),
          text: this.extractText(line),
          originalLine: index
        });
      } else if (fillMatch) {
        this.actions.push({
          index: this.actions.length,
          type: 'fill',
          selector: this.extractSelector(line),
          text: this.extractText(line),
          originalLine: index
        });
      } else if (checkMatch) {
        this.actions.push({
          index: this.actions.length,
          type: 'check',
          selector: this.extractSelector(line),
          originalLine: index
        });
      } else if (selectMatch) {
        this.actions.push({
          index: this.actions.length,
          type: 'selectOption',
          selector: this.extractSelector(line),
          originalLine: index
        });
      } else if (pressMatch) {
        this.actions.push({
          index: this.actions.length,
          type: 'press',
          selector: this.extractSelector(line),
          originalLine: index
        });
      }
    });
    
    console.log(`🔍 分析到 ${this.actions.length} 个操作`);
  }

  private identifyTestBlock(): void {
    const start = this.lines.findIndex(l => l.includes('test('));
    if (start === -1) {
      this.testBlock = null;
      return;
    }

    const bodyStart = this.findTestBodyStart(start);
    if (bodyStart === -1) {
      this.testBlock = null;
      return;
    }

    let end = -1;
    let braceCount = 0;
    
    for (let i = bodyStart; i < this.lines.length; i++) {
      braceCount += (this.lines[i].match(/{/g) || []).length;
      braceCount -= (this.lines[i].match(/}/g) || []).length;
      
      if (braceCount === 0 && this.lines[i].trim() === '});') {
        end = i;
        break;
      }
    }

    this.testBlock = { start, end, bodyStart };
  }

  private findTestBodyStart(startIndex: number): number {
    for (let i = startIndex; i < this.lines.length; i++) {
      if (this.lines[i].includes('{')) return i;
    }
    return -1;
  }

  private generateOptimizedCode(): void {
    if (!this.testBlock) {
      console.warn('⚠️  未找到有效的 test 块');
      return;
    }

    const { start, end, bodyStart } = this.testBlock;
    const testName = this.extractTestName(this.lines[start]);
    const gotoLine = this.lines.find(l => l.includes('page.goto('));
    const gotoUrl = gotoLine ? this.extractGotoUrl(gotoLine) : '';

    const indent = '  ';
    const screenshotDir = this.getScreenshotDir();

    const result: string[] = [];

    result.push("import { test, expect } from '@playwright/test';");
    result.push("import fs from 'fs';");
    result.push("import { screenshotWhenStable } from '../../utils/screenshot';");
    result.push("");
    result.push(`${indent}test.use({`);
    result.push(`${indent}  storageState: 'storage/loginState/stage.json'`);
    result.push(`${indent}});`);
    result.push("");
    result.push(`${indent}test("${testName}", async ({ page }) => {`);
    result.push(`${indent}  const tracingStarted = await page.context().tracing.start({ screenshots: true, snapshots: true }).catch(() => false);`);
    result.push(`${indent}  const screenshotRoot = '${screenshotDir}';`);
    result.push(`${indent}  const now = new Date();`);
    result.push(`${indent}  const runTimestamp = \`\${now.getFullYear()}-\${String(now.getMonth() + 1).padStart(2, '0')}-\${String(now.getDate()).padStart(2, '0')}_\${String(now.getHours()).padStart(2, '0')}-\${String(now.getMinutes()).padStart(2, '0')}-\${String(now.getSeconds()).padStart(2, '0')}\`;`);
    result.push(`${indent}  const testId = Math.random().toString(36).substring(2, 9);`);
    result.push(`${indent}  let browserInfo = 'unknown';`);
    result.push(`${indent}  let runDir = '';`);
    result.push(`${indent}  const getScreenshotPath = (step: number, label: string) => \`\${runDir}/step-\${step}-\${label}.png\`;`);
    result.push(`${indent}  test.setTimeout(60000);`);
    result.push("");
    
    if (gotoUrl) {
      result.push(`${indent}  await page.goto("${gotoUrl}");`);
      result.push(`${indent}  await expect(page).toHaveURL(/.*huilianyi.*/);`);
      result.push(`${indent}  browserInfo = await page.context().browser()?.browserType().name() || 'unknown';`);
      result.push(`${indent}  runDir = \`\${screenshotRoot}/\${runTimestamp}-\${browserInfo}-\${testId}\`;`);
      result.push(`${indent}  if (!fs.existsSync(runDir)) {`);
      result.push(`${indent}    fs.mkdirSync(runDir, { recursive: true });`);
      result.push(`${indent}  }`);
      result.push("");
    }

    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i];
      const step = i + 1;
      const label = this.getActionLabel(action);
      const stepName = `step-${step}-${label}`;

      result.push(`${indent}  await test.step('${stepName}', async () => {`);
      result.push(`${indent}    const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(page, getScreenshotPath(${step}, 'before-${label}'));`);
      result.push(`${indent}    console.log('📍 当前路由:', beforeRoute);`);
      result.push(`${indent}    try {`);
      result.push(`${indent}      ${this.generateActionCode(action)}`);
      result.push(`${indent}    } catch (error) {`);
      result.push(`${indent}      console.log(\`❌ 步骤执行失败: \${error instanceof Error ? error.message : String(error)}\`);`);
      result.push(`${indent}      throw error;`);
      result.push(`${indent}    }`);
      result.push(`${indent}    const { path: afterPath, route: afterRoute } = await screenshotWhenStable(page, getScreenshotPath(${step}, 'after-${label}'));`);
      result.push(`${indent}    console.log('📍 当前路由:', afterRoute);`);
      result.push(`${indent}  });`);
      result.push("");
    }

    result.push(`${indent}  if (tracingStarted) {`);
    result.push(`${indent}    await page.context().tracing.stop({ path: \`\${runDir}/trace.zip\` });`);
    result.push(`${indent}  }`);
    result.push(`${indent}});`);

    this.lines = result;
  }

  private generateActionCode(action: Action): string {
    const optimizedSelector = this.optimizeSelector(action.selector);
    
    switch (action.type) {
      case 'click':
        return `const _locator = page.locator("${optimizedSelector}").first();\n      await page.waitForTimeout(1000).catch(() => {});\n      await _locator.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});\n      await _locator.scrollIntoViewIfNeeded().catch(() => {});\n      await _locator.click({ timeout: 30000, force: true });`;
      case 'fill':
        return `const _locator = page.locator("${optimizedSelector}").first();\n      await page.waitForTimeout(1000).catch(() => {});\n      await _locator.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});\n      await _locator.scrollIntoViewIfNeeded().catch(() => {});\n      await _locator.fill("${action.text || ''}", { timeout: 30000 });`;
      case 'type':
        return `const _locator = page.locator("${optimizedSelector}").first();\n      await page.waitForTimeout(1000).catch(() => {});\n      await _locator.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});\n      await _locator.scrollIntoViewIfNeeded().catch(() => {});\n      await _locator.type("${action.text || ''}", { timeout: 30000 });`;
      case 'check':
        return `const _locator = page.locator("${optimizedSelector}").first();\n      await page.waitForTimeout(1000).catch(() => {});\n      await _locator.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});\n      await _locator.scrollIntoViewIfNeeded().catch(() => {});\n      await _locator.check({ timeout: 30000 });`;
      case 'selectOption':
        return `const _locator = page.locator("${optimizedSelector}").first();\n      await page.waitForTimeout(1000).catch(() => {});\n      await _locator.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});\n      await _locator.scrollIntoViewIfNeeded().catch(() => {});\n      await _locator.selectOption("${action.text || ''}", { timeout: 30000 });`;
      case 'press':
        return `const _locator = page.locator("${optimizedSelector}").first();\n      await page.waitForTimeout(1000).catch(() => {});\n      await _locator.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});\n      await _locator.scrollIntoViewIfNeeded().catch(() => {});\n      await _locator.press("${action.text || ''}", { timeout: 30000 });`;
      default:
        return `// Unknown action type: ${action.type}`;
    }
  }

  private optimizeSelector(selector: string): string {
    let optimized = selector;

    optimized = optimized.replace(/\.anticon\.anticon-close > svg/, '.anticon.anticon-close > svg');
    optimized = optimized.replace(/\.ant-table-row\.chooser-table-row > \.ant-table-selection-column > span > \.ant-checkbox-wrapper > \.ant-checkbox > \.ant-checkbox-input/, '.ant-table-row.chooser-table-row .ant-checkbox-input');
    optimized = optimized.replace(/\.anticon\.anticon-down > svg > path/, '.anticon.anticon-down');
    optimized = optimized.replace(/\.anticon\.[^'"]+ > svg > path/g, (match) => {
      const anticonClass = match.match(/\.anticon\.([^'"]+)/)?.[1];
      return `.anticon.${anticonClass}`;
    });
    optimized = optimized.replace(/\.ant-select-selection__rendered/, '.ant-select-selection__rendered');
    optimized = optimized.replace(/^path$/, 'svg path');
    optimized = optimized.replace(/\.warp-svg-icon\.ant-tooltip-open/, '.warp-svg-icon');

    optimized = optimized.replace(/li\.ant-menu-item-active\s+span/, 'li.ant-menu-item span');
    optimized = optimized.replace(/\.ant-menu-item-active/, '');

    return optimized;
  }

  private extractTestName(line: string): string {
    const match = line.match(/test\(['"]([^'"]+)['"]/);
    return match ? match[1] : 'test';
  }

  private extractGotoUrl(line: string): string {
    const match = line.match(/page\.goto\(['"]([^'"]+)['"]\)/);
    return match ? match[1] : '';
  }

  private extractSelector(line: string): string {
    const match = line.match(/page\.(getBy\w*|locator)\((.+)\)\.(click|fill|type|check|selectOption|press)\(/);
    if (match) {
      return match[2].replace(/^['"]|['"]$/g, '');
    }
    return '';
  }

  private extractText(line: string): string | undefined {
    const nameMatch = line.match(/name:\s*['"]([^'"]+)['"]/);
    if (nameMatch) return nameMatch[1];

    const getByTextMatch = line.match(/getByText\(['"]([^'"]+)['"]\)/);
    if (getByTextMatch) return getByTextMatch[1];

    const fillMatch = line.match(/fill\(['"]([^'"]+)['"]\)/);
    if (fillMatch) return fillMatch[1];

    return undefined;
  }

  private getActionLabel(action: Action): string {
    if (action.text) return this.cleanLabel(action.text);
    return "action";
  }

  private cleanLabel(label: string): string {
    return label
      .replace(/\s+/g, "-")
      .replace(/[^\w\u4e00-\u9fa5-]/g, "");
  }

  private getScreenshotDir(): string {
    const name = path.basename(this.filePath).replace(".js", "");
    return `screenshots/${name}`;
  }
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('❌ 请提供测试文件路径或文件夹路径');
  console.error('📖 使用方法:');
  console.error('   单个文件: npm run optimize-chrome-recorder -- tests/chrome-recorder/Recording.js');
  console.error('   批量处理: npm run optimize-chrome-recorder -- tests/chrome-recorder/');
  process.exit(1);
}

const outputDir = 'tests/optimized';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function processFile(filePath: string): Promise<void> {
  const optimizer = new ChromeRecorderOptimizer(filePath);
  const result = optimizer.optimize();

  const fileName = path.basename(filePath, '.js');
  const outputPath = path.join(outputDir, `${fileName}.optimized.spec.ts`);

  fs.writeFileSync(outputPath, result, 'utf-8');
  console.log(`✅ 优化完成: ${outputPath}`);
}

async function main() {
  const stats = fs.statSync(filePath);
  
  if (stats.isDirectory()) {
    console.log(`📁 批量处理文件夹: ${filePath}`);
    
    const files = fs.readdirSync(filePath)
      .filter(file => file.endsWith('.js'))
      .sort();
    
    if (files.length === 0) {
      console.log('⚠️  未找到 .js 文件');
      return;
    }
    
    console.log(`📊 找到 ${files.length} 个测试文件`);
    
    for (const file of files) {
      const fullPath = path.join(filePath, file);
      await processFile(fullPath);
    }
    
    console.log(`🎉 批量优化完成! 共处理 ${files.length} 个文件`);
  } else if (stats.isFile()) {
    if (!filePath.endsWith('.js')) {
      console.error('❌ 文件必须以 .js 结尾');
      process.exit(1);
    }
    await processFile(filePath);
  } else {
    console.error('❌ 路径不存在或不是文件/文件夹');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ 处理失败:', error);
  process.exit(1);
});