import fs from 'fs';
import path from 'path';

interface ElementInfo {
  name: string;
  locator: string;
  type: string;
}

interface ActionInfo {
  method: string;
  element: string;
  description: string;
}

class POMGenerator {
  private filePath: string;
  private content: string;
  private elements: ElementInfo[];
  private actions: ActionInfo[];

  constructor(filePath: string) {
    this.filePath = filePath;
    this.content = fs.readFileSync(filePath, 'utf-8');
    this.elements = [];
    this.actions = [];
  }

  analyze(): void {
    this.extractElements();
    this.extractActions();
  }

  private extractElements(): void {
    const lines = this.content.split('\n');
    
    lines.forEach((line, index) => {
      if (line.includes('page.getBy')) {
        this.parseGetByElement(line);
      } else if (line.includes('page.locator')) {
        this.parseLocatorElement(line);
      }
    });
  }

  private parseGetByElement(line: string): void {
    const getByMatch = line.match(/page\.(getBy\w+)\(['"]([^'"]+)['"](,\s*(\{[^}]*\}))?\)/);
    
    if (getByMatch) {
      const [, type, selector, , options] = getByMatch;
      const elementName = this.generateElementName(selector, type, options);
      
      this.elements.push({
        name: elementName,
        locator: this.generateLocator(type, selector, options),
        type: type
      });
    }
  }

  private parseLocatorElement(line: string): void {
    const locatorMatch = line.match(/page\.locator\(['"]([^'"]+)['"]\)/);
    
    if (locatorMatch) {
      const [, selector] = locatorMatch;
      const elementName = this.generateElementName(selector, 'locator');
      
      this.elements.push({
        name: elementName,
        locator: `page.locator('${selector}')`,
        type: 'locator'
      });
    }
  }

  private generateElementName(selector: string, type: string, options?: string): string {
    let cleanSelector = selector;
    
    if (options && options.includes('name')) {
      const nameMatch = options.match(/name:\s*['"]([^'"]+)['"]/);
      if (nameMatch) {
        cleanSelector = nameMatch[1];
      }
    }
    
    cleanSelector = cleanSelector
      .replace(/[^\w\u4e00-\u9fa5]/g, ' ')
      .trim()
      .split(' ')
      .map((word, index) => {
        if (index === 0) return word.toLowerCase();
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join('');

    let result: string;
    
    if (type === 'getByRole') {
      result = `${cleanSelector}Button`;
    } else if (type === 'getByText') {
      result = `${cleanSelector}Text`;
    } else if (type === 'getByLabel') {
      result = `${cleanSelector}Input`;
    } else if (type === 'getByTestId') {
      result = `${cleanSelector}Element`;
    } else {
      result = cleanSelector || 'element';
    }
    
    if (/^\d/.test(result)) {
      result = 'item' + result;
    }
    
    return result;
  }

  private generateLocator(type: string, selector: string, options?: string): string {
    const cleanOptions = options ? `, ${options}` : '';
    
    switch (type) {
      case 'getByRole':
        return `page.getByRole('${selector}'${cleanOptions})`;
      case 'getByText':
        return `page.getByText('${selector}')`;
      case 'getByLabel':
        return `page.getByLabel('${selector}')`;
      case 'getByTestId':
        return `page.getByTestId('${selector}')`;
      default:
        return `page.locator('${selector}')`;
    }
  }

  private extractActions(): void {
    const lines = this.content.split('\n');
    
    lines.forEach((line, index) => {
      if (line.includes('.click()')) {
        this.parseClickAction(line);
      } else if (line.includes('.fill(')) {
        this.parseFillAction(line);
      } else if (line.includes('.check()')) {
        this.parseCheckAction(line);
      }
    });
  }

  private parseClickAction(line: string): void {
    const elementMatch = line.match(/page\.(getBy\w+|locator)\(['"]([^'"]+)['"](?:,\s*(\{[^}]*\}))?\)\.click\(\)/);
    
    if (elementMatch) {
      const [, type, selector, options] = elementMatch;
      const elementName = this.generateElementName(selector, type, options);
      
      this.actions.push({
        method: 'click',
        element: elementName,
        description: `点击${selector}`
      });
    }
  }

  private parseFillAction(line: string): void {
    const fillMatch = line.match(/page\.(getBy\w+|locator)\(['"]([^'"]+)['"]\)\.fill\(['"]([^'"]+)['"]\)/);
    
    if (fillMatch) {
      const [, type, selector, value] = fillMatch;
      const elementName = this.generateElementName(selector, type);
      
      this.actions.push({
        method: 'fill',
        element: elementName,
        description: `输入${value}`
      });
    }
  }

  private parseCheckAction(line: string): void {
    const checkMatch = line.match(/page\.(getBy\w+|locator)\(['"]([^'"]+)['"](?:,\s*(\{[^}]*\}))?\)\.check\(\)/);
    
    if (checkMatch) {
      const [, type, selector, options] = checkMatch;
      const elementName = this.generateElementName(selector, type, options);
      
      this.actions.push({
        method: 'check',
        element: elementName,
        description: `勾选${selector}`
      });
    }
  }

  generatePOMClass(): string {
    const className = this.generateClassName();
    const uniqueElements = this.getUniqueElements();
    
    let pom = `import { Page, Locator } from '@playwright/test';\n\n`;
    pom += `export class ${className} {\n`;
    pom += `  readonly page: Page;\n\n`;
    
    uniqueElements.forEach(element => {
      pom += `  readonly ${element.name}: Locator;\n`;
    });
    
    pom += `\n  constructor(page: Page) {\n`;
    pom += `    this.page = page;\n`;
    
    uniqueElements.forEach(element => {
      pom += `    this.${element.name} = ${element.locator};\n`;
    });
    
    pom += `  }\n\n`;
    
    pom += `  async navigateTo() {\n`;
    pom += `    // 默认使用 Playwright 的 baseURL；如需可在测试中传入绝对 URL\n`;
    pom += `    await this.page.goto('/main/home');\n`;
    pom += `    await this.page.waitForLoadState('networkidle');\n`;
    pom += `  }\n\n`;
    
    this.actions.forEach(action => {
      pom += `  async ${this.generateMethodName(action)}() {\n`;
      pom += `    await this.${action.element}.${action.method}();\n`;
      pom += `    await this.page.waitForTimeout(500);\n`;
      pom += `  }\n\n`;
    });
    
    pom += `}\n`;
    
    return pom;
  }

  private generateClassName(): string {
    const fileName = path.basename(this.filePath, '.spec.ts');
    let className = fileName
      .replace(/record[_-]/, '')
      .replace(/\.optimized$/, '') // 移除 .optimized 后缀
      .replace(/[_-]\d{4}-\d{2}-\d{2}T?\d{2}-\d{2}-\d{2}.*/, '') // 完全移除时间戳
      .replace(/[_-]\d+/g, '') // 移除所有包含数字的分段
      .replace(/\d+/g, '') // 移除所有剩余的数字
      .replace(/[^\w\u4e00-\u9fa5]/g, '') // 移除所有非字母数字和中文的字符
      .split(/[_-]/)
      .filter(word => word.length > 0) // 过滤空字符串
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
    
    if (!className || className.length < 3) {
      className = 'HomePage';
    } else {
      className = className + 'Page';
    }
    
    return className;
  }

  private generateMethodName(action: ActionInfo): string {
    const elementName = action.element
      .replace(/[^\w\u4e00-\u9fa5]/g, '')
      .trim();
    
    const actionType = action.method === 'click' ? '点击' : action.method === 'fill' ? '填写' : action.method === 'type' ? '输入' : action.method === 'check' ? '勾选' : '操作';
    
    return `${actionType}${elementName}` || 'performAction';
  }

  private getUniqueElements(): ElementInfo[] {
    const uniqueMap = new Map<string, ElementInfo>();
    
    this.elements.forEach(element => {
      if (!uniqueMap.has(element.name)) {
        uniqueMap.set(element.name, element);
      }
    });
    
    return Array.from(uniqueMap.values());
  }

  save(outputPath?: string): void {
    this.analyze();
    const pom = this.generatePOMClass();
    
    const fileName = path.basename(this.filePath, '.spec.ts');
    const className = this.generateClassName();
    
    // 生成到单独的 POM 文件夹
    const pomDir = path.join('tests/pom');
    if (!fs.existsSync(pomDir)) {
      fs.mkdirSync(pomDir, { recursive: true });
    }
    
    const targetPath = path.join(pomDir, `${className}.ts`);
    
    fs.writeFileSync(targetPath, pom, 'utf-8');
    console.log(`✅ POM 类已生成: ${targetPath}`);
    
    this.generateTestFile(className, targetPath);
  }

  private generateTestFile(className: string, pomPath: string): void {
    const relativePath = path.relative('tests/pom', pomPath).replace('.ts', '');
    
    const testNameMatch = this.filePath.match(/([^/]+)\.spec\.ts$/);
    const testName = testNameMatch ? testNameMatch[1].replace(/\.optimized$/, '').replace(/-/g, '_') : 'test';
    const screenshotDir = `screenshots/pom/${testName}`;
    
    const testContent = `import { test, expect } from '@playwright/test';
import fs from 'fs';
import { ${className} } from '${relativePath}';

test.describe('${className.replace('Page', '')}测试', () => {
  test('应该能够执行完整流程', async ({ page }) => {
    const pageObject = new ${className}(page);
    
    await pageObject.navigateTo();
    await expect(page).toHaveURL(/.*huilianyi.*/);
    
    // 截图配置
    const screenshotPath = '${screenshotDir}';
    const now = new Date();
    const runTimestamp = now.getFullYear() + '-' + 
      String(now.getMonth() + 1).padStart(2, '0') + '-' + 
      String(now.getDate()).padStart(2, '0') + '_' + 
      String(now.getHours()).padStart(2, '0') + '-' + 
      String(now.getMinutes()).padStart(2, '0') + '-' + 
      String(now.getSeconds()).padStart(2, '0');
    const runDir = \`\${screenshotPath}/\${runTimestamp}\`;
    if (!fs.existsSync(runDir)) {
      fs.mkdirSync(runDir, { recursive: true });
    }
    const getScreenshotPath = (step: number, type: string, name: string) => \`\${runDir}/step-\${step}-\${type}-\${name}.png\`;
    
    // 截图: 页面加载完成
    await page.screenshot({ path: getScreenshotPath(1, 'home', 'home'), fullPage: false });
    
${this.generateTestSteps(className)}
  });
});
`;
    
    const fileName = path.basename(this.filePath).replace('.optimized', '');
    const testPath = path.join('tests/pom', fileName.replace('.spec.ts', '.pom.spec.ts'));
    
    const dir = path.dirname(testPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(testPath, testContent, 'utf-8');
    console.log(`✅ 测试文件已生成: ${testPath}`);
    
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      console.log(`✅ 截图目录已创建: ${screenshotDir}`);
    }
  }

  private generateTestSteps(className: string): string {
    let stepCounter = 2;
    const steps: string[] = [];
    
    this.actions.forEach((action, index) => {
      const actionName = this.sanitizeActionName(action.description);
      const actionType = action.method;
      
      const type = actionType === 'click' ? 'click' : actionType === 'fill' ? 'fill' : actionType === 'type' ? 'type' : actionType === 'check' ? 'check' : 'action';
      const actionLabel = actionType === 'click' ? '点击' : actionType === 'fill' ? '填写' : actionType === 'type' ? '输入' : actionType === 'check' ? '勾选' : '操作';
      
      const beforeComment = `    // 截图: ${actionLabel}前 ${actionName}`;
      const beforeScreenshot = `    await page.screenshot({ path: getScreenshotPath(${stepCounter}, 'before', '${actionName}'), fullPage: false });`;
      stepCounter++;
      
      const actionCall = `    await pageObject.${this.generateMethodName(action)}();`;
      
      const waitLine = `    await page.waitForTimeout(800);`;
      const afterComment = `    // 截图: ${actionLabel}后 ${actionName}`;
      const afterScreenshot = `    await page.screenshot({ path: getScreenshotPath(${stepCounter}, 'after', '${actionName}'), fullPage: false });`;
      stepCounter++;
      
      steps.push(beforeComment);
      steps.push(beforeScreenshot);
      steps.push(actionCall);
      steps.push(waitLine);
      steps.push(afterComment);
      steps.push(afterScreenshot);
    });
    
    return steps.join('\n');
  }

  private sanitizeActionName(description: string): string {
    return description
      .replace(/[^\w\u4e00-\u9fa5-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 30);
  }
}

function main() {
  const pomEnabled = process.env.ENABLE_POM === '1';
  if (!pomEnabled) {
    console.log('ℹ️  POM 生成功能默认关闭（ENABLE_POM!=1），已跳过。');
    console.log('如需临时启用：ENABLE_POM=1 npm run generate-pom -- <测试文件路径>');
    process.exit(0);
  }

  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('使用方法: npm run generate-pom <测试文件路径>');
    console.log('示例: npm run generate-pom tests/raw-recordings/2026-03-02T10-20-26.spec.ts');
    process.exit(1);
  }

  const filePath = args[0];
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ 文件不存在: ${filePath}`);
    process.exit(1);
  }

  console.log(`🔧 正在生成 POM: ${filePath}`);
  
  const generator = new POMGenerator(filePath);
  generator.save();
  
  console.log('✨ POM 生成完成！');
}

main();
