import fs from 'fs';
import path from 'path';

interface Issue {
  type: 'error' | 'warning' | 'suggestion';
  line: number;
  message: string;
  code: string;
  suggestion?: string;
}

interface AnalysisResult {
  filePath: string;
  issues: Issue[];
  stats: {
    totalLines: number;
    locatorCount: number;
    semanticLocators: number;
    cssLocators: number;
    xpathLocators: number;
    waitForCount: number;
    assertionCount: number;
  };
}

export class TestAnalyzer {
  private filePath: string;
  private content: string;
  private lines: string[];
  private issues: Issue[];

  constructor(filePath: string) {
    this.filePath = filePath;
    this.content = fs.readFileSync(filePath, 'utf-8');
    this.lines = this.content.split('\n');
    this.issues = [];
  }

  analyze(): AnalysisResult {
    this.checkTestNaming();
    this.checkLocators();
    this.checkWaits();
    this.checkAssertions();
    this.checkErrorHandling();
    this.checkStorageState();
    this.checkPOMUsage();
    this.checkClickStability();
    this.checkTransitionWaits();
    this.checkClickInterceptionRisk();
    this.checkErrorPronePatterns();

    return {
      filePath: this.filePath,
      issues: this.issues,
      stats: this.calculateStats()
    };
  }

  private checkTestNaming(): void {
    this.lines.forEach((line, index) => {
      if (line.includes("test('test'")) {
        this.issues.push({
          type: 'warning',
          line: index + 1,
          message: '测试名称过于通用，应该使用描述性的名称',
          code: line.trim(),
          suggestion: "test('应该能够执行报销单操作', async ({ page }) => {"
        });
      }
    });
  }

  private checkLocators(): void {
    this.lines.forEach((line, index) => {
      if (line.includes('page.locator(')) {
        const cssMatch = line.match(/page\.locator\(['"]\.[^'"]+['"]\)/);
        
        if (cssMatch) {
          this.issues.push({
            type: 'warning',
            line: index + 1,
            message: '使用 CSS 选择器，建议改用语义化定位符',
            code: line.trim(),
            suggestion: '考虑使用 getByRole(), getByText(), getByLabel() 等语义化定位符'
          });
        }

        const xpathMatch = line.match(/page\.locator\(['"]\/\/[^'"]+['"]\)/);
        if (xpathMatch) {
          this.issues.push({
            type: 'error',
            line: index + 1,
            message: '使用 XPath 选择器，不建议使用',
            code: line.trim(),
            suggestion: '避免使用 XPath，改用语义化定位符'
          });
        }
      }
    });
  }

  private checkWaits(): void {
    let hasWaitForLoadState = false;
    let hasExplicitWaits = false;

    this.lines.forEach((line, index) => {
      if (line.includes('waitForLoadState')) {
        hasWaitForLoadState = true;
      }
      if (line.includes('waitForTimeout')) {
        hasExplicitWaits = true;
        
        const timeoutMatch = line.match(/waitForTimeout\((\d+)\)/);
        if (timeoutMatch) {
          const timeout = parseInt(timeoutMatch[1]);
          if (timeout >= 1000) {
            this.issues.push({
              type: 'warning',
              line: index + 1,
              message: `检测到超长硬等待（${timeout}ms）`,
              code: line.trim(),
              suggestion: '应改为等待特定的网络请求或元素状态：await page.waitForResponse(url => ...) 或 waitForSelector()'
            });
          }
        }
      }
    });

    if (!hasWaitForLoadState && this.lines.some(line => line.includes('page.goto'))) {
      this.issues.push({
        type: 'suggestion',
        line: 0,
        message: '页面导航后缺少 waitForLoadState',
        code: 'page.goto()',
        suggestion: '在 page.goto() 后添加 await page.waitForLoadState("networkidle");'
      });
    }

    if (hasExplicitWaits) {
      this.issues.push({
        type: 'warning',
        line: 0,
        message: '使用 waitForTimeout，建议使用更可靠的等待方式',
        code: 'waitForTimeout',
        suggestion: '考虑使用 waitForSelector(), waitForLoadState() 等更可靠的等待方式'
      });
    }
  }

  private checkAssertions(): void {
    let hasAssertions = false;

    this.lines.forEach((line, index) => {
      if (line.includes('expect(')) {
        hasAssertions = true;
      }
    });

    if (!hasAssertions) {
      this.issues.push({
        type: 'error',
        line: 0,
        message: '测试中缺少断言',
        code: 'test',
        suggestion: '添加适当的断言来验证测试结果，如 expect(page).toHaveURL(...)'
      });
    }
  }

  private checkErrorHandling(): void {
    const hasTryCatch = this.content.includes('try {') || this.content.includes('catch(');

    if (!hasTryCatch && this.lines.length > 20) {
      this.issues.push({
        type: 'suggestion',
        line: 0,
        message: '测试缺少错误处理',
        code: 'test',
        suggestion: '考虑添加 try-catch 块来处理可能的异常'
      });
    }
  }

  private checkStorageState(): void {
    const hasStorageState = this.content.includes('storageState');

    if (!hasStorageState && this.content.includes('login')) {
      this.issues.push({
        type: 'suggestion',
        line: 0,
        message: '测试涉及登录但未使用 storageState',
        code: 'test.use',
        suggestion: '考虑使用 test.use({ storageState: ... }) 来复用登录状态'
      });
    }
  }

  private checkPOMUsage(): void {
    const pomEnabled = process.env.ENABLE_POM === '1';
    if (!pomEnabled) {
      return;
    }

    const importsPageObject = this.content.includes('from ') && 
                             this.content.includes('pages/');

    if (!importsPageObject && this.lines.length > 15) {
      this.issues.push({
        type: 'suggestion',
        line: 0,
        message: '测试较长，建议使用页面对象模型 (POM)',
        code: 'test',
        suggestion: '考虑创建页面对象类来封装页面操作'
      });
    }
  }

  private checkClickStability(): void {
    this.lines.forEach((line, index) => {
      if (line.includes('.click()') && (line.includes("getByRole('cell'") || line.includes('td'))) {
        this.issues.push({
          type: 'warning',
          line: index + 1,
          message: '检测到对表格单元格的直接点击，容易被浮动表头或遮罩拦截',
          code: line.trim(),
          suggestion: '尝试使用 .click({ force: true }) 或先执行 .scrollIntoViewIfNeeded()'
        });
      }

      if (line.includes('.first().click()')) {
        this.issues.push({
          type: 'suggestion',
          line: index + 1,
          message: '使用 .first().click() 可能存在定位歧义',
          code: line.trim(),
          suggestion: '建议结合 hasText 或 getByTestId 锁定唯一行，避免点到重叠元素'
        });
      }
    });
  }

  private checkTransitionWaits(): void {
    for (let i = 0; i < this.lines.length - 1; i++) {
      const currentLine = this.lines[i];
      const nextLine = this.lines[i + 1];
      
      if (currentLine.includes('.click()') && nextLine.includes('.click()')) {
        this.issues.push({
          type: 'suggestion',
          line: i + 2,
          message: '连续的点击操作，中间可能缺少动画缓冲或加载等待',
          code: nextLine.trim(),
          suggestion: '建议在两次点击间加入 await page.waitForTimeout(300) 或等待特定加载器消失'
        });
      }
    }
  }

  private checkClickInterceptionRisk(): void {
    this.lines.forEach((line, index) => {
      if (line.includes('getByRole') && !line.includes('force: true')) {
        const isTable = line.includes('cell') || line.includes('row');
        if (isTable) {
          this.issues.push({
            type: 'warning',
            line: index + 1,
            message: 'UI 拦截高风险：表格单元格点击建议增加强制点击或滚动确保可见',
            code: line.trim(),
            suggestion: 'click({ force: true }) 或 evaluate(n => n.click())'
          });
        }
      }
    });
  }

  private checkErrorPronePatterns(): void {
    if (this.content.includes("getByRole('cell', { name: '1' })")) {
      this.issues.push({
        type: 'error',
        line: 0,
        message: '检测到极易失效的定位符：以数字 "1" 作为单元格定位基准',
        code: "getByRole('cell', { name: '1' })",
        suggestion: '数字 "1" 可能在多行、多列或页码器中出现。请使用更具体的定位，如 row.getByRole(\'cell\', ...)'
      });
    }

    if (this.content.includes('.locator(\'.warp-svg-icon.ant-tooltip-open\')')) {
      this.issues.push({
        type: 'error',
        line: 0,
        message: '检测到动态类名定位符：.ant-tooltip-open 依赖于 tooltip 状态',
        code: ".locator('.warp-svg-icon.ant-tooltip-open')",
        suggestion: '移除动态类名，使用稳定的类名：.locator(".warp-svg-icon").nth(0)'
      });
    }
  }

  private calculateStats() {
    const stats = {
      totalLines: this.lines.length,
      locatorCount: 0,
      semanticLocators: 0,
      cssLocators: 0,
      xpathLocators: 0,
      waitForCount: 0,
      assertionCount: 0
    };

    this.lines.forEach(line => {
      if (line.includes('page.getBy') || line.includes('page.locator')) {
        stats.locatorCount++;
      }
      if (line.includes('page.getByRole') || line.includes('page.getByText') || 
          line.includes('page.getByLabel') || line.includes('page.getByTestId')) {
        stats.semanticLocators++;
      }
      if (line.includes("page.locator('.'")) {
        stats.cssLocators++;
      }
      if (line.includes("page.locator('//")) {
        stats.xpathLocators++;
      }
      if (line.includes('waitFor')) {
        stats.waitForCount++;
      }
      if (line.includes('expect(')) {
        stats.assertionCount++;
      }
    });

    return stats;
  }

  printReport(): void {
    const result = this.analyze();
    
    console.log('\n📊 测试脚本分析报告');
    console.log('='.repeat(60));
    console.log(`文件: ${result.filePath}`);
    console.log('='.repeat(60));
    
    console.log('\n📈 统计信息:');
    console.log(`  总行数: ${result.stats.totalLines}`);
    console.log(`  定位符数量: ${result.stats.locatorCount}`);
    console.log(`  语义化定位符: ${result.stats.semanticLocators}`);
    console.log(`  CSS 选择器: ${result.stats.cssLocators}`);
    console.log(`  XPath 选择器: ${result.stats.xpathLocators}`);
    console.log(`  等待操作: ${result.stats.waitForCount}`);
    console.log(`  断言数量: ${result.stats.assertionCount}`);
    
    if (result.issues.length === 0) {
      console.log('\n✅ 未发现问题，测试脚本质量良好！');
      return;
    }
    
    console.log('\n⚠️  发现的问题:');
    console.log('='.repeat(60));
    
    const errors = result.issues.filter(i => i.type === 'error');
    const warnings = result.issues.filter(i => i.type === 'warning');
    const suggestions = result.issues.filter(i => i.type === 'suggestion');
    
    if (errors.length > 0) {
      console.log(`\n❌ 错误 (${errors.length}):`);
      errors.forEach(issue => {
        console.log(`  [行 ${issue.line}] ${issue.message}`);
        console.log(`    代码: ${issue.code}`);
        if (issue.suggestion) {
          console.log(`    建议: ${issue.suggestion}`);
        }
      });
    }
    
    if (warnings.length > 0) {
      console.log(`\n⚠️  警告 (${warnings.length}):`);
      warnings.forEach(issue => {
        console.log(`  [行 ${issue.line}] ${issue.message}`);
        console.log(`    代码: ${issue.code}`);
        if (issue.suggestion) {
          console.log(`    建议: ${issue.suggestion}`);
        }
      });
    }
    
    if (suggestions.length > 0) {
      console.log(`\n💡 建议 (${suggestions.length}):`);
      suggestions.forEach(issue => {
        console.log(`  ${issue.message}`);
        if (issue.suggestion) {
          console.log(`    建议: ${issue.suggestion}`);
        }
      });
    }
    
    console.log('\n🔧 优化建议:');
    console.log('  1. 运行 npm run optimize <文件路径> 自动优化脚本');
    if (process.env.ENABLE_POM === '1') {
      console.log('  2. 运行 npm run generate-pom <文件路径> 生成页面对象模型');
      console.log('  3. 参考项目中的最佳实践示例');
    } else {
      console.log('  2. （可选）POM 相关建议已默认关闭：如需启用设置 ENABLE_POM=1');
      console.log('  3. 参考项目中的最佳实践示例');
    }
  }

  saveReport(outputPath?: string): void {
    const result = this.analyze();
    const fileName = path.basename(this.filePath, '.spec.ts');
    const reportPath = outputPath || path.join('results/analysis', fileName + '.json');
    
    const dir = path.dirname(reportPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`\n📄 分析报告已保存到: ${reportPath}`);
  }
}

export function analyzeTestFile(
  filePath: string,
  opts?: { outputPath?: string; gate?: boolean; quiet?: boolean },
): { errorCount: number; warningCount: number; reportPath: string } {
  const analyzer = new TestAnalyzer(filePath);
  const result = analyzer.analyze();
  const errorCount = result.issues.filter((i) => i.type === 'error').length;
  const warningCount = result.issues.filter((i) => i.type === 'warning').length;
  const reportPath =
    opts?.outputPath ||
    path.join('results/analysis', path.basename(filePath, path.extname(filePath)) + '.json');
  analyzer.saveReport(reportPath);
  if (!opts?.quiet) {
    analyzer.printReport();
  }
  if (opts?.gate && errorCount > 0) {
    console.error(`❌ analyze-test gate 失败：${errorCount} 个 error 级问题`);
    process.exit(1);
  }
  return { errorCount, warningCount, reportPath };
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log('使用方法: npm run analyze-test <测试文件路径> [--output=path] [--gate]');
    console.log('示例: npm run analyze-test tests/raw-recordings/2026-03-02T10-20-26.spec.ts');
    process.exit(args.length === 0 ? 1 : 0);
  }

  let filePath = '';
  let outputPath: string | undefined;
  let gate = false;
  for (const arg of args) {
    if (arg.startsWith('--output=')) {
      outputPath = arg.slice('--output='.length).trim();
    } else if (arg === '--gate') {
      gate = true;
    } else if (!arg.startsWith('--')) {
      filePath = arg;
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    console.error(`❌ 文件不存在: ${filePath || '(未指定)'}`);
    process.exit(1);
  }

  console.log(`🔍 正在分析测试脚本: ${filePath}`);
  analyzeTestFile(filePath, { outputPath, gate });
  console.log('\n✨ 分析完成！');
}

const isMain =
  process.argv[1]?.includes('analyze-test.ts') ||
  process.argv[1]?.includes('analyze-test.js');
if (isMain) main();
