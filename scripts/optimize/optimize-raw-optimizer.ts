import * as fs from 'fs';
import * as path from 'path';
import { getDateCategoryForCalendarDay } from '../../src/utils/date-category.js';
import {
  buildScreenshotDir,
  optimizedImportPathsForDepth,
  optimizedImportDepthFromRel,
  parseEnvAndDateCategoryFromRawOrProcessed,
} from '../../src/utils/test-env-path.js';
import { generateTemplateCode, type Action } from './optimize-raw-codegen.js';
import { optimizeScript, type OptimizeOptions } from './optimize-raw-passes.js';

export { reloadGenWait, getScreenshotMode } from './optimize-raw-wait.js';

const STUDIO_DRAFT_STEM = 'studio-auto';

interface TestBlock {
  start: number;
  end: number;
  bodyStart: number;
}

type OptimizedImportLayout = 'nested' | 'flat';

export class RawRecordingOptimizer {
  private filePath: string;
  private content: string;
  private lines: string[];
  private actions: Action[] = [];
  private testBlock: TestBlock | null = null;
  private hasIframe: boolean = false;
  private options: OptimizeOptions;
  /** `nested`: `tests/optimized/<date>/x.optimized.spec.ts`；`flat`: `tests/optimized/x.optimized.spec.ts`（无日期子目录时） */
  private optimizedImportLayout: OptimizedImportLayout = 'nested';
  private playwrightEnv: string;
  private pathDateCategory: string | null;
  private importPathsOverride: ReturnType<typeof optimizedImportPathsForDepth> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
    const meta = parseEnvAndDateCategoryFromRawOrProcessed(filePath);
    this.playwrightEnv = meta.env;
    this.pathDateCategory = meta.dateCategory;
    this.content = fs.readFileSync(filePath, 'utf-8');
    this.lines = this.content.split('\n');
    this.detectIframe();
    this.options = this.getDefaultOptions();
  }

  setOptimizedImportLayout(layout: OptimizedImportLayout): void {
    this.optimizedImportLayout = layout;
  }

  setPathDateCategory(dateCategory: string | null): void {
    this.pathDateCategory = dateCategory;
  }

  setImportPathsFromOutputRel(outputRel: string): void {
    const depth = optimizedImportDepthFromRel(outputRel);
    this.importPathsOverride = optimizedImportPathsForDepth(depth);
  }

  private getOptimizedImportPaths(): {
    fixtures: string;
    screenshot: string;
    optimizedActions: string;
    fixturesCommentPhrase: string;
  } {
    if (this.importPathsOverride) return this.importPathsOverride;
    if (this.optimizedImportLayout === 'flat') {
      return {
        fixtures: './fixtures',
        screenshot: '../../src/utils/screenshot',
        optimizedActions: '../utils/optimized-actions',
        fixturesCommentPhrase: './fixtures',
      };
    }
    return {
      fixtures: '../fixtures',
      screenshot: '../../../src/utils/screenshot',
      optimizedActions: '../../utils/optimized-actions',
      fixturesCommentPhrase: '../fixtures',
    };
  }

  private getDefaultOptions(): OptimizeOptions {
    return {
      removeIframe: true,
      deduplicate: true,
      removeNoise: true,
      mergeFill: true,
      waitLoad: true,
      addVisible: true,
      addTimeout: true,
      simplifyCheck: true
    };
  }

  optimize(): string {
    const optimizedContent = optimizeScript(this.content, this.options);
    this.content = optimizedContent;
    this.lines = this.content.split('\n');
    this.analyzeActions();
    this.identifyTestBlock();
    return this.generateOptimizedCode();
  }

  private detectIframe(): void {
    const explicitIframePattern = /(?:locator|frameLocator)\((['"])iframe\1\)(?:\.contentFrame\(\))?/;
    const explicitContentFramePattern = /contentFrame\(\)/;

    this.hasIframe = this.lines.some(line => explicitIframePattern.test(line) || explicitContentFramePattern.test(line));

    if (this.hasIframe) {
      console.log('🔍 检测到显式 Iframe / contentFrame 代码，将保留 iframe 上下文处理');
    }
  }

  private isLoginAction(line: string): boolean {
    if (line.includes('storageState') || line.includes('loginState')) {
      return true;
    }

    const explicitLoginPatterns = [
      /getByRole\(['"]tab['"],\s*\{\s*name:\s*['"]账号登录['"]\s*\}\)\.(click|tap)\(/,
      /getByRole\(['"]textbox['"],\s*\{\s*name:\s*['"]请输入手机号\/邮箱['"]\s*\}\)\.(click|fill|type)\(/,
      /getByRole\(['"]textbox['"],\s*\{\s*name:\s*['"]密码['"]\s*\}\)\.(click|fill|type)\(/,
      /getByRole\(['"]checkbox['"],\s*\{\s*name:\s*['"].*(用户协议|隐私协议).*(用户协议|隐私协议).*['"]\s*\}\)\.check\(/,
      /getByRole\(['"]button['"],\s*\{\s*name:\s*['"]登\s*录['"]\s*\}\)\.click\(/,
      /getByText\(['"]账号登录['"]/,
      /getByText\(['"]登\s*录['"]\)/,
    ];

    if (explicitLoginPatterns.some(pattern => pattern.test(line))) {
      return true;
    }

    if ((line.includes("page.locator('label')") || line.includes('page.locator("label")') || line.includes("frameLocator('iframe').locator('label')")) &&
        (line.includes('账号登录') || line.includes('手机号') || line.includes('邮箱') || line.includes('用户协议') || line.includes('隐私协议'))) {
      return true;
    }

    if (line.includes('.locator("label")') || line.includes(".locator('label')")) {
      return true;
    }

    return false;
  }

  private analyzeActions(): void {
    this.lines.forEach((line, index) => {
      if (this.isLoginAction(line)) {
        console.log(`⏭️  跳过登录操作: ${line.substring(0, 100)}...`);
        return;
      }
      
      const iframePrefix = /(?:frameLocator\(['"]iframe['"]\)|locator\(['"]iframe['"]\)\.contentFrame\(\))/;
      const clickMatch = line.match(new RegExp(`await page\\.(?:${iframePrefix.source}\\.)?(getBy\\w*|locator)\\(.+\\)\\.click\\(\\)`));
      const fillMatch = line.match(new RegExp(`await page\\.(?:${iframePrefix.source}\\.)?(getBy\\w*|locator)\\(.+\\)\\.(fill|type)\\(.+\\)`));
      const checkMatch = line.match(new RegExp(`await page\\.(?:${iframePrefix.source}\\.)?(getBy\\w*|locator)\\(.+\\)\\.check\\(\\)`));
      const selectMatch = line.match(new RegExp(`await page\\.(?:${iframePrefix.source}\\.)?(getBy\\w*|locator)\\(.+\\)\\.selectOption\\(.+\\)`));
      const pressMatch = line.match(new RegExp(`await page\\.(?:${iframePrefix.source}\\.)?(getBy\\w*|locator)\\(.+\\)\\.press\\(.+\\)`));
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
          selector: line,
          text: this.extractText(line),
          originalLine: index
        });
      } else if (fillMatch) {
        this.actions.push({
          index: this.actions.length,
          type: 'fill',
          selector: line,
          text: this.extractText(line),
          originalLine: index
        });
      } else if (checkMatch) {
        this.actions.push({
          index: this.actions.length,
          type: 'check',
          selector: line,
          originalLine: index
        });
      } else if (selectMatch) {
        this.actions.push({
          index: this.actions.length,
          type: 'selectOption',
          selector: line,
          originalLine: index
        });
      } else if (pressMatch) {
        this.actions.push({
          index: this.actions.length,
          type: 'press',
          selector: line,
          text: this.extractPressKey(line),
          originalLine: index
        });
      }
    });
    
    console.log(`🔍 分析到 ${this.actions.length} 个操作`);
  }

  private identifyTestBlock(): void {
    const start = this.lines.findIndex(l => l.includes('test('));
    if (start === -1) {
      const awaitLineIndices = this.lines
        .map((l, i) => (/await\s+page\./.test(l) ? i : -1))
        .filter((i) => i >= 0);
      if (awaitLineIndices.length === 0) {
        this.testBlock = null;
        return;
      }
      const first = awaitLineIndices[0];
      const last = awaitLineIndices[awaitLineIndices.length - 1];
      console.log('ℹ️  未检测到 test()，按纯 Playwright 语句片段解析（常见于 original 备份或未封装的录制）');
      this.testBlock = { start: first, end: last, bodyStart: first };
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

  private extractTestUseSettings(): string[] {
    return [];
  }

  private generateOptimizedCode(): string {
    if (!this.testBlock) {
      console.error('❌ 未找到测试块');
      return '';
    }

    const testName = this.extractTestName(this.lines[this.testBlock.start]);
    const fileName = path.basename(this.filePath, '.spec.ts');

    const dateStr = this.extractDateFromFileName(fileName);
    let dateCategory = this.pathDateCategory;
    if (dateStr && !dateCategory) {
      dateCategory = this.getDateCategoryForDate(dateStr);
    }
    if (!dateCategory && fileName === STUDIO_DRAFT_STEM) {
      dateCategory = getDateCategoryForCalendarDay(new Date().toISOString().slice(0, 10));
    }

    const screenshotDir = buildScreenshotDir({
      playwrightEnv: this.playwrightEnv,
      dateCategory: dateCategory || '',
      fileName,
    });

    const testUseLines = this.extractTestUseSettings();

    return generateTemplateCode({
      testName,
      screenshotDir,
      testUseLines,
      actions: this.actions,
      options: this.options,
      hasIframe: this.hasIframe,
      importPaths: this.getOptimizedImportPaths(),
    });
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
    return getDateCategoryForCalendarDay(dateStr);
  }

  public extractDateFromFileName(fileName: string): string | null {
    const datePatterns = [
      { pattern: /(\d{4})-(\d{2})-(\d{2})/, type: 'dash' },
      { pattern: /(\d{4})_(\d{1,2})_(\d{1,2})/, type: 'underscore' },
      { pattern: /(\d{4})(\d{2})(\d{2})/, type: 'compact' },
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

  private extractPressKey(line: string): string | undefined {
    const pressMatch = line.match(/press\((['"])(.*?)\1\)/);
    if (pressMatch?.[2]) return pressMatch[2];
    return undefined;
  }
}
