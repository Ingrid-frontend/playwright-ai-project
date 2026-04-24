# 截图空白问题分析报告

## 问题描述
2026-04-13T11-20-21-904Z 的截图是宽高完整的，而 2026-04-22T06-44-06-393Z 的截图屏幕没有完全放大，右侧和底部有空白。

## 技术分析

### 1. 截图尺寸对比
| 时间戳 | 尺寸 | 文件大小 |
|--------|------|----------|
| 2026-04-13T11-20-21-904Z | 1280 x 720 | 226KB |
| 2026-04-22T06-44-06-393Z | 1600 x 900 | 208KB |

### 2. 配置差异

**Playwright 配置** (`playwright.config.ts`):
- 默认视口设置：`viewport: { width: 1280, height: 720 }`
- Optimized 项目配置：使用 `...devices['Desktop Chrome']`

**Desktop Chrome 设备参数**:
- 视口大小：1600 x 900
- 设备缩放：1

### 3. 根本原因

1. **视口大小变更**：
   - 2026-04-13 使用默认视口 (1280x720)
   - 2026-04-22 使用 Desktop Chrome 视口 (1600x900)

2. **页面布局问题**：
   - 页面内容没有响应式设计
   - 页面宽度固定，不会自动适应更大的视口
   - 当视口从 1280px 增加到 1600px 时，内容区域没有相应扩展

3. **内容加载问题**：
   - 可能页面内容没有完全加载完成就进行了截图
   - 或者页面布局需要时间来适应新的视口大小

## 解决方案

### 1. 保持一致的视口大小
修改 `playwright.config.ts` 中的 optimized 项目配置，使用固定的视口大小：

```typescript
// 优化前
{
  name: 'optimized',
  testDir: './tests/optimized',
  use: { 
    ...devices['Desktop Chrome'],
    storageState: curConfig.storageState
  },
  dependencies: ['setup'],
},

// 优化后
{
  name: 'optimized',
  testDir: './tests/optimized',
  use: { 
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 }, // 保持与默认一致
    storageState: curConfig.storageState
  },
  dependencies: ['setup'],
},
```

### 2. 优化截图时机
在 `utils/screenshot.ts` 中增加视口稳定检测：

```typescript
async function waitForViewportStable(page: Page, timeout: number = 3000): Promise<void> {
  try {
    const initialViewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }));
    
    await page.waitForTimeout(500);
    
    let stableCount = 0;
    const maxStableCount = 3;
    const startTime = Date.now();
    
    while (stableCount < maxStableCount) {
      if (Date.now() - startTime > timeout) {
        console.log(`⚠️  视口稳定检测超时 (${timeout}ms)`);
        break;
      }
      
      const currentViewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight
      }));
      
      if (currentViewport.width === initialViewport.width && 
          currentViewport.height === initialViewport.height) {
        stableCount++;
      } else {
        initialViewport.width = currentViewport.width;
        initialViewport.height = currentViewport.height;
        stableCount = 0;
      }
      
      await page.waitForTimeout(200);
    }
  } catch (error) {
    console.log('⚠️  视口稳定检测失败，继续执行');
  }
}
```

### 3. 增加页面等待时间
在截图前增加额外的等待时间，确保页面内容完全加载和布局调整：

```typescript
// 在 screenshotWhenStable 函数中增加
await page.waitForTimeout(1000); // 增加等待时间
```

## 验证方法
1. 修改配置后重新运行测试
2. 检查生成的截图是否都具有相同的尺寸
3. 确认所有截图都没有空白区域

## 预期结果
- 所有截图都使用一致的视口大小 (1280x720)
- 截图内容完整，没有右侧和底部的空白
- 截图质量和一致性得到保证
