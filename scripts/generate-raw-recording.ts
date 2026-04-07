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
  
  private extractSelectorType(selector: string): string {
    if (selector.startsWith('.')) return 'class';
    if (selector.startsWith('#')) return 'id';
    if (selector.startsWith('[')) return 'attribute';
    if (selector.includes('=')) return 'xpath';
    return 'selector';
  }
  
  private generateFileName(code: string, customName?: string): string {
    const timestamp = this.generateTimestamp();
    const contentInfo = this.extractContentInfo(code);
    
    let baseName = customName || contentInfo;
    
    const fileName = `${baseName}_${timestamp}.spec.ts`;
    return path.join(this.outputDir, fileName);
  }
  
  private wrapCodeInTest(code: string): string {
    const imports = `import { test, expect } from '@playwright/test';\n\n`;
    const testConfig = `test.use({\n  storageState: 'storage/loginState/stage.json'\n});\n\n`;
    const testFunction = `test('test', async ({ page }) => {\n${code}\n});\n`;
    
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