import fs from 'fs';
import path from 'path';
import readline from 'readline';

interface GenerateOptions {
  code?: string;
  file?: string;
  name?: string;
  description?: string;
}

class RawRecordingGenerator {
  private outputDir = 'tests/raw-recordings';
  
  constructor() {
    this.ensureOutputDir();
  }
  
  private ensureOutputDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }
  
  private generateTimestamp(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  }
  
  private extractContentInfo(code: string): string {
    const lines = code.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length === 0) {
      return 'empty';
    }
    
    const firstLine = lines[0];
    
    const patterns = [
      { regex: /page\.goto\(['"]([^'"]+)['"]\)/, extract: (match: RegExpMatchArray) => `goto-${this.extractDomain(match[1])}` },
      { regex: /page\.getBy(?:Role|Text|Label|Placeholder|AltText)\([^)]*name\s*:\s*['"]([^'"]+)['"]/i, extract: (match: RegExpMatchArray) => `click-${this.sanitizeName(match[1])}` },
      { regex: /page\.getByText\(['"]([^'"]+)['"]/i, extract: (match: RegExpMatchArray) => `click-${this.sanitizeName(match[1])}` },
      { regex: /page\.locator\(['"]([^'"]+)['"]/i, extract: (match: RegExpMatchArray) => `locator-${this.extractSelectorType(match[1])}` },
      { regex: /page\.getByRole\(['"]([^'"]+)['"]/i, extract: (match: RegExpMatchArray) => `role-${match[1]}` },
    ];
    
    for (const pattern of patterns) {
      const match = firstLine.match(pattern.regex);
      if (match) {
        return pattern.extract(match);
      }
    }
    
    const firstAction = lines.find(line => 
      line.includes('page.') && 
      (line.includes('.click(') || line.includes('.fill(') || line.includes('.type('))
    );
    
    if (firstAction) {
      if (firstAction.includes('.click(')) return 'click-action';
      if (firstAction.includes('.fill(')) return 'fill-action';
      if (firstAction.includes('.type(')) return 'type-action';
    }
    
    return 'test';
  }
  
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const parts = hostname.split('.');
      if (parts.length >= 2) {
        return parts[parts.length - 2];
      }
      return hostname;
    } catch {
      return 'unknown';
    }
  }
  
  private sanitizeName(name: string): string {
    return name
      .replace(/[^\w\u4e00-\u9fa5]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 20);
  }

  private sanitizePathSegment(name: string): string {
    return name
      .replace(/[^\w\u4e00-\u9fa5-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .substring(0, 18) || 'test';
  }

  private shortenSegment(name: string, maxLength = 8): string {
    const cleaned = this.sanitizePathSegment(name);
    return cleaned.length > maxLength ? cleaned.substring(0, maxLength) : cleaned;
  }

  private extractActionKeywords(code: string): string[] {
    const keywords: string[] = [];
    const lines = code.split('\n').map(line => line.trim()).filter(Boolean);

    for (const line of lines) {
      const gotoMatch = line.match(/page\.goto\(['"]([^'"]+)['"]\)/);
      if (gotoMatch) {
        // 域名保留更直观的前缀，不要裁得过短导致 example 变成 exampl
        keywords.push(this.shortenSegment(this.extractDomain(gotoMatch[1]), 12));
        continue;
      }

      const textMatch = line.match(/getBy(?:Role|Text|Label|Placeholder|AltText)\([^)]*name\s*:\s*['"]([^'"]+)['"]/i)
        || line.match(/getByText\(['"]([^'"]+)['"]/i)
        || line.match(/fill\(['"]([^'"]+)['"]/i)
        || line.match(/type\(['"]([^'"]+)['"]/i);

      if (textMatch) {
        keywords.push(this.shortenSegment(textMatch[1], 10));
      }

      if (keywords.length >= 2) break;
    }

    return keywords.filter(Boolean);
  }

  private buildBaseName(code: string, customName?: string, description?: string): string {
    const parts: string[] = [];

    if (customName?.trim()) {
      parts.push(this.shortenSegment(customName.trim(), 10));
    }

    if (description?.trim()) {
      parts.push(this.shortenSegment(description.trim(), 10));
    }

    const actionKeywords = this.extractActionKeywords(code);
    parts.push(...actionKeywords.map(keyword => this.shortenSegment(keyword, 10)));

    if (parts.length === 0) {
      return 'test';
    }

    const deduped: string[] = [];
    for (const part of parts) {
      if (!deduped.includes(part)) {
        deduped.push(part);
      }
    }

    return deduped.join('-').substring(0, 28);
  }
  
  private extractSelectorType(selector: string): string {
    if (selector.startsWith('.')) return 'class';
    if (selector.startsWith('#')) return 'id';
    if (selector.startsWith('[')) return 'attribute';
    if (selector.includes('=')) return 'xpath';
    return 'selector';
  }
  
  private generateFileName(code: string, customName?: string): string {
    const timestamp = this.generateTimestamp();
    const baseName = this.buildBaseName(code, customName);
    
    const fileName = `${baseName}_${timestamp}.spec.ts`;
    
    const dateStr = timestamp.split('_')[0];
    const dateCategory = this.getDateCategoryForDate(dateStr);
    const categoryDir = path.join(this.outputDir, dateCategory);
    
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
    }
    
    return path.join(categoryDir, fileName);
  }
  
  private saveOriginalCode(code: string, fileName: string): void {
    // 创建原始代码保存目录
    const originalDir = path.join(this.outputDir, 'original');
    if (!fs.existsSync(originalDir)) {
      fs.mkdirSync(originalDir, { recursive: true });
    }
    
    // 提取日期分类
    const baseNameWithTimestamp = path.basename(fileName, '.spec.ts');
    // 从文件名中提取日期部分（格式：YYYY-MM-DD）
    const dateMatch = baseNameWithTimestamp.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) {
      console.warn(`⚠️  无法从文件名提取日期: ${baseNameWithTimestamp}`);
      return;
    }
    const dateStr = dateMatch[1];
    const dateCategory = this.getDateCategoryForDate(dateStr);
    const categoryDir = path.join(originalDir, dateCategory);
    
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
    }
    
    // 生成原始代码文件名：保持与录制文件相同的基础命名，仅放入 original 目录
    const originalFileName = path.join(categoryDir, `${baseNameWithTimestamp}.spec.ts`);
    
    // 保存原始代码
    fs.writeFileSync(originalFileName, code, 'utf-8');
    console.log(`✅ 已保存原始代码: ${originalFileName}`);
  }
  
  private getDateCategoryForDate(dateStr: string): string {
    const configPath = path.join(process.cwd(), 'config', 'date-categories.json');
    
    if (!fs.existsSync(configPath)) {
      console.warn(`⚠️  配置文件不存在: ${configPath}`);
      return 'default';
    }
    
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent) as { dateCategories: string[] };
      
      // 解析日期字符串，确保使用本地时区
      const [year, month, day] = dateStr.split('-').map(Number);
      const fileDate = new Date(year, month - 1, day);
      
      for (const category of config.dateCategories) {
        const catYear = parseInt(category.substring(0, 4));
        const catMonth = parseInt(category.substring(4, 6)) - 1;
        const catDay = parseInt(category.substring(6, 8));
        const categoryDate = new Date(catYear, catMonth, catDay);
        
        if (fileDate <= categoryDate) {
          return category;
        }
      }
      
      return config.dateCategories[config.dateCategories.length - 1];
    } catch (error) {
      console.warn(`⚠️  读取配置文件失败: ${error}`);
      return 'default';
    }
  }
  
  private processIframeCode(code: string): string {
    // 将 page.locator('iframe').contentFrame() 统一转换为 page.frameLocator('iframe')
    // 原来的实现直接删除这些行，会导致所有 iframe 内操作丢失，只剩下 goto。
    const lines = code.split('\n');
    const processedLines = lines.map(line => {
      let processedLine = line;

      // 先处理显式的 iframe contentFrame 链
      processedLine = processedLine.replace(
        /page\.locator\((['"])iframe\1\)\.contentFrame\(\)\./g,
        "page.frameLocator('iframe')."
      );

      // 兼容 locate 到 iframe 后再 contentFrame 的双引号写法
      processedLine = processedLine.replace(
        /page\.locator\((['"])iframe\1\)\.contentFrame\(\)/g,
        "page.frameLocator('iframe')"
      );

      return processedLine;
    });

    return processedLines.join('\n');
  }
  
  private wrapCodeInTest(code: string): string {
    // 先处理iframe代码
    const processedCode = this.processIframeCode(code);
    const trimmedCode = processedCode.trim();
    
    const hasImport = trimmedCode.includes('import { test, expect } from \'@playwright/test\'');
    const hasTestFunction = trimmedCode.includes('test(\'test\', async ({ page }) => {');
    
    if (hasImport && hasTestFunction) {
      const lines = trimmedCode.split('\n');
      const testIndex = lines.findIndex(line => line.includes('test(\'test\', async ({ page }) => {'));
      
      if (testIndex !== -1) {
        const beforeTest = lines.slice(0, testIndex)
          .filter(line => {
            const trimmedLine = line.trim();
            return !trimmedLine.startsWith('//') && 
                   !trimmedLine.startsWith('/*') && 
                   !trimmedLine.endsWith('*/') &&
                   !trimmedLine.match(/^[\u4e00-\u9fa5]+$/) &&
                   trimmedLine.length > 0;
          })
          .join('\n');
        const testContent = lines.slice(testIndex).join('\n');
        
        const testConfig = `test.use({\n  storageState: 'storage/loginState/stage.json'\n});\n\n`;
        
        return beforeTest + (beforeTest ? '\n' : '') + testConfig + testContent;
      }
    }
    
    const imports = `import { test, expect } from '@playwright/test';\n\n`;
    const testConfig = `test.use({\n  storageState: 'storage/loginState/stage.json'\n});\n\n`;
    const testFunction = `test('test', async ({ page }) => {\n${trimmedCode}\n});\n`;
    
    return imports + testConfig + testFunction;
  }
  
  private validateCode(code: string): boolean {
    if (!code.trim()) {
      console.error('❌ 错误：代码不能为空');
      return false;
    }
    
    const lines = code.split('\n');
    const hasPageReference = lines.some(line => 
      line.includes('page.') && 
      (line.includes('.click(') || 
       line.includes('.fill(') || 
       line.includes('.type(') || 
       line.includes('.goto(') ||
       line.includes('.getBy'))
    );
    
    if (!hasPageReference) {
      console.warn('⚠️  警告：代码中可能没有有效的Playwright操作');
    }
    
    return true;
  }
  
  async generateFromCode(code: string, options: GenerateOptions = {}): Promise<string> {
    if (!this.validateCode(code)) {
      process.exit(1);
    }
    
    const wrappedCode = this.wrapCodeInTest(code);
    const fileName = this.generateFileName(code, options.name);
    
    // 保存原始代码
    this.saveOriginalCode(code, fileName);
    
    fs.writeFileSync(fileName, wrappedCode, 'utf-8');
    
    console.log(`✅ 已生成录制文件: ${fileName}`);
    console.log(`📝 文件内容预览:`);
    console.log('='.repeat(50));
    console.log(wrappedCode.substring(0, 300) + (wrappedCode.length > 300 ? '...' : ''));
    console.log('='.repeat(50));
    
    return fileName;
  }
  
  async generateFromFile(filePath: string, options: GenerateOptions = {}): Promise<string> {
    if (!fs.existsSync(filePath)) {
      console.error(`❌ 错误：文件不存在: ${filePath}`);
      process.exit(1);
    }
    
    const code = fs.readFileSync(filePath, 'utf-8');
    return this.generateFromCode(code, options);
  }
  
  async promptForCode(): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    console.log('📝 请输入Playwright测试代码（输入空行结束）:');
    console.log('  示例: await page.getByText("按钮").click();');
    console.log('  示例: await page.goto("https://example.com");');
    console.log('');
    
    const lines: string[] = [];
    
    return new Promise((resolve) => {
      const promptLine = () => {
        rl.question('> ', (line) => {
          if (line.trim() === '') {
            rl.close();
            resolve(lines.join('\n'));
          } else {
            lines.push(line);
            promptLine();
          }
        });
      };
      
      promptLine();
    });
  }
  
  async run(): Promise<void> {
    const args = process.argv.slice(2);
    const options: GenerateOptions = {};
    
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--code' && i + 1 < args.length) {
        options.code = args[++i];
      } else if (args[i] === '--file' && i + 1 < args.length) {
        options.file = args[++i];
      } else if (args[i] === '--name' && i + 1 < args.length) {
        options.name = args[++i];
      } else if (args[i] === '--description' && i + 1 < args.length) {
        options.description = args[++i];
      }
    }
    
    try {
      if (options.file) {
        await this.generateFromFile(options.file, options);
      } else if (options.code) {
        await this.generateFromCode(options.code, options);
      } else {
        const code = await this.promptForCode();
        if (code.trim()) {
          await this.generateFromCode(code, options);
        } else {
          console.log('❌ 没有输入代码，操作取消');
        }
      }
    } catch (error) {
      console.error('❌ 生成录制文件失败:', error);
      process.exit(1);
    }
  }
}

async function main() {
  const generator = new RawRecordingGenerator();
  await generator.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { RawRecordingGenerator };