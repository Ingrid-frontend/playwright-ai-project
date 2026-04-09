import * as fs from 'fs';
import * as path from 'path';

interface Action {
  index: number;
  type: 'click' | 'fill' | 'type' | 'check' | 'selectOption' | 'press' | 'goto';
  selector: string;
  text?: string;
  url?: string;
  originalLine: number;
}

interface TestBlock {
  start: number;
  end: number;
  bodyStart: number;
}

class RawRecordingOptimizer {
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
    return this.generateOptimizedCode();
  }

  private isLoginAction(line: string): boolean {
    const loginKeywords = [
      '登 录',
      '账号登录',
      '请输入手机号/邮箱',
      '密码',
      '我已阅读并同意',
      '用户协议',
      '隐私协议',
      'storageState',
      'loginState'
    ];
    
    return loginKeywords.some(keyword => line.includes(keyword));
  }

  private analyzeActions(): void {
    this.lines.forEach((line, index) => {
      // 跳过登录相关的操作
      if (this.isLoginAction(line)) {
        console.log(`⏭️  跳过登录操作: ${line.substring(0, 100)}...`);
        return;
      }
      
      const clickMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.click\(\)/);
      const fillMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.(fill|type)\(.+\)/);
      const checkMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.check\(\)/);
      const selectMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.selectOption\(.+\)/);
      const pressMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.press\(.+\)/);
      const gotoMatch = line.match(/await page\.goto\(.+\)/);

      if (gotoMatch) {
        this.actions.push({
          index: this.actions.length,
          type: 'goto',
          selector: '',
          url: this.extractUrl(line),
          originalLine: index
        });
      } else if (clickMatch) {
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

    let end = start;
    let braceCount = 0;
    let foundOpening = false;

    for (let i = bodyStart; i < this.lines.length; i++) {
      const line = this.lines[i];
      const openingBraces = (line.match(/\{/g) || []).length;
      const closingBraces = (line.match(/\}/g) || []).length;

      if (openingBraces > 0 && !foundOpening) {
        foundOpening = true;
      }

      if (foundOpening) {
        braceCount += openingBraces;
        braceCount -= closingBraces;

        if (braceCount === 0) {
          end = i;
          break;
        }
      }
    }

    this.testBlock = {
      start,
      end,
      bodyStart
    };
  }

  private findTestBodyStart(startIndex: number): number {
    for (let i = startIndex; i < this.lines.length; i++) {
      if (this.lines[i].includes('{')) {
        return i;
      }
    }
    return -1;
  }

  private generateOptimizedCode(): string {
    if (!this.testBlock) {
      console.error('❌ 未找到测试块');
      return '';
    }

    const testName = this.extractTestName(this.lines[this.testBlock.start]);
    const fileName = path.basename(this.filePath, '.spec.ts');
    
    const dateStr = this.extractDateFromFileName(fileName);
    let screenshotDir = `screenshots/${fileName}`;
    
    if (dateStr) {
      const dateCategory = this.getDateCategoryForDate(dateStr);
      screenshotDir = `screenshots/${dateCategory}/${fileName}`;
    }

    let actionIndex = 1;
    const optimizedLines = [
      "import { test, expect } from '@playwright/test';",
      "import fs from 'fs';",
      "import path from 'path';",
      "",
      `test('${testName}', async ({ page }) => {`,
      `  test.setTimeout(60000);`,
      "",
      `  const screenshotDir = '${screenshotDir}';`,
      `  if (!fs.existsSync(screenshotDir)) {`,
      `    fs.mkdirSync(screenshotDir, { recursive: true });`,
      `  }`,
      "",
      `  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');`,
      `  const runDir = path.join(screenshotDir, timestamp);`,
      `  fs.mkdirSync(runDir, { recursive: true });`,
      ""
    ];

    // 检查是否有页面导航操作
    const hasGotoAction = this.actions.some(action => action.type === 'goto');
    
    if (!hasGotoAction) {
      // 如果没有页面导航，添加一个默认的
      optimizedLines.push(`  // 导航到首页`);
      optimizedLines.push(`  await page.goto('https://stage.huilianyi.com/', { waitUntil: 'networkidle' });`);
      optimizedLines.push(`  await page.waitForTimeout(2000);`);
    }

    this.actions.forEach((action, index) => {
      optimizedLines.push("");
      optimizedLines.push(`  // Step ${actionIndex}: ${this.getActionLabel(action)}`);
      
      if (action.type === 'goto') {
        optimizedLines.push(`  await page.goto('${action.url}', { waitUntil: 'networkidle' });`);
        optimizedLines.push(`  await page.waitForTimeout(2000);`);
        optimizedLines.push(`  await page.screenshot({ path: path.join(runDir, \`step-${actionIndex}-before-action.png\`), fullPage: true });`);
        actionIndex++;
      } else {
        const originalLine = this.lines[action.originalLine];
        let fullSelector = this.extractSelector(originalLine);
        
        // 优化选择器
        fullSelector = this.optimizeSelector(fullSelector);
        
        optimizedLines.push(`  await page.screenshot({ path: path.join(runDir, \`step-${actionIndex}-before-action.png\`), fullPage: true });`);
        optimizedLines.push(`  const _locator${actionIndex} = ${fullSelector};`);
        optimizedLines.push(`  await page.waitForTimeout(1000).catch(() => {});`);
        
        // 增强iframe元素的等待策略
        if (fullSelector.includes('iframe') && fullSelector.includes('contentFrame')) {
          optimizedLines.push(`  // 增强iframe元素的可见性等待`);
          optimizedLines.push(`  await _locator${actionIndex}.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});`);
        } else {
          optimizedLines.push(`  await _locator${actionIndex}.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});`);
        }
        
        optimizedLines.push(`  await _locator${actionIndex}.scrollIntoViewIfNeeded().catch(() => {});`);
        
        switch (action.type) {
          case 'click':
            // 针对iframe元素的点击优化
            if (fullSelector.includes('iframe') && fullSelector.includes('contentFrame')) {
              optimizedLines.push(`  // 针对iframe元素的点击优化`);
              optimizedLines.push(`  try {`);
              optimizedLines.push(`    await _locator${actionIndex}.click({ timeout: 10000 });`);
              optimizedLines.push(`  } catch (e) {`);
              optimizedLines.push(`    console.log("⚠️ 正常点击失败，尝试force click...");`);
              optimizedLines.push(`    await _locator${actionIndex}.click({ force: true, timeout: 5000 });`);
              optimizedLines.push(`  }`);
            } else {
              optimizedLines.push(`  await _locator${actionIndex}.click({ timeout: 30000, force: true });`);
            }
            break;
          case 'fill':
            optimizedLines.push(`  await _locator${actionIndex}.fill("${action.text || ''}", { timeout: 30000 });`);
            break;
          case 'type':
            optimizedLines.push(`  await _locator${actionIndex}.type("${action.text || ''}", { timeout: 30000 });`);
            break;
          case 'check':
            optimizedLines.push(`  await _locator${actionIndex}.check({ timeout: 30000 });`);
            break;
          case 'selectOption':
            optimizedLines.push(`  await _locator${actionIndex}.selectOption("${action.text || ''}", { timeout: 30000 });`);
            break;
          case 'press':
            optimizedLines.push(`  await _locator${actionIndex}.press("${action.text || ''}", { timeout: 30000 });`);
            break;
        }
        
        optimizedLines.push(`  await page.waitForTimeout(2000);`);
        optimizedLines.push(`  await page.screenshot({ path: path.join(runDir, \`step-${actionIndex}-after-action.png\`), fullPage: true });`);
        actionIndex++;
      }
    });

    optimizedLines.push("");
    optimizedLines.push(`  console.log('✅ 测试完成: ${testName}');`);
    optimizedLines.push(`});`);

    return optimizedLines.join('\n');
  }

  private extractTestName(line: string): string {
    const match = line.match(/test\(['"]([^'"]+)['"]/);
    return match ? match[1] : 'test';
  }

  private extractUrl(line: string): string {
    const match = line.match(/page\.goto\(['"]([^'"]+)['"]/);
    return match ? match[1] : '';
  }



  getDateCategoryForDate(dateStr: string): string {
    const configPath = path.join(process.cwd(), 'config', 'date-categories.json');
    
    if (!fs.existsSync(configPath)) {
      console.warn(`⚠️  配置文件不存在: ${configPath}`);
      return 'default';
    }
    
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent) as { dateCategories: string[] };
      
      const fileDate = new Date(dateStr);
      
      for (const category of config.dateCategories) {
        const year = parseInt(category.substring(0, 4));
        const month = parseInt(category.substring(4, 6)) - 1;
        const day = parseInt(category.substring(6, 8));
        const categoryDate = new Date(year, month, day);
        
        if (fileDate < categoryDate) {
          return category;
        }
      }
      
      return config.dateCategories[config.dateCategories.length - 1];
    } catch (error) {
      console.warn(`⚠️  读取配置文件失败: ${error}`);
      return 'default';
    }
  }

  public extractDateFromFileName(fileName: string): string | null {
    const datePatterns = [
      { pattern: /(\d{4})-(\d{2})-(\d{2})/, type: 'dash' }, // 2026-03-16
      { pattern: /(\d{4})_(\d{1,2})_(\d{1,2})/, type: 'underscore' }, // 2026_3_18
      { pattern: /(\d{4})(\d{2})(\d{2})/, type: 'compact' }, // 20260313
    ];
    
    for (const { pattern, type } of datePatterns) {
      const match = fileName.match(pattern);
      if (match) {
        if (type === 'dash') {
          return `${match[1]}-${match[2]}-${match[3]}`;
        } else if (type === 'underscore') {
          const month = match[2].padStart(2, '0');
          const day = match[3].padStart(2, '0');
          return `${match[1]}-${month}-${day}`;
        } else if (type === 'compact') {
          return `${match[1]}-${match[2]}-${match[3]}`;
        }
      }
    }
    
    return null;
  }

  private extractSelector(line: string): string {
    const match = line.match(/await page\.(getBy\w*|locator|contentFrame)\(.+\)\.(click|fill|type|check|selectOption|press)\(/);
    if (match) {
      return line.replace(/await /, '').replace(/\.(click|fill|type|check|selectOption|press)\(.*/, '');
    }
    return '';
  }

  private extractText(line: string): string | undefined {
    const nameMatch = line.match(/name:\s*['"]([^'"]+)['"]/);
    if (nameMatch) return nameMatch[1];

    const getByTextMatch = line.match(/getByText\(['"]([^'"]+)['"]/);
    if (getByTextMatch) return getByTextMatch[1];

    const fillMatch = line.match(/fill\(['"]([^'"]+)['"]/);
    if (fillMatch) return fillMatch[1];

    const typeMatch = line.match(/type\(['"]([^'"]+)['"]/);
    if (typeMatch) return typeMatch[1];

    return undefined;
  }

  private getActionLabel(action: Action): string {
    if (action.type === 'goto') return `Go to ${action.url || 'page'}`;
    if (action.text) return this.cleanLabel(action.text);
    return "action";
  }

  private cleanLabel(label: string): string {
    return label
      .replace(/\s+/g, "-")
      .replace(/[^\w\u4e00-\u9fa5-]/g, "");
  }

  private optimizeSelector(selector: string): string {
    let optimized = selector;

    // 现有的优化规则
    optimized = optimized.replace(/\.anticon\.anticon-close > svg/, '.anticon.anticon-close');
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

    // 新增优化规则（根据建议）
    
    // 1. 针对iframe内部label的优化
    if (optimized.includes("label") && !optimized.includes("hasText")) {
      // 自动尝试寻找包含协议文字的label
      optimized = optimized.replace(/\.locator\(['"]label['"]\)/, ".locator('label').filter({ hasText: /同意|协议/ })");
    }
    
    // 2. 针对按钮点击，如果是点击里面的span，建议提升到button
    optimized = optimized.replace(/\.getByRole\(['"]button['"]\)\.locator\(['"]span['"]\)/, ".getByRole('button')");
    
    // 3. 永远不要点击path标签，因为path没有尺寸
    if (optimized.endsWith(' > path')) {
      optimized = optimized.replace(' > path', '');
    }
    
    // 4. 如果是iframe元素，添加可见性过滤和.first()
    if (optimized.includes('iframe') && optimized.includes('contentFrame')) {
      // 确保选择器以.first()结尾，避免匹配多个元素
      if (!optimized.endsWith('.first()')) {
        optimized += '.first()';
      }
    }

    return optimized;
  }
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('❌ 请提供测试文件路径或文件夹路径');
  console.error('📖 使用方法:');
  console.error('   单个文件: npm run optimize-raw-recordings -- tests/raw-recordings/test.spec.ts');
  console.error('   批量处理: npm run optimize-raw-recordings -- tests/raw-recordings/');
  process.exit(1);
}

const outputDir = 'tests/optimized';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function processFile(filePath: string): Promise<void> {
  const optimizer = new RawRecordingOptimizer(filePath);
  const result = optimizer.optimize();

  const fileName = path.basename(filePath, '.spec.ts');
  
  const dateStr = optimizer.extractDateFromFileName(fileName);
  let finalOutputDir = outputDir;
  
  if (dateStr) {
    const dateCategory = optimizer.getDateCategoryForDate(dateStr);
    finalOutputDir = path.join(outputDir, dateCategory);
    
    if (!fs.existsSync(finalOutputDir)) {
      fs.mkdirSync(finalOutputDir, { recursive: true });
    }
  }
  
  const outputPath = path.join(finalOutputDir, `${fileName}.optimized.spec.ts`);

  fs.writeFileSync(outputPath, result, 'utf-8');
  console.log(`✅ 优化完成: ${outputPath}`);
}

async function main() {
  const stats = fs.statSync(filePath);
  
  if (stats.isDirectory()) {
    console.log(`📁 批量处理文件夹: ${filePath}`);
    
    const files = fs.readdirSync(filePath)
      .filter(file => file.endsWith('.spec.ts'))
      .sort();
    
    if (files.length === 0) {
      console.log('⚠️  未找到 .spec.ts 文件');
      return;
    }
    
    console.log(`📊 找到 ${files.length} 个测试文件`);
    
    for (const file of files) {
      const fullPath = path.join(filePath, file);
      await processFile(fullPath);
    }
    
    console.log(`🎉 批量优化完成! 共处理 ${files.length} 个文件`);
  } else if (stats.isFile()) {
    if (!filePath.endsWith('.spec.ts')) {
      console.error('❌ 文件必须以 .spec.ts 结尾');
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
