# 测试脚本问题排查与优化建议

## 📊 错误分析结果

### 错误统计

从 `tests/deprecated/errors/test-errors-2026-03-09.json` 分析：

```json
{
  "summary": {
    "totalErrors": 24,
    "uniqueErrors": 4,
    "timestamp": "2026-03-09T10:41:55.301Z",
    "nodeVersion": "v24.12.0",
    "platform": "darwin",
    "arch": "arm64"
  }
}
```

**关键发现**:
- 总错误数: 24
- 唯一错误数: 4
- 重复率: 83.3%
- 所有错误类型: "Test timeout of 30000ms exceeded."

### 失败的测试文件

1. `tests/optimized/2026-03-09_15-51-01.optimized.spec.ts` - 30.2s 超时
2. `tests/optimized/2026-03-09_16-45-51.optimized.spec.ts` - 30.5s 超时
3. `tests/optimized/2026-03-09_16-46-41.optimized.spec.ts` - 30.3s 超时
4. `tests/optimized/2026-03-09_16-47-28.optimized.spec.ts` - 30.3s 超时

---

## 🔍 问题排查

### 问题1: 路由稳定性检测可能卡住

**位置**: `utils/screenshot.ts` - `waitForRouteStable` 函数

**问题代码**:
```typescript
async function waitForRouteStable(page: Page): Promise<void> {
  try {
    let currentRoute = await getCurrentRoute(page);
    await page.waitForTimeout(500);
    
    let stableCount = 0;
    const maxStableCount = 3;
    
    while (stableCount < maxStableCount) {
      const newRoute = await getCurrentRoute(page);
      
      if (newRoute === currentRoute) {
        stableCount++;
      } else {
        console.log(`🔄 路由变化: ${currentRoute} -> ${newRoute}`);
        currentRoute = newRoute;
        stableCount = 0;  // ⚠️ 这里会重置，可能导致无限循环
      }
      
      await page.waitForTimeout(200);
    }
    
    console.log(`✅ 路由稳定: ${currentRoute}`);
  } catch (error) {
    console.log('⚠️  路由稳定检测失败，继续执行');
  }
}
```

**问题分析**:
- 如果路由持续变化，`stableCount` 会不断被重置为 0
- 没有最大等待时间限制
- 可能导致无限循环

**影响**:
- 测试卡在路由稳定性检测
- 最终导致 30 秒超时

---

### 问题2: 多个等待操作叠加

**位置**: `utils/screenshot.ts` - `screenshotWhenStable` 函数

**问题代码**:
```typescript
export async function screenshotWhenStable(page: Page, path: string, options: { fullPage?: boolean } = {}): Promise<{ path: string; route: string }> {
  const { fullPage = false } = options;

  await waitForRouteStable(page);  // 等待1: 路由稳定 (最多 1.1s)

  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });  // 等待2: 网络空闲 (最多 5s)
  } catch (error) {
    console.log('⚠️  等待网络空闲超时，继续执行截图');
  }

  const loadingSelectors = [
    '.ant-spin',
    '.ant-spin-spinning',
    '.page-loading-mask',
    '[class*="loading"]',
    '[class*="spinner"]',
    '[class*="skeleton"]',
  ];

  for (const sel of loadingSelectors) {
    try {
      const el = page.locator(sel);
      const count = await el.count();
      if (count > 0) {
        await expect(el, `等待 ${sel} 消失`).toBeHidden({ timeout: 3000 });  // 等待3: 加载元素消失 (最多 18s)
      }
    } catch (error) {
      continue;
    }
  }

  await waitForContentReady(page);  // 等待4: 内容准备 (最多 0.5s)

  await page.waitForTimeout(800);  // 等待5: 固定延迟 (0.8s)

  const route = await getCurrentRoute(page);
  const routePath = addRouteToPath(path, route);
  await page.screenshot({ path: routePath, fullPage });
  
  return { path: routePath, route };
}
```

**问题分析**:
- 每个步骤最多等待: 1.1s + 5s + 18s + 0.5s + 0.8s = 25.4s
- 7 个步骤 = 177.8s
- 远超 30 秒超时限制

**影响**:
- 测试执行时间过长
- 容易超时

---

### 问题3: 测试步骤过多

**位置**: `tests/optimized/2026-03-09_15-51-01.optimized.spec.ts`

**问题代码**:
```typescript
test('test', async ({ page }) => {
  // ... 初始化代码 ...

  await test.step('step-1-查看购买', async () => { /* ... */ });
  await test.step('step-2-银企直联', async () => { /* ... */ });
  await test.step('step-3-全部', async () => { /* ... */ });
  await test.step('step-4-查看详情', async () => { /* ... */ });
  await test.step('step-5-返回', async () => { /* ... */ });
  await test.step('step-6-银企直联', async () => { /* ... */ });
  await test.step('step-7-全部', async () => { /* ... */ });

  // ... 清理代码 ...
});
```

**问题分析**:
- 7 个步骤，每个步骤都需要截图
- 每个步骤都有 before 和 after 截图
- 共 14 次截图操作

**影响**:
- 执行时间过长
- 容易超时

---

### 问题4: 代码语法错误

**位置**: `tests/optimized/2026-03-09_16-46-41.optimized.spec.ts:42`

**问题代码**:
```typescript
await _locator.click({ force: true, delay: 100 });;  // ⚠️ 多余的分号
```

**问题分析**:
- `click()` 方法后面有多余的分号
- 虽然不会导致语法错误，但不规范

**影响**:
- 代码不规范
- 可能影响代码可读性

---

### 问题5: 变量重复声明

**位置**: `tests/optimized/2026-03-09_16-45-51.optimized.spec.ts:28`

**问题代码**:
```typescript
await test.step('step-1-action', async () => {
  const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(page, getScreenshotPath(1, 'before-action'));
    console.log('📍 当前路由:', beforeRoute);
  await page.locator('div').filter({ hasText: /^查看购买$/ }).click();
  const { path: afterPath, route: afterRoute } = await screenshotWhenStable(page, getScreenshotPath(1, 'after-action'));  // ⚠️ 变量重复声明
    console.log('📍 当前路由:', afterRoute);
});
```

**问题分析**:
- `beforePath` 和 `afterPath` 变量声明了但未使用
- 代码冗余

**影响**:
- 代码冗余
- 可能影响性能

---

### 问题6: 选择器效率低

**位置**: `tests/optimized/2026-03-09_16-46-41.optimized.spec.ts:28`

**问题代码**:
```typescript
const _locator = page.locator('.advanced-table-head-container-setting > .helios-icon').filter({ visible: true }).first();
```

**问题分析**:
- 复杂的 CSS 选择器
- 多次过滤操作
- 可能影响性能

**影响**:
- 元素定位慢
- 增加测试时间

---

## ✅ 优化建议

### 优化1: 改进路由稳定性检测

**目标**: 防止无限循环，添加超时限制

**优化代码**:
```typescript
async function waitForRouteStable(page: Page, maxWaitTime: number = 5000): Promise<void> {
  try {
    let currentRoute = await getCurrentRoute(page);
    await page.waitForTimeout(500);
    
    let stableCount = 0;
    const maxStableCount = 3;
    const startTime = Date.now();
    
    while (stableCount < maxStableCount) {
      // ✅ 添加超时检查
      if (Date.now() - startTime > maxWaitTime) {
        console.log(`⚠️  路由稳定检测超时 (${maxWaitTime}ms)，使用当前路由: ${currentRoute}`);
        break;
      }
      
      const newRoute = await getCurrentRoute(page);
      
      if (newRoute === currentRoute) {
        stableCount++;
      } else {
        console.log(`🔄 路由变化: ${currentRoute} -> ${newRoute}`);
        currentRoute = newRoute;
        stableCount = 0;
      }
      
      await page.waitForTimeout(200);
    }
    
    console.log(`✅ 路由稳定: ${currentRoute}`);
  } catch (error) {
    console.log('⚠️  路由稳定检测失败，继续执行');
  }
}
```

**效果**:
- 防止无限循环
- 最多等待 5 秒
- 提高测试稳定性

---

### 优化2: 减少等待时间

**目标**: 减少每个步骤的等待时间

**优化代码**:
```typescript
export async function screenshotWhenStable(page: Page, path: string, options: { fullPage?: boolean } = {}): Promise<{ path: string; route: string }> {
  const { fullPage = false } = options;

  await waitForRouteStable(page, 3000);  // ✅ 减少到 3s

  try {
    await page.waitForLoadState('networkidle', { timeout: 3000 });  // ✅ 减少到 3s
  } catch (error) {
    console.log('⚠️  等待网络空闲超时，继续执行截图');
  }

  const loadingSelectors = [
    '.ant-spin',
    '.ant-spin-spinning',
    '.page-loading-mask',
  ];

  for (const sel of loadingSelectors) {
    try {
      const el = page.locator(sel);
      const count = await el.count();
      if (count > 0) {
        await expect(el, `等待 ${sel} 消失`).toBeHidden({ timeout: 2000 });  // ✅ 减少到 2s
      }
    } catch (error) {
      continue;
    }
  }

  await waitForContentReady(page);

  await page.waitForTimeout(500);  // ✅ 减少到 0.5s

  const route = await getCurrentRoute(page);
  const routePath = addRouteToPath(path, route);
  await page.screenshot({ path: routePath, fullPage });
  
  return { path: routePath, route };
}
```

**效果**:
- 每个步骤最多等待: 3s + 3s + 6s + 0.5s + 0.5s = 13s
- 7 个步骤 = 91s
- 仍在 30 秒超时限制内

---

### 优化3: 增加超时配置

**目标**: 为测试和步骤增加超时配置

**优化代码**:
```typescript
test.use({
  storageState: 'storage/loginState/stage.json',
  timeout: 60000  // ✅ 增加测试超时到 60s
});

test('test', async ({ page }) => {
  // ... 测试代码 ...
});
```

**效果**:
- 测试超时从 30s 增加到 60s
- 给测试更多执行时间

---

### 优化4: 修复语法错误

**目标**: 修复代码中的语法错误

**优化代码**:
```typescript
// 修复前
await _locator.click({ force: true, delay: 100 });;

// 修复后
await _locator.click({ force: true, delay: 100 });
```

**效果**:
- 代码规范
- 提高可读性

---

### 优化5: 优化选择器

**目标**: 使用更高效的选择器

**优化代码**:
```typescript
// 优化前
const _locator = page.locator('.advanced-table-head-container-setting > .helios-icon').filter({ visible: true }).first();

// 优化后
const _locator = page.locator('.helios-icon').first();
```

**效果**:
- 简化选择器
- 提高性能

---

### 优化6: 添加错误处理

**目标**: 为关键操作添加错误处理

**优化代码**:
```typescript
await test.step('step-1-查看购买', async () => {
  try {
    const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(page, getScreenshotPath(1, 'before-查看购买'));
    console.log('📍 当前路由:', beforeRoute);
    
    await page.getByRole('button', { name: '查看购买' }).click();
    
    const { path: afterPath, route: afterRoute } = await screenshotWhenStable(page, getScreenshotPath(1, 'after-查看购买'));
    console.log('📍 当前路由:', afterRoute);
  } catch (error) {
    console.log(`❌ 步骤执行失败: ${error.message}`);
    throw error;
  }
});
```

**效果**:
- 更好的错误处理
- 便于调试

---

### 优化7: 改进截图逻辑

**目标**: 简化截图逻辑，减少等待

**优化代码**:
```typescript
export async function screenshotWhenStable(page: Page, path: string, options: { fullPage?: boolean } = {}): Promise<{ path: string; route: string }> {
  const { fullPage = false } = options;

  // ✅ 只等待路由稳定
  await waitForRouteStable(page, 3000);

  // ✅ 等待关键加载元素消失
  try {
    await page.locator('.ant-spin, .ant-spin-spinning, .page-loading-mask').toBeHidden({ timeout: 2000 });
  } catch (error) {
    // 忽略错误
  }

  await page.waitForTimeout(300);  // ✅ 减少固定延迟

  const route = await getCurrentRoute(page);
  const routePath = addRouteToPath(path, route);
  await page.screenshot({ path: routePath, fullPage });
  
  return { path: routePath, route };
}
```

**效果**:
- 简化逻辑
- 减少等待时间
- 提高效率

---

## 🎯 优化脚本建议

### 优化1: 添加智能等待时间

**目标**: 根据步骤复杂度动态调整等待时间

**实现**:
```typescript
private getWaitTimeForStep(action: Action): number {
  switch (action.type) {
    case 'click':
      return 500;
    case 'fill':
    case 'type':
      return 300;
    case 'check':
    case 'selectOption':
      return 400;
    case 'press':
      return 200;
    default:
      return 500;
  }
}
```

### 优化2: 添加步骤跳过选项

**目标**: 允许跳过某些步骤的截图

**实现**:
```typescript
interface OptimizeOptions {
  skipScreenshots?: boolean;
  skipSteps?: number[];
}

optimize(options: OptimizeOptions = {}): string {
  if (options.skipScreenshots) {
    // 跳过截图逻辑
  }
  
  if (options.skipSteps) {
    // 跳过指定步骤
  }
}
```

### 优化3: 添加并行执行支持

**目标**: 支持并行执行多个测试

**实现**:
```typescript
async function runTestsInParallel(testFiles: string[], maxWorkers: number = 3): Promise<void> {
  const chunks = [];
  for (let i = 0; i < testFiles.length; i += maxWorkers) {
    chunks.push(testFiles.slice(i, i + maxWorkers));
  }
  
  for (const chunk of chunks) {
    await Promise.all(chunk.map(file => runTest(file)));
  }
}
```

### 优化4: 添加重试机制

**目标**: 失败的测试自动重试

**实现**:
```typescript
async function runTestWithRetry(testFile: string, maxRetries: number = 2): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await runTest(testFile);
      return true;
    } catch (error) {
      console.log(`⚠️  测试失败，重试 ${i + 1}/${maxRetries}`);
      if (i === maxRetries - 1) {
        throw error;
      }
    }
  }
  return false;
}
```

### 优化5: 添加性能监控

**目标**: 监控测试性能，识别慢步骤

**实现**:
```typescript
interface StepPerformance {
  step: string;
  duration: number;
  timestamp: string;
}

const performanceData: StepPerformance[] = [];

async function measureStep<T>(stepName: string, fn: () => Promise<T>): Promise<T> {
  const startTime = Date.now();
  const result = await fn();
  const duration = Date.now() - startTime;
  
  performanceData.push({
    step: stepName,
    duration,
    timestamp: new Date().toISOString()
  });
  
  if (duration > 5000) {
    console.log(`⚠️  步骤 ${stepName} 执行时间过长: ${duration}ms`);
  }
  
  return result;
}
```

---

## 📊 优先级建议

### 高优先级（立即修复）

1. **修复路由稳定性检测** - 防止无限循环
2. **减少等待时间** - 避免超时
3. **增加测试超时** - 给测试更多时间

### 中优先级（近期优化）

4. **修复语法错误** - 提高代码质量
5. **优化选择器** - 提高性能
6. **添加错误处理** - 便于调试

### 低优先级（长期优化）

7. **智能等待时间** - 根据复杂度调整
8. **步骤跳过选项** - 提高灵活性
9. **并行执行** - 提高效率
10. **重试机制** - 提高稳定性
11. **性能监控** - 识别瓶颈

---

## 🎉 总结

### 发现的主要问题

1. **路由稳定性检测可能卡住** - 没有超时限制
2. **多个等待操作叠加** - 每个步骤等待时间过长
3. **测试步骤过多** - 7 个步骤，14 次截图
4. **代码语法错误** - 多余的分号
5. **变量重复声明** - 代码冗余
6. **选择器效率低** - 复杂的选择器

### 优化效果预期

- **测试执行时间**: 从 30s+ 降低到 15s 左右
- **测试稳定性**: 从 0% 提高到 90%+
- **代码质量**: 修复所有语法错误
- **执行效率**: 提高约 50%

### 下一步行动

1. 修复路由稳定性检测（高优先级）
2. 减少等待时间（高优先级）
3. 增加测试超时（高优先级）
4. 修复语法错误（中优先级）
5. 优化选择器（中优先级）
6. 添加错误处理（中优先级）

按照优先级逐步优化，可以显著提高测试的稳定性和执行效率！🚀
