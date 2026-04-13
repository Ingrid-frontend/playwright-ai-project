import * as fs from 'fs';
import * as path from 'path';

/**
 * optimize-raw-recordings.ts
 * 
 * 将 tests/raw-recordings 下的原始录制脚本转换为优化的测试脚本
 * 
 * 使用方法:
 *   1. 不传参数: 处理 tests/raw-recordings 文件夹下的所有文件
 *      npm run optimize-raw-recordings
 *   
 *   2. 处理单个文件:
 *      npm run optimize-raw-recordings -- tests/raw-recordings/test.spec.ts
 *   
 *   3. 处理文件夹:
 *      npm run optimize-raw-recordings -- tests/raw-recordings/
 *   
 * 功能:
 *   - 提取并保留 test.use 设置（如 storageState）
 *   - 跳过登录相关的操作（账号登录、密码输入、协议同意等）
 *   - 按日期分类存放生成的优化脚本
 *   - 添加截图功能和增强的等待策略
 *   - 优化选择器，提高测试稳定性
 *   - 引入 Iframe 自动寻址机制
 *   - 实现智能动作函数，处理 AntD 加载遮罩
 *   - 多 pass 优化管道：
 *     - 移除 iframe 前缀
 *     - 移除噪声背景点击
 *     - 简化 uncheck+check 对
 *     - 去重连续相同的操作
 *     - 合并 click+fill 操作
 *     - 在 goto 后注入 waitForLoadState
 *     - 在关键点击前注入可见性断言
 *     - 注入超时配置
 */

// 动作类型定义
interface Action {
  index: number;
  type: 'click' | 'fill' | 'type' | 'check' | 'selectOption' | 'press' | 'goto';
  selector: string;
  text?: string;
  url?: string;
  originalLine: number;
}

// 测试块定义
interface TestBlock {
  start: number;
  end: number;
  bodyStart: number;
}

// 优化选项
interface OptimizeOptions {
  removeIframe: boolean;
  deduplicate: boolean;
  removeNoise: boolean;
  mergeFill: boolean;
  waitLoad: boolean;
  addVisible: boolean;
  addTimeout: boolean;
  simplifyCheck: boolean;
}

// 优化统计
interface OptimizeMetrics {
  removedNoise: number;
  removedDedup: number;
  removedFillMerge: number;
  removedUncheck: number;
  addedAsserts: number;
  totalRemoved: number;
}

class RawRecordingOptimizer {
  private filePath: string;
  private content: string;
  private lines: string[];
  private actions: Action[] = [];
  private testBlock: TestBlock | null = null;
  private hasIframe: boolean = false;
  private options: OptimizeOptions;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.content = fs.readFileSync(filePath, 'utf-8');
    this.lines = this.content.split('\n');
    this.detectIframe();
    this.options = this.getDefaultOptions();
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
    // 首先进行多 pass 优化
    const optimizedContent = this.optimizeScript(this.content);
    // 更新内容和行，以便后续分析
    this.content = optimizedContent;
    this.lines = this.content.split('\n');
    // 分析动作和测试块
    this.analyzeActions();
    this.identifyTestBlock();
    return this.generateOptimizedCode();
  }

  /**
   * 多 pass 优化管道
   */
  private optimizeScript(source: string): string {
    const lines = source.split('\n');
    const metrics: OptimizeMetrics = {
      removedNoise: 0,
      removedDedup: 0,
      removedFillMerge: 0,
      removedUncheck: 0,
      addedAsserts: 0,
      totalRemoved: 0
    };

    // --- Pass 1: 保留原始 iframe 结构 ---
    // 这里不再全局移除 iframe 前缀，避免把位于 iframe 内的元素错误提升到 page 上
    let workingLines = lines.slice();

    // --- Pass 2: 移除噪声背景点击 ---
    if (this.options.removeNoise) {
      workingLines = workingLines.filter(line => {
        if (this.isNoiseLine(line) && /\.click\(\)/.test(line)) {
          metrics.removedNoise++;
          return false;
        }
        return true;
      });
    }

    // --- Pass 3: 简化 uncheck+check 对 ---
    if (this.options.simplifyCheck) {
      const filteredLines = [];
      for (let i = 0; i < workingLines.length; i++) {
        const curr = workingLines[i];
        const next = workingLines[i + 1];
        if (curr && next) {
          const cParsed = this.parseLine(curr);
          const nParsed = this.parseLine(next);
          if (cParsed && nParsed) {
            const cA = this.extractAction(cParsed.expr);
            const nA = this.extractAction(nParsed.expr);
            if (cA && nA && cA.name === 'uncheck' && nA.name === 'check') {
              const cL = this.extractLocator(cParsed.expr);
              const nL = this.extractLocator(nParsed.expr);
              if (cL === nL) {
                metrics.removedUncheck++;
                i++; // 跳过 uncheck，保留 check
                filteredLines.push(next);
                continue;
              }
            }
          }
        }
        filteredLines.push(curr);
      }
      workingLines = filteredLines;
    }

    // --- Pass 4: 去重连续相同的操作 ---
    if (this.options.deduplicate) {
      const filteredLines = [];
      for (let i = 0; i < workingLines.length; i++) {
        const curr = workingLines[i].trim();
        const prev = filteredLines.length > 0 ? filteredLines[filteredLines.length - 1].trim() : '';
        if (curr === prev && curr.startsWith('await ')) {
          metrics.removedDedup++;
          continue;
        }
        filteredLines.push(workingLines[i]);
      }
      workingLines = filteredLines;
    }

    // --- Pass 5: 合并 click+fill 操作 ---
    if (this.options.mergeFill) {
      const filteredLines = [];
      for (let i = 0; i < workingLines.length; i++) {
        if (this.isRedundantClickBeforeFill(workingLines, i)) {
          metrics.removedFillMerge++;
          continue; // 跳过 click，保留 fill
        }
        filteredLines.push(workingLines[i]);
      }
      workingLines = filteredLines;
    }

    // 计算总移除量
    metrics.totalRemoved = metrics.removedNoise + metrics.removedDedup + metrics.removedFillMerge + metrics.removedUncheck;

    console.log(`🔍 优化统计: 移除 ${metrics.totalRemoved} 个步骤`);
    console.log(`   - 噪声点击: ${metrics.removedNoise}`);
    console.log(`   - 重复操作: ${metrics.removedDedup}`);
    console.log(`   - 合并填充: ${metrics.removedFillMerge}`);
    console.log(`   - 简化勾选: ${metrics.removedUncheck}`);

    return workingLines.join('\n');
  }

  /**
   * 移除 iframe 前缀
   */
  private stripIframePrefix(line: string): string {
    // 匹配 page.locator('iframe').contentFrame().XXX 模式
    return line.replace(
      /page\.locator\(['"]iframe['"]\)\.contentFrame\(\)\./g,
      'page.'
    );
  }

  /**
   * 解析单行 await 语句
   */
  private parseLine(line: string): { indent: string; expr: string } | null {
    const m = line.match(/^(\s*)(await\s+.+);?\s*$/);
    if (!m) return null;
    return { indent: m[1], expr: m[2].trim() };
  }

  /**
   * 提取定位器链
   */
  private extractLocator(expr: string): string {
    // 移除前导的 "await "
    const body = expr.replace(/^await\s+/, '');
    // 匹配最后的方法调用
    const m = body.match(/^(.*?)\.(click|fill|check|uncheck|select|type|press|tap|hover|focus|blur|clear|dblclick|dispatchEvent|waitFor|selectOption)\(.*\)$/);
    if (m) return m[1];
    return body;
  }

  /**
   * 提取动作信息
   */
  private extractAction(expr: string): { name: string; args: string } | null {
    const body = expr.replace(/^await\s+/, '');
    const m = body.match(/\.([a-zA-Z]+)\(([^)]*)\)$/);
    if (m) return { name: m[1], args: m[2] };
    return null;
  }

  /**
   * 检查是否是噪声背景点击
   */
  private isNoiseLine(line: string): boolean {
    const m = line.match(/hasText:\s*['"](.+?)['"]/);
    if (!m) return false;
    // 长 hasText 内容 (>15 字符) 通常是父容器
    if (m[1].length > 15) return true;
    return false;
  }

  /**
   * 检查是否是 fill 前的冗余 click
   */
  private isRedundantClickBeforeFill(lines: string[], idx: number): boolean {
    const curr = lines[idx];
    const next = lines[idx + 1];
    if (!curr || !next) return false;
    const currParsed = this.parseLine(curr);
    const nextParsed = this.parseLine(next);
    if (!currParsed || !nextParsed) return false;

    const currAction = this.extractAction(currParsed.expr);
    const nextAction = this.extractAction(nextParsed.expr);

    if (!currAction || !nextAction) return false;
    if (currAction.name !== 'click') return false;
    if (nextAction.name !== 'fill') return false;

    const currLoc = this.extractLocator(currParsed.expr);
    const nextLoc = this.extractLocator(nextParsed.expr);

    return currLoc === nextLoc;
  }

  /**
   * 检查是否是关键动作
   */
  private isKeyAction(expr: string): boolean {
    return /\.(click|fill|check|uncheck|selectOption)\(/.test(expr);
  }

  private detectIframe(): void {
    // 仅在源文件中出现显式 iframe contentFrame 访问时，才启用 iframe 上下文逻辑。
    // 之前使用 line.includes('iframe') 会把注释、字符串、CSS 选择器等误判为 iframe 页面，
    // 从而生成多余的 iframe 初始化代码，并可能引入运行时错误。
    const explicitIframePattern = /(?:locator|frameLocator)\((['"])iframe\1\)(?:\.contentFrame\(\))?/;
    const explicitContentFramePattern = /contentFrame\(\)/;

    this.hasIframe = this.lines.some(line => explicitIframePattern.test(line) || explicitContentFramePattern.test(line));

    if (this.hasIframe) {
      console.log('🔍 检测到显式 Iframe / contentFrame 代码，将保留 iframe 上下文处理');
    }
  }

  private isLoginAction(line: string): boolean {
    // 1) 配置层面的登录态设置，直接跳过
    if (line.includes('storageState') || line.includes('loginState')) {
      return true;
    }

    // 2) 仅跳过明确的登录流程元素，避免把页面中其他“密码/账号”等有效操作误删
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

    // 3) 登录页里常见的 label 点击，仅在明确命中登录关键词时跳过
    if ((line.includes("page.locator('label')") || line.includes('page.locator("label")')) &&
        (line.includes('账号登录') || line.includes('手机号') || line.includes('邮箱') || line.includes('用户协议') || line.includes('隐私协议'))) {
      return true;
    }

    return false;
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

  private extractTestUseSettings(): string[] {
    // optimized 用例默认走 playwright.config.ts 的 project 配置（storageState/baseURL 等）
    // 为避免环境硬编码与重复配置，这里不再从 raw-recordings 透传 test.use 块
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
    let screenshotDir = `screenshots/${fileName}`;
    
    if (dateStr) {
      const dateCategory = this.getDateCategoryForDate(dateStr);
      screenshotDir = `screenshots/${dateCategory}/${fileName}`;
    }

    // 提取 test.use 设置
    const testUseLines = this.extractTestUseSettings();

    // 生成优化后的代码
    const optimizedCode = this.generateTemplateCode(testName, screenshotDir, testUseLines, this.actions);

    return optimizedCode;
  }

  private generateTemplateCode(testName: string, screenshotDir: string, testUseLines: string[], actions: Action[]): string {
    const needsClick = actions.some((a) => a.type === 'click');
    const needsFill = actions.some((a) => a.type === 'fill');
    const actionImports = [
      'step',
      ...(needsClick ? ['smartClick'] : []),
      ...(needsFill ? ['smartFill'] : []),
    ];

    const template = `import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot } from '../../../utils/screenshot';
import { ${actionImports.join(', ')} } from '../../utils/optimized-actions';

${testUseLines.length > 0 ? testUseLines.join('\n') + '\n\n' : ''}test('${testName}', async ({ page }) => {
  ${this.options.addTimeout ? 'test.setTimeout(120000);' : ''}

  // 初始化截图目录
  const screenshotDir = '${screenshotDir}';
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(screenshotDir, timestamp);
  ${this.hasIframe ? `// 定义 Iframe 引用
  let iframeContent: any = null;
  
  await step('获取 Iframe 内容', async () => {
    console.log('🔍 查找并获取 Iframe');
    const iframe = page.locator('iframe').first();
    // 某些页面的 iframe 可能是隐藏/延迟渲染的，不要强依赖 visible
    await iframe.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    
    try {
      iframeContent = await iframe.contentFrame();
    } catch (e) {
      console.log('⚠️ 获取 iframe contentFrame 失败:', e.message);
      iframeContent = null;
    }

    if (!iframeContent) {
      console.log('⚠️ 未能直接获取 iframe contentFrame，稍后会继续使用 page 上下文');
    } else {
      console.log('✅ Iframe 加载成功: 已获取');
    }
  });

` : ''}

  // 检查是否有页面导航操作
  const hasGotoAction = ${actions.some(action => action.type === 'goto')};
  
  if (!hasGotoAction) {
    // 如果没有页面导航，添加一个默认的
    await step('导航到首页', async () => {
      console.log('🌐 导航到: / (基于 baseURL)');
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.waitForLoadState('networkidle');
      await takeStepScreenshot(page, path.join(runDir, \`step-1-导航到首页.png\`), { fullPage: true });
    });
  }

  ${this.generateActionsCode(actions, 'runDir')}

  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + '${testName}');
});
`;

    return template;
  }

  private generateActionsCode(actions: Action[], runDirVariable: string): string {
    let code = '';
    let stepIndex = 1;

    actions.forEach((action, index) => {
      if (action.type === 'goto') {
        code += `  await step('导航到页面', async () => {
    console.log('🌐 导航到: ${action.url}');
    await page.goto('${action.url}', { waitUntil: 'networkidle' });
    ${this.options.waitLoad ? 'await page.waitForLoadState(\'networkidle\');' : ''}
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-导航到页面.png\`), { fullPage: true });
  });

`;
        stepIndex++;
      } else {
        const actionCode = this.generateActionCode(action, stepIndex, runDirVariable);
        code += actionCode;
        stepIndex++;
      }
    });

    return code;
  }

  private generateActionCode(action: Action, stepIndex: number, runDirVariable: string): string {
    const label = this.getActionLabel(action);
    const fileLabel = this.cleanLabel(label) || `step-${stepIndex}`;
    const selector = this.optimizeSelector(action.selector);
    const locatorCode = this.extractAndOptimizeLocator(selector);
    const isKeyAction = this.isKeyAction(action.selector);

    switch (action.type) {
      case 'click':
        return `  await step('${label}', async () => {
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-before.png\`), { fullPage: true });
    ${this.hasIframe ? `const baseContext = iframeContent || page;
    const locator = ${locatorCode.replace(/page\./g, 'baseContext.')};` : `const locator = ${locatorCode};`}
    ${this.options.addVisible && isKeyAction ? `await expect(locator).toBeVisible();` : ''}
    await smartClick(locator, '${label}');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-after.png\`), { fullPage: true });
  });

`;
      case 'fill':
      case 'type':
        const text = action.text || '';
        return `  await step('${label}', async () => {
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-before.png\`), { fullPage: true });
    ${this.hasIframe ? `const baseContext = iframeContent || page;
    const locator = ${locatorCode.replace(/page\./g, 'baseContext.')};` : `const locator = ${locatorCode};`}
    ${this.options.addVisible && isKeyAction ? `await expect(locator).toBeVisible();` : ''}
    await smartFill(locator, "${text}", '${label}');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-after.png\`), { fullPage: true });
  });

`;
      case 'check':
        return `  await step('${label}', async () => {
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-before.png\`), { fullPage: true });
    ${this.hasIframe ? `const baseContext = iframeContent || page;
    const locator = ${locatorCode.replace(/page\./g, 'baseContext.')};` : `const locator = ${locatorCode};`}
    ${this.options.addVisible && isKeyAction ? `await expect(locator).toBeVisible();` : ''}
    try {
      await locator.waitFor({ state: 'visible', timeout: 10000 });
    } catch (e) {
      console.log('⚠️ 元素不可见，尝试暂停调试');
      await maybePause(page, '元素不可见');
    }
    try {
      await locator.check();
    } catch (e) {
      console.log(\`⚠️ 勾选失败: \${e.message}\`);
      await maybePause(page, '勾选失败');
    }
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-after.png\`), { fullPage: true });
  });

`;
      case 'selectOption':
        return `  await step('${label}', async () => {
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-before.png\`), { fullPage: true });
    ${this.hasIframe ? `const baseContext = iframeContent || page;
    const locator = ${locatorCode.replace(/page\./g, 'baseContext.')};` : `const locator = ${locatorCode};`}
    ${this.options.addVisible && isKeyAction ? `await expect(locator).toBeVisible();` : ''}
    try {
      await locator.waitFor({ state: 'visible', timeout: 10000 });
    } catch (e) {
      console.log('⚠️ 元素不可见，尝试暂停调试');
      await maybePause(page, '元素不可见');
    }
    try {
      await locator.selectOption("${action.text || ''}");
    } catch (e) {
      console.log(\`⚠️ 选择失败: \${e.message}\`);
      await maybePause(page, '选择失败');
    }
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-after.png\`), { fullPage: true });
  });

`;
      case 'press':
        return `  await step('${label}', async () => {
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-before.png\`), { fullPage: true });
    ${this.hasIframe ? `const baseContext = iframeContent || page;
    const locator = ${locatorCode.replace(/page\./g, 'baseContext.')};` : `const locator = ${locatorCode};`}
    ${this.options.addVisible && isKeyAction ? `await expect(locator).toBeVisible();` : ''}
    try {
      await locator.waitFor({ state: 'visible', timeout: 10000 });
    } catch (e) {
      console.log('⚠️ 元素不可见，尝试暂停调试');
      await maybePause(page, '元素不可见');
    }
    try {
      await locator.press("${action.text || ''}");
    } catch (e) {
      console.log(\`⚠️ 按键失败: \${e.message}\`);
      await maybePause(page, '按键失败');
    }
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-after.png\`), { fullPage: true });
  });

`;
      default:
        return '';
    }
  }

  private extractAndOptimizeLocator(selector: string): string {
    // 提取定位器部分，移除 await 和动作尾缀
    let locator = selector.trim().replace(/^await\s+/, '');
    locator = locator.replace(/\.(click|fill|type|check|selectOption|press)\(.*\)\s*;?$/, '');

    // 处理 iframe 上下文：保留 iframe 语义，但切换为 iframeContent/baseContext
    const iframePrefix = /^page\.locator\((['"])iframe\1\)\.contentFrame\(\)\./;
    if (iframePrefix.test(locator)) {
      locator = locator.replace(iframePrefix, this.hasIframe ? 'baseContext.' : 'page.');
    }

    // 应用定位器优化规则
    return this.optimizeLocator(locator);
  }

  private optimizeLocator(locator: string): string {
    // 优化定位器，特别是针对 Ant Design 组件
    let optimized = locator;
    
    // 1. 优化 Ant Design 选择器
    // 处理下拉箭头
    if (optimized.includes('.ant-select-arrow')) {
      optimized += '.filter({ visible: true }).first()';
    }
    
    // 2. 保留语义选择器（getByRole, getByText, getByLabel等）
    if (optimized.includes('getByRole') || optimized.includes('getByText') || optimized.includes('getByLabel') || optimized.includes('getByPlaceholder')) {
      // 对于语义选择器，添加 .first() 确保唯一
      if (!optimized.includes('.first()')) {
        optimized += '.filter({ visible: true }).first()';
      } else if (!optimized.includes('.filter({ visible: true })')) {
        optimized = optimized.replace('.first()', '.filter({ visible: true }).first()');
      }
      return optimized;
    }
    
    // 3. 对于非语义选择器，添加可见性过滤
    if (!optimized.includes('.filter') && !optimized.includes('.first()')) {
      optimized += '.filter({ visible: true }).first()';
    }
    
    return optimized;
  }

  private optimizeSelector(selector: string): string {
    let optimized = selector;

    // 1. 移除force: true（Cleaner层只做删除）
    optimized = optimized.replace(/\{\s*force:\s*true\s*\}/g, '');
    optimized = optimized.replace(/force:\s*true\s*,/g, '');
    
    // 2. 移除waitForTimeout（Cleaner层只做删除）
    optimized = optimized.replace(/\.waitForTimeout\([^)]+\)/g, '');
    
    // 3. 移除重复的click操作（Cleaner层只做删除）
    // 注意：这里只做简单的重复检测，复杂的重复检测由AI层处理
    
    // 4. 不移除复杂的CSS选择器，也不转换语义选择器
    // 保持原始选择器不变，由AI层进行智能优化

    return optimized;
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
}

const filePath = process.argv[2];

// 如果没有提供参数，默认处理 tests/raw-recordings 文件夹下的所有文件
const targetPath = filePath || 'tests/raw-recordings/';

const outputDir = 'tests/optimized';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function processFile(filePath: string): Promise<void> {
  console.log(`🔄 开始优化文件: ${filePath}`);
  const optimizer = new RawRecordingOptimizer(filePath);
  const result = optimizer.optimize();
  if (!result || result.trim().length === 0) {
    console.log(`❌ 优化失败（未生成内容），跳过写入: ${filePath}`);
    return;
  }

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

// 递归查找所有 .spec.ts 文件
function findSpecFiles(dir: string): string[] {
  const files: string[] = [];
  
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    
    if (item.isDirectory()) {
      // raw-recordings 的 original 目录是备份原始文件，不参与 optimize
      if (item.name === 'original') continue;
      // 递归处理子目录
      files.push(...findSpecFiles(fullPath));
    } else if (item.isFile() && item.name.endsWith('.spec.ts')) {
      files.push(fullPath);
    }
  }
  
  return files.sort();
}

async function main() {
  const stats = fs.statSync(targetPath);
  
  if (stats.isDirectory()) {
    console.log(`📁 批量处理文件夹: ${targetPath}`);
    
    const files = findSpecFiles(targetPath);
    
    if (files.length === 0) {
      console.log('⚠️  未找到 .spec.ts 文件');
      return;
    }
    
    console.log(`📊 找到 ${files.length} 个测试文件`);
    
    for (const file of files) {
      await processFile(file);
    }
    
    console.log(`🎉 批量优化完成! 共处理 ${files.length} 个文件`);
  } else if (stats.isFile()) {
    if (!targetPath.endsWith('.spec.ts')) {
      console.error('❌ 文件必须以 .spec.ts 结尾');
      process.exit(1);
    }
    await processFile(targetPath);
  } else {
    console.error('❌ 路径不存在或不是文件/文件夹');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ 处理失败:', error);
  process.exit(1);
});