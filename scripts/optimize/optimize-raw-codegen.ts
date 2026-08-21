import { getGenWait, getScreenshotMode } from './optimize-raw-wait.js';
import { isKeyAction, type OptimizeOptions } from './optimize-raw-passes.js';

export interface Action {
  index: number;
  type: 'click' | 'fill' | 'type' | 'check' | 'selectOption' | 'press' | 'goto';
  selector: string;
  text?: string;
  url?: string;
  originalLine: number;
}

export type OptimizedImportPaths = {
  fixtures: string;
  screenshot: string;
  optimizedActions: string;
  fixturesCommentPhrase: string;
};

type CodegenCtx = {
  options: OptimizeOptions;
  hasIframe: boolean;
};

function actionUsesIframeContext(action: Action): boolean {
  const s = action.selector;
  return /contentFrame\s*\(\)/.test(s) || /frameLocator\s*\(\s*['"]iframe['"]\s*\)/.test(s);
}

function buildLocatorDeclaration(ctx: CodegenCtx, action: Action, locatorCode: string): string {
  const wait = getGenWait();
  if (ctx.hasIframe && actionUsesIframeContext(action)) {
    return `await page.locator('iframe').first().waitFor({ state: 'attached', timeout: ${wait.iframeAttachedMs} }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = ${locatorCode};`;
  }
  return `const locator = ${locatorCode};`;
}

function expectVisibleLine(ctx: CodegenCtx, action: Action, keyAction: boolean): string {
  if (!ctx.options.addVisible || !keyAction) return '';
  const wait = getGenWait();
  const iframeStep = ctx.hasIframe && actionUsesIframeContext(action);
  const timeout = iframeStep ? wait.expectVisibleIframeMs : wait.expectVisibleMs;
  return `await expect(locator).toBeVisible({ timeout: ${timeout} });`;
}

function isCriticalStep(label: string): boolean {
  const criticalKeywords = [
    '新建', '提交', '保存', '删除', '审批', '通过', '驳回',
    '登录', '注册', '支付', '下单', '确认', '发送',
    '新增', '编辑', '修改', '更新', '导入', '导出',
    '取 消', '取消',
    // 顶栏模块切换：加载慢时 4s skip 会误跳过，后续侧栏步骤必挂
    '工作台', '首页', '系统管理', '消费平台', '财务管理',
  ];
  return criticalKeywords.some((kw) => label.includes(kw));
}

function beforeScreenshotLine(stepIndex: number, fileLabel: string, runDirVariable: string): string {
  if (getScreenshotMode() === 'after-only') return '';
  return `    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-before.png\`));
`;
}

function optimizeLocator(locator: string): string {
  let optimized = locator;

  if (optimized.includes('.ant-select-arrow')) {
    optimized += '.filter({ visible: true }).first()';
  }

  if (optimized.includes('getByRole') || optimized.includes('getByText') || optimized.includes('getByLabel') || optimized.includes('getByPlaceholder')) {
    if (!optimized.includes('.first()')) {
      optimized += '.filter({ visible: true }).first()';
    } else if (!optimized.includes('.filter({ visible: true })')) {
      optimized = optimized.replace('.first()', '.filter({ visible: true }).first()');
    }
    return optimized;
  }

  if (!optimized.includes('.filter') && !optimized.includes('.first()')) {
    optimized += '.filter({ visible: true }).first()';
  }

  return optimized;
}

function optimizeSelector(selector: string): string {
  let optimized = selector;

  optimized = optimized.replace(/\{\s*force:\s*true\s*\}/g, '');
  optimized = optimized.replace(/force:\s*true\s*,/g, '');
  optimized = optimized.replace(/\.waitForTimeout\([^)]+\)/g, '');

  if (optimized.includes(' > path') && /\.click\(\)/.test(optimized)) {
    optimized = optimized.replace(/ > path/g, '');
  }

  return optimized;
}

function extractAndOptimizeLocator(ctx: CodegenCtx, selector: string): string {
  let locator = selector.trim().replace(/^await\s+/, '');
  locator = locator.replace(/\.(click|fill|type|check|selectOption|press)\(.*\)\s*;?$/, '');

  const iframePrefix1 = /^page\.locator\((['"])iframe\1\)\.contentFrame\(\)\./;
  const iframePrefix2 = /^page\.frameLocator\((['"])iframe\1\)\./;
  if (iframePrefix1.test(locator)) {
    locator = locator.replace(iframePrefix1, ctx.hasIframe ? 'baseContext.' : 'page.');
  } else if (iframePrefix2.test(locator)) {
    locator = locator.replace(iframePrefix2, ctx.hasIframe ? 'baseContext.' : 'page.');
  }

  return optimizeLocator(locator);
}

function cleanLabel(label: string): string {
  return label
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5-]/g, "");
}

function getActionLabel(action: Action): string {
  if (action.type === 'goto') return `Go to ${action.url || 'page'}`;
  if (action.text) return cleanLabel(action.text);
  return "action";
}

function generateActionCode(ctx: CodegenCtx, action: Action, stepIndex: number, runDirVariable: string): string {
  const wait = getGenWait();
  const label = getActionLabel(action);
  const fileLabel = cleanLabel(label) || `step-${stepIndex}`;
  const selector = optimizeSelector(action.selector);
  const locatorCode = extractAndOptimizeLocator(ctx, selector);
  const keyAction = isKeyAction(action.selector);
  const isCritical = isCriticalStep(label);

  const skipGuard = isCritical
    ? ''
    : `    try {
      await expect(locator).toBeVisible({ timeout: ${wait.skipGuardVisibleMs} });
    } catch {
      console.log('ℹ️  ${label}：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-skipped.png\`), { mode: 'stable' });
      return;
    }
`;

  const visibleLine = isCritical ? expectVisibleLine(ctx, action, keyAction) : '';
  const locatorVisibleTimeout = actionUsesIframeContext(action)
    ? wait.locatorVisibleIframeMs
    : wait.locatorVisibleMs;

  switch (action.type) {
    case 'click':
      return `  await step('${label}', async () => {
${beforeScreenshotLine(stepIndex, fileLabel, runDirVariable)}    ${buildLocatorDeclaration(ctx, action, locatorCode)}
${skipGuard}${visibleLine}    await smartClick(locator, '${label}');
    await page.waitForLoadState('networkidle', { timeout: ${wait.networkIdleAfterMs} }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-after.png\`), { mode: 'stable' });
  });

`;
    case 'fill':
    case 'type': {
      const text = action.text || '';
      return `  await step('${label}', async () => {
${beforeScreenshotLine(stepIndex, fileLabel, runDirVariable)}    ${buildLocatorDeclaration(ctx, action, locatorCode)}
${skipGuard}${visibleLine}    await smartFill(locator, "${text}", '${label}');
    await page.waitForLoadState('networkidle', { timeout: ${wait.networkIdleAfterMs} }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-after.png\`), { mode: 'stable' });
  });

`;
    }
    case 'check':
      return `  await step('${label}', async () => {
${beforeScreenshotLine(stepIndex, fileLabel, runDirVariable)}    ${buildLocatorDeclaration(ctx, action, locatorCode)}
${skipGuard}${visibleLine}    try {
      await locator.waitFor({ state: 'visible', timeout: ${locatorVisibleTimeout} });
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
    await page.waitForLoadState('networkidle', { timeout: ${wait.networkIdleAfterMs} }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-after.png\`), { mode: 'stable' });
  });

`;
    case 'selectOption':
      return `  await step('${label}', async () => {
${beforeScreenshotLine(stepIndex, fileLabel, runDirVariable)}    ${buildLocatorDeclaration(ctx, action, locatorCode)}
${skipGuard}${visibleLine}    try {
      await locator.waitFor({ state: 'visible', timeout: ${locatorVisibleTimeout} });
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
    await page.waitForLoadState('networkidle', { timeout: ${wait.networkIdleAfterMs} }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-after.png\`), { mode: 'stable' });
  });

`;
    case 'press':
      return `  await step('${label}', async () => {
${beforeScreenshotLine(stepIndex, fileLabel, runDirVariable)}    ${buildLocatorDeclaration(ctx, action, locatorCode)}
${skipGuard}${visibleLine}    try {
      await locator.waitFor({ state: 'visible', timeout: ${locatorVisibleTimeout} });
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
    await page.waitForLoadState('networkidle', { timeout: ${wait.networkIdleAfterMs} }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-${fileLabel}-after.png\`), { mode: 'stable' });
  });

`;
    default:
      return '';
  }
}

function generateActionsCode(ctx: CodegenCtx, actions: Action[], runDirVariable: string): string {
  const wait = getGenWait();
  let code = '';
  let stepIndex = 1;

  actions.forEach((action) => {
    if (action.type === 'goto') {
      const gotoUrl = action.url === '/' || action.url === '' ? '/main/home' : (action.url || '/');
      const appReadyWait = ctx.hasIframe
        ? `await page.locator('iframe').first().waitFor({ state: 'attached', timeout: ${wait.iframeAttachedMs} }).catch(() => {});
    await page.frameLocator('iframe').first().getByRole('tab', { name: '工作台' }).waitFor({ state: 'visible', timeout: ${wait.expectVisibleIframeMs} }).catch(() => {});`
        : '';
      code += `  await step('导航到页面', async () => {
    console.log('🌐 导航到: ${gotoUrl}');
    await page.goto('${gotoUrl}', { waitUntil: 'load' });
    ${ctx.options.waitLoad ? `await page.waitForLoadState('networkidle', { timeout: ${wait.networkIdleGotoMs} }).catch(() => {});` : ''}
    ${appReadyWait}
    await takeStepScreenshot(page, path.join(${runDirVariable}, \`step-${stepIndex}-导航到页面.png\`));
  });

`;
      stepIndex++;
    } else {
      const actionCode = generateActionCode(ctx, action, stepIndex, runDirVariable);
      code += actionCode;
      stepIndex++;
    }
  });

  return code;
}

export function generateTemplateCode(input: {
  testName: string;
  screenshotDir: string;
  testUseLines: string[];
  actions: Action[];
  options: OptimizeOptions;
  hasIframe: boolean;
  importPaths: OptimizedImportPaths;
}): string {
  const { testName, screenshotDir, testUseLines, actions, options, hasIframe, importPaths: imp } = input;
  const ctx: CodegenCtx = { options, hasIframe };
  const wait = getGenWait();
  const needsClick = actions.some((a) => a.type === 'click');
  const needsFill = actions.some((a) => a.type === 'fill');
  const actionImports = [
    'step',
    'maybePause',
    ...(needsClick ? ['smartClick'] : []),
    ...(needsFill ? ['smartFill'] : []),
  ];

  const template = `import { test, expect } from '${imp.fixtures}';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot, waitForPostInteractionPaint, withScreenshotRunSegment } from '${imp.screenshot}';
import { ${actionImports.join(', ')} } from '${imp.optimizedActions}';

${testUseLines.length > 0 ? testUseLines.join('\n') + '\n\n' : ''}test('${testName}', async ({ page }) => {
  ${options.addTimeout ? `test.setTimeout(${wait.testTimeoutMs});` : ''}

  // 截图根目录；Chrome/WebKit 子目录由 ${imp.fixturesCommentPhrase} 按引擎自动设置（仍可用 PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT 手动覆盖）
  const screenshotDir = withScreenshotRunSegment('${screenshotDir}');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(screenshotDir, timestamp);

  // 检查是否有页面导航操作
  const hasGotoAction = ${actions.some(action => action.type === 'goto')};
  
  if (!hasGotoAction) {
    // 如果没有页面导航，添加一个默认的（/main/home，避免恢复到上次业务路由）
    await step('导航到首页', async () => {
      console.log('🌐 导航到: /main/home (基于 baseURL)');
      await page.goto('/main/home', { waitUntil: 'load' });
      await takeStepScreenshot(page, path.join(runDir, \`step-1-导航到首页.png\`));
    });
  }

  ${generateActionsCode(ctx, actions, 'runDir')}

  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + '${testName}');
});
`;

  return template;
}
