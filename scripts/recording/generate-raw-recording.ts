import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {
  buildRecordingBaseSlug,
  getDateCategoryForCalendarDay,
  writeOriginalRecordingBackup,
} from './raw-recording-naming.js';

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

  /**
   * Raw recordings 命名规范：<feature>-<behavior>_<timestamp>.spec.ts
   * 规则与 scripts/recording/raw-recording-naming.ts / npm run record 录制后处理一致。
   */
  private generateFileName(code: string, options: GenerateOptions = {}): string {
    const timestamp = this.generateTimestamp();
    const baseName = buildRecordingBaseSlug(code, {
      name: options.name,
      description: options.description,
    });
    const fileName = `${baseName}_${timestamp}.spec.ts`;
    const dateStr = timestamp.split('_')[0];
    const dateCategory = getDateCategoryForCalendarDay(dateStr);
    const categoryDir = path.join(this.outputDir, dateCategory);

    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
    }

    return path.join(categoryDir, fileName);
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

    // CLI 传参常出现 "\\n" 这类字面量转义，落盘前统一还原为真实换行，避免生成脚本包含 "\n"
    const normalizedCode = code
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');

    const wrappedCode = this.wrapCodeInTest(normalizedCode);
    const fileName = this.generateFileName(code, options);

    writeOriginalRecordingBackup(normalizedCode, fileName, this.outputDir);
    
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
      const cur = args[i];

      // 支持 --key value 与 --key=value 两种写法（npm run 透传常用）
      const readValue = (flag: keyof GenerateOptions) => {
        if (i + 1 < args.length) {
          (options as any)[flag] = args[++i];
        }
      };

      if (cur === '--code') readValue('code');
      else if (cur.startsWith('--code=')) options.code = cur.slice('--code='.length);
      else if (cur === '--file') readValue('file');
      else if (cur.startsWith('--file=')) options.file = cur.slice('--file='.length);
      else if (cur === '--name') readValue('name');
      else if (cur.startsWith('--name=')) options.name = cur.slice('--name='.length);
      else if (cur === '--description') readValue('description');
      else if (cur.startsWith('--description=')) options.description = cur.slice('--description='.length);
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