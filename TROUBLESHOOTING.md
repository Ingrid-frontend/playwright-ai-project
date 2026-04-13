# 问题排查指南

## 录制相关问题

### 浏览器未安装

**错误信息：**
```
Executable doesn't exist at /Users/.../chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app
Please run: npx playwright install
```

**解决方案：**
```bash
npx playwright install chromium
```

### 录制命令

```bash
# 使用登录状态录制
npm run record

# 录制文件保存在 tests/raw-recordings/ 目录
# 文件名格式：YYYY-MM-DD_HH-MM-SS.spec.ts
```

## 登录相关问题

### 测试仍然停留在登录页

**原因**：storageState 文件不存在或无效

**解决方案：**
```bash
# 删除现有文件并重新生成
rm storage/loginState/stage.json
npx playwright test --project=setup
```

### setup 项目报错 "ENOENT: no such file or directory"

**原因**：setup 项目尝试加载不存在的 storageState 文件

**解决方案**：确保 `playwright.config.ts` 中 setup 项目没有配置 `storageState`

## 环境切换问题

### 切换环境后仍然使用旧的 storageState

**原因**：不同环境使用不同的 storageState 文件

**解决方案**：
```bash
# 使用正确的环境变量
NODE_ENV=uat npx playwright test
```

## 测试执行问题

### 元素定位超时

**常见原因**：
- 元素尚未加载完成
- 选择器不正确
- 页面仍在加载中

**解决方案**：
- 增加 `actionTimeout` 配置
- 添加适当的等待（`waitForLoadState`, `waitForTimeout`）
- 使用语义化定位符（`getByRole`, `getByLabel`）

### 元素被覆盖

**错误信息**：`element intercepts pointer events`

**解决方案**：
- 使用 `{ force: true }` 选项
- 增加等待时间让页面稳定
- 滚动到元素位置

## 浏览器兼容性

### .first() 方法不工作

**错误信息**：`.first不是函数`

**解决方案**：
- 使用 `.nth(0)` 替代 `.first()`
- 确保选择器返回多个元素时使用正确的索引

## 截图对比

### 图片尺寸不同

**警告信息**：`图片尺寸不同: 1280x720 vs 2560x1440`

**解决方案**：
- 使用重叠区域进行对比
- 统一浏览器窗口大小
- 使用 `viewport` 配置确保一致

## 常用命令

```bash
# 安装浏览器
npx playwright install chromium

# 重新生成登录状态
rm storage/loginState/stage.json
npx playwright test --project=setup

# 运行测试
npx playwright test tests/e2e/example.spec.ts --project=optimized

# 查看测试报告
npm run report
```
