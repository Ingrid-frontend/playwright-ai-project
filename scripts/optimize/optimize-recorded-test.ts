import * as fs from 'fs';
import * as path from 'path';
import { getDateCategoryForCalendarDay } from '../../src/utils/date-category.cjs';
import { buildOptimizedRel, getLegacyEnvDefault } from '../../src/utils/test-env-path.js';

interface Action {
  index: number;
  type: 'click' | 'fill' | 'type' | 'check' | 'selectOption' | 'press';
  selector: string;
  text?: string;
  originalLine: number;
}

class TestOptimizer {
  private filePath: string;
  private content: string;
  private lines: string[];
  private actions: Action[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
    this.content = fs.readFileSync(filePath, 'utf-8');
    this.lines = this.content.split('\n');
  }

  optimize(): string {
    this.addImports();
    this.addStorageState();
    this.addScreenshotSetup();
    this.wrapActionsWithStep();
    this.addTraceSupport();
    this.addAssertions();
    this.optimizeLocators();
    
    return this.lines.join('\n');
  }

  private addImports(): void {
    if (!this.content.includes("import fs from 'fs'")) {
      this.lines.splice(1, 0, "import fs from 'fs';");
    }
    if (!this.content.includes("import { screenshotWhenStable } from '../../utils/screenshot'")) {
      this.lines.splice(2, 0, "import { screenshotWhenStable } from '../../utils/screenshot';");
    }
  }

  private addStorageState(): void {
    const testLineIndex = this.lines.findIndex(line => line.includes('test('));
    if (testLineIndex !== -1 && !this.content.includes('test.setTimeout')) {
      const testBodyIndex = this.findTestBodyStart();
      if (testBodyIndex !== -1) {
        const indent = this.getIndent(this.lines[testBodyIndex + 1] || "");
        this.lines.splice(testBodyIndex + 1, 0, `${indent}test.setTimeout(60000);`);
      }
    }
    
    const storageStateIndex = this.lines.findIndex(line => line.includes('storageState'));
    if (storageStateIndex !== -1) {
      const testUseIndex = this.lines.findIndex(line => line.includes('test.use'));
      if (testUseIndex !== -1) {
        const closingBraceIndex = this.lines.findIndex((line, index) => index > testUseIndex && line.trim() === '});');
        if (closingBraceIndex !== -1) {
          const testUseBlock = this.lines.slice(testUseIndex, closingBraceIndex + 1).join('\n');
          if (!testUseBlock.includes('storageState')) {
            this.lines.splice(testUseIndex, closingBraceIndex - testUseIndex + 1);
          }
        }
      }
    }
  }

  private addScreenshotSetup(): void {
    const bodyIndex = this.findTestBodyStart();
    if (bodyIndex === -1) return;

    const indent = this.getIndent(this.lines[bodyIndex + 1] || "");
    const dir = this.getScreenshotDir();

    const code = `
${indent}const screenshotRoot = '${dir}';
${indent}const now = new Date();
${indent}const runTimestamp = \`\${now.getFullYear()}-\${String(now.getMonth() + 1).padStart(2, '0')}-\${String(now.getDate()).padStart(2, '0')}_\${String(now.getHours()).padStart(2, '0')}-\${String(now.getMinutes()).padStart(2, '0')}-\${String(now.getSeconds()).padStart(2, '0')}\`;
${indent}const testId = Math.random().toString(36).substring(2, 9);
${indent}let browserInfo = 'unknown';
${indent}let runDir = '';
${indent}const getScreenshotPath = (step: number, label: string) => \`\${runDir}/step-\${step}-\${label}.png\`;
`;

    this.lines.splice(bodyIndex + 1, 0, code);

    const gotoIndex = this.lines.findIndex(line => line.includes('page.goto('));
    if (gotoIndex !== -1) {
      const lineIndent = this.getIndent(this.lines[gotoIndex]);
      const browserDetection = `${lineIndent}browserInfo = await page.context().browser()?.browserType().name() || 'unknown';
${lineIndent}runDir = \`\${screenshotRoot}/\${runTimestamp}-\${browserInfo}-\${testId}\`;
${lineIndent}if (!fs.existsSync(runDir)) {
${lineIndent}  fs.mkdirSync(runDir, { recursive: true });
${lineIndent}}`;
      this.lines.splice(gotoIndex + 1, 0, browserDetection);
    }
  }

  private wrapActionsWithStep(): void {
    this.analyzeActions();
    console.log(`🔍 分析到 ${this.actions.length} 个操作`);
    
    let step = 1;

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      
      if (!this.isActionLine(line)) continue;

      const indent = this.getIndent(line);
      const label = this.getActionLabel(line);
      const stepName = `step-${step}-${label}`;

      const beforeShot = `${indent}const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(page, getScreenshotPath(${step}, 'before-${label}'));`;
      const afterShot = `${indent}const { path: afterPath, route: afterRoute } = await screenshotWhenStable(page, getScreenshotPath(${step}, 'after-${label}'));`;

      const wrapped = [
        `${indent}await test.step('${stepName}', async () => {`,
        beforeShot,
        `${indent}  console.log('📍 当前路由:', beforeRoute);`,
        `${indent}  try {`,
        line,
        `${indent}  } catch (error) {`,
        `${indent}    console.log(\`❌ 步骤执行失败: \${error.message}\`);`,
        `${indent}    throw error;`,
        `${indent}  }`,
        afterShot,
        `${indent}  console.log('📍 当前路由:', afterRoute);`,
        `${indent}});`
      ];

      this.lines.splice(i, 1, ...wrapped);
      step++;
      i += 8;
    }
  }

  private addTraceSupport(): void {
    const testLineIndex = this.lines.findIndex(line => line.includes('test('));
    if (testLineIndex === -1) return;

    const testBodyIndex = this.findTestBodyStart();
    if (testBodyIndex === -1) return;

    const indent = this.getIndent(this.lines[testBodyIndex + 1] || "");
    
    if (!this.content.includes('tracing.start')) {
      this.lines.splice(testBodyIndex + 1, 0, `${indent}const tracingStarted = await page.context().tracing.start({ screenshots: true, snapshots: true }).catch(() => false);`);
    }

    const lastLineIndex = this.lines.reduceRight((index, line, i) => {
      return index === -1 && line.trim() === '});' ? i : index;
    }, -1);
    if (lastLineIndex !== -1 && !this.content.includes('tracing.stop')) {
      this.lines.splice(lastLineIndex, 0, `${indent}if (tracingStarted) {`);
      this.lines.splice(lastLineIndex + 1, 0, `${indent}  await page.context().tracing.stop({ path: \`\${runDir}/trace.zip\` });`);
      this.lines.splice(lastLineIndex + 2, 0, `${indent}}`);
    }
  }

  private addAssertions(): void {
    const gotoIndex = this.lines.findIndex(line => line.includes('page.goto('));
    if (gotoIndex === -1) return;

    const indent = this.getIndent(this.lines[gotoIndex]);
    
    if (!this.hasAssertionAfter(gotoIndex)) {
      this.lines.splice(gotoIndex + 1, 0, `${indent}await expect(page).toHaveURL(/.*huilianyi.*/);`);
    }
  }

  private optimizeLocators(): void {
    this.lines = this.lines.map(line => {
      let optimizedLine = line;

      optimizedLine = optimizedLine.replace(/\.locator\(['"]\.anticon\.anticon-close > svg['"]\)/, '.locator(".anticon.anticon-close > svg")');
      optimizedLine = optimizedLine.replace(/\.locator\(['"]\.ant-table-row\.chooser-table-row > \.ant-table-selection-column > span > \.ant-checkbox-wrapper > \.ant-checkbox > \.ant-checkbox-input['"]\)/, '.locator(".ant-table-row.chooser-table-row .ant-checkbox-input")');
      optimizedLine = optimizedLine.replace(/\.locator\(['"]\.ant-table-row\.chooser-table-row > \.ant-table-selection-column > span > \.ant-checkbox-wrapper > \.ant-checkbox > \.ant-checkbox-input['"]\)/, '.locator(".ant-table-row.chooser-table-row .ant-checkbox-input")');
      optimizedLine = optimizedLine.replace(/\.getByRole\(['"]checkbox['"]\)\.first\(\)/, '.getByRole("checkbox").filter({ visible: true }).first()');

      optimizedLine = optimizedLine.replace(/\.locator\(['"]\.anticon\.anticon-down > svg > path['"]\)\.first\(\)\.click\(\)/, '.locator(".anticon.anticon-down").filter({ visible: true }).nth(0).click({ force: true })');
      optimizedLine = optimizedLine.replace(/\.locator\(['"]\.anticon\.anticon-down > svg > path['"]\)\.click\(\)/, '.locator(".anticon.anticon-down").filter({ visible: true }).nth(0).click({ force: true })');
      optimizedLine = optimizedLine.replace(/\.locator\(['"]\.anticon\.[^'"]+ > svg > path['"]\)\.first\(\)\.click\(\)/g, (match) => {
        const anticonClass = match.match(/\.anticon\.([^'"]+)/)?.[1];
        return `.locator(".anticon.${anticonClass}").filter({ visible: true }).nth(0).click({ force: true })`;
      });
      optimizedLine = optimizedLine.replace(/\.locator\(['"]\.anticon\.[^'"]+ > svg > path['"]\)\.click\(\)/g, (match) => {
        const anticonClass = match.match(/\.anticon\.([^'"]+)/)?.[1];
        return `.locator(".anticon.${anticonClass}").filter({ visible: true }).nth(0).click({ force: true })`;
      });

      optimizedLine = optimizedLine.replace(/\.locator\(['"]\.ant-select-selection__rendered['"]\)\.first\(\)\.click\(\)/, '.getByRole("combobox").filter({ visible: true }).nth(0).click({ force: true })');
      optimizedLine = optimizedLine.replace(/\.locator\(['"]\.ant-select-selection__rendered['"]\)\.click\(\)/, '.getByRole("combobox").filter({ visible: true }).nth(0).click({ force: true })');

      optimizedLine = optimizedLine.replace(/\.locator\(['"]path['"]\)\.first\(\)\.click\(\)/, '.locator("path").filter({ visible: true }).nth(0).click({ force: true })');
      optimizedLine = optimizedLine.replace(/\.locator\(['"]path['"]\)\.click\(\)/, '.locator("path").filter({ visible: true }).nth(0).click({ force: true })');

      optimizedLine = optimizedLine.replace(/\.getByRole\(['"]button['"],\s*\{\s*name:\s*['"]查看详情['"]\}\)\.first\(\)\.click\(\)/, '.getByRole("button", { name: "查看详情" }).filter({ visible: true }).nth(0).click({ force: true })');
      optimizedLine = optimizedLine.replace(/\.getByRole\(['"]button['"],\s*\{\s*name:\s*['"]查看详情['"]\}\)\.click\(\)/, '.getByRole("button", { name: "查看详情" }).filter({ visible: true }).click({ force: true })');

      optimizedLine = optimizedLine.replace(/\.getByRole\(['"]button['"],\s*\{\s*name:\s*['"]查看详情['"]\}\)\.first\(\)/, '.getByRole("button", { name: "查看详情" }).filter({ visible: true }).nth(0)');
      optimizedLine = optimizedLine.replace(/\.getByRole\(['"]button['"],\s*\{\s*name:\s*['"]查看详情['"]\}\)/, '.getByRole("button", { name: "查看详情" })');

      optimizedLine = optimizedLine.replace(/\.locator\(['"]\.warp-svg-icon\.ant-tooltip-open['"]\)\.click\(\)/, '.locator(".warp-svg-icon").filter({ visible: true }).nth(0).click({ force: true })');

      optimizedLine = optimizedLine.replace(/\.getByRole\(['"]cell['"],\s*\{\s*name:\s*['"](\d+)['"]\s*,\s*exact:\s*true\s*\}\)\.first\(\)\.click\(\)/, '.getByRole("cell", { name: "$1", exact: true }).filter({ visible: true }).first().scrollIntoViewIfNeeded();\n  await page.getByRole("cell", { name: "$1", exact: true }).filter({ visible: true }).first().click({ force: true })');
      optimizedLine = optimizedLine.replace(/\.getByRole\(['"]cell['"],\s*\{\s*name:\s*['"](\d+)['"]\s*,\s*exact:\s*true\s*\}\)\.click\(\)/, '.getByRole("cell", { name: "$1", exact: true }).filter({ visible: true }).scrollIntoViewIfNeeded();\n  await page.getByRole("cell", { name: "$1", exact: true }).filter({ visible: true }).click({ force: true })');
      optimizedLine = optimizedLine.replace(/\.getByRole\(['"]cell['"],\s*\{\s*name:\s*['"](\d+)['"]\}\)\.first\(\)\.click\(\)/, '.getByRole("cell", { name: "$1" }).filter({ visible: true }).first().scrollIntoViewIfNeeded();\n  await page.getByRole("cell", { name: "$1" }).filter({ visible: true }).first().click({ force: true })');
      optimizedLine = optimizedLine.replace(/\.getByRole\(['"]cell['"],\s*\{\s*name:\s*['"](\d+)['"]\}\)\.click\(\)/, '.getByRole("cell", { name: "$1" }).filter({ visible: true }).scrollIntoViewIfNeeded();\n  await page.getByRole("cell", { name: "$1" }).filter({ visible: true }).click({ force: true })');

      optimizedLine = optimizedLine.replace(
        /await page\.(getBy\w+|locator)\((.+?)\)\.first\(\)\.click\(\);/,
        `const _locator = page.$1($2).filter({ visible: true }).first();\n  await _locator.click({ force: true, delay: 100 });`
      );

      optimizedLine = optimizedLine.replace(
        /await page\.(getBy\w+|locator)\((.+?)\)\.click\(\);/,
        `const _locator = page.$1($2).filter({ visible: true });\n  await _locator.click({ force: true, delay: 100 });`
      );

      optimizedLine = optimizedLine.replace(
        /const _locator = page\.getByText\(['"]([^'"]+)['"]\)\.filter\(\{ visible: true \}\);/,
        `const _locator = page.getByText("$1").filter({ visible: true }).first();`
      );

      optimizedLine = optimizedLine.replace(
        /const _locator = page\.getByRole\(['"]button['"],\s*\{\s*name:\s*['"]([^'"]+)['"]\s*\}\)\.filter\(\{ visible: true \}\);/,
        `const _locator = page.getByRole("button", { name: "$1" }).filter({ visible: true }).first();`
      );

      return optimizedLine;
    });
  }

  private analyzeActions(): void {
    this.lines.forEach((line, index) => {
      const clickMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.click\(\);/);
      const fillMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.(fill|type)\(.+\);/);
      const checkMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.check\(\);/);
      const selectMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.selectOption\(.+\);/);
      const pressMatch = line.match(/await page\.(getBy\w*|locator)\(.+\)\.press\(.+\);/);

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
  }

  private isActionLine(line: string): boolean {
    return /await page\.(getBy|locator|click|fill|type|press)/.test(line) && !line.includes('page.goto(');
  }

  private getActionLabel(line: string): string {
    const nameMatch = line.match(/name:\s*['"]([^'"]+)['"]/);
    if (nameMatch) return this.cleanLabel(nameMatch[1]);

    const textMatch = line.match(/getByText\(['"]([^'"]+)['"]\)/);
    if (textMatch) return this.cleanLabel(textMatch[1]);

    const fillMatch = line.match(/fill\(['"]([^'"]+)['"]\)/);
    if (fillMatch) return "fill";

    return "action";
  }

  private cleanLabel(label: string): string {
    return label
      .replace(/\s+/g, "-")
      .replace(/[^\w\u4e00-\u9fa5-]/g, "");
  }

  private findTestBodyStart(): number {
    const testIndex = this.lines.findIndex(l => l.includes("test("));
    if (testIndex === -1) return -1;

    for (let i = testIndex; i < this.lines.length; i++) {
      if (this.lines[i].includes("{")) return i;
    }

    return -1;
  }

  private getIndent(line: string): string {
    const match = line.match(/^\s*/);
    return match ? match[0] : "";
  }

  private getScreenshotDir(): string {
    const name = path.basename(this.filePath).replace(".spec.ts", "");
    // 从文件名中提取日期部分（格式：YYYY-MM-DD）
    const dateMatch = name.match(/(\d{4}-\d{2}-\d{2})/);
    let dateCategory = 'default';
    if (dateMatch) {
      dateCategory = getDateCategoryForDate(dateMatch[1]);
    }
    return `screenshots/${dateCategory}/${name}`;
  }

  private extractText(line: string): string | undefined {
    const textMatch = line.match(/name:\s*['"]([^'"]+)['"]/);
    if (textMatch) {
      return textMatch[1];
    }
    const getByTextMatch = line.match(/getByText\(['"]([^'"]+)['"]\)/);
    if (getByTextMatch) {
      return getByTextMatch[1];
    }
    return undefined;
  }

  private extractSelector(line: string): string {
    const match = line.match(/page\.(getBy\w*|locator)\((.+)\)\.(click|fill|type|check|selectOption|press)\(/);
    if (match) {
      return match[2];
    }
    return '';
  }

  private hasAssertionAfter(lineIndex: number): boolean {
    for (let i = lineIndex + 1; i < Math.min(lineIndex + 5, this.lines.length); i++) {
      if (this.lines[i].includes('expect(')) {
        return true;
      }
    }
    return false;
  }
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('❌ 请提供测试文件路径或文件夹路径');
  console.error('📖 使用方法:');
  console.error('   单个文件: npm run optimize -- tests/raw-recordings/2026-03-09_12-01-22.spec.ts');
  console.error('   批量处理: npm run optimize -- tests/raw-recordings/');
  process.exit(1);
}

function getDateCategoryForDate(dateStr: string): string {
  return getDateCategoryForCalendarDay(dateStr);
}

async function processFile(filePath: string): Promise<void> {
  const optimizer = new TestOptimizer(filePath);
  const result = optimizer.optimize();

  const fileName = path.basename(filePath);
  // 从文件名中提取日期部分（格式：YYYY-MM-DD）
  const dateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
  let dateCategory = 'default';
  if (dateMatch) {
    dateCategory = getDateCategoryForDate(dateMatch[1]);
  }

  const playwrightEnv = process.env.PLAYWRIGHT_ENV?.trim() || getLegacyEnvDefault();
  const stem = fileName.replace('.spec.ts', '');
  const outputRel = buildOptimizedRel({ playwrightEnv, dateCategory, stem });
  const outputPath = path.join(process.cwd(), outputRel);
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

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
