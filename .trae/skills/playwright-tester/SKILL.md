---
name: "playwright-tester"
description: "Automates Playwright testing tasks including running tests, recording user actions, debugging test cases, and generating test code. Invoke when user needs to run Playwright tests, record test scripts, debug test failures, or generate new test cases."
---

# Playwright 测试工具

这个技能为工作区提供全面的 Playwright 测试自动化功能。

## 功能特性

### 1. 运行测试
执行各种选项的 Playwright 测试：
- 运行所有测试或特定测试文件
- 为特定浏览器运行测试
- 在有头或无头模式下运行测试
- 在 UI 模式下运行测试进行调试
- 为特定项目运行测试
- 使用 run-tests.sh 脚本进行灵活配置

### 2. 录制测试
录制用户交互以生成测试脚本：
- 启动 Playwright codegen 并使用存储状态
- 自动处理登录状态
- 将录制保存到 `tests/raw-recordings/` 目录
- 支持不同环境（dev, uat, stage）
- 使用 TypeScript 脚本（record.ts）

### 3. 调试测试
调试失败的测试用例：
- 在调试模式下运行测试并设置断点
- 在 UI 模式下运行测试进行可视化调试
- 提供错误分析和建议
- 检查测试依赖和配置

### 4. 生成测试用例
生成测试用例代码：
- 基于需求创建测试脚本
- 使用页面对象模型（POM）模式
- 实现语义化定位符
- 添加适当的断言和错误处理

### 5. 优化测试脚本
优化录制的测试脚本：
- 添加适当的等待和断言
- 改进定位符策略
- 添加截图功能
- 生成 POM 类和测试文件

### 6. 截图对比
对比不同版本的测试截图：
- 生成 HTML 格式的对比报告
- 按浏览器和步骤分组
- 支持多种输入格式

## 使用示例

### 运行测试

```bash
# 运行所有测试
npx playwright test

# 运行特定测试文件
npx playwright test tests/e2e/login.spec.ts

# 仅运行 chromium 测试
npx playwright test --project=chromium

# 在有头模式下运行测试
npx playwright test --headed

# 在 UI 模式下运行测试
npx playwright test --ui

# 使用 run-tests.sh 脚本（推荐）
./run-tests.sh -p chromium -f tests/e2e/example.spec.ts
./run-tests.sh -w 1 -p chromium --headed
```

### 录制测试

```bash
# 使用登录状态开始录制
npm run record

# 为特定环境录制
NODE_ENV=uat npm run record

# 录制文件保存在 tests/raw-recordings/ 目录
# 文件名格式：YYYY-MM-DD_HH-MM-SS.spec.ts
```

### 调试测试

```bash
# 调试特定测试
npx playwright test tests/e2e/login.spec.ts --debug

# 在 UI 模式下调试
npx playwright test tests/e2e/login.spec.ts --ui

# 使用 trace viewer 运行
npx playwright test --trace on
```

### 优化测试脚本

```bash
# 自动化流程（推荐）
npm run auto-test

# 分析测试脚本
npm run analyze-test tests/raw-recordings/2026-03-06_11-27-50.spec.ts

# 自动优化测试脚本
npm run optimize tests/raw-recordings/2026-03-06_11-27-50.spec.ts

# 生成 POM 类
npm run generate-pom tests/raw-recordings/2026-03-06_11-27-50.spec.ts

# 对比截图
npm run compare-screenshots
```

### 生成测试用例

```bash
# 从 AI 提示生成测试
npx playwright test --ai

# 使用 AI agents 生成测试
npm run init-agents
```

## 项目结构

```
tests/
├── e2e/                    # 端到端测试
├── ai-generated/            # AI 生成的测试
├── raw-recordings/         # 录制的测试脚本
├── optimized/              # 优化后的测试脚本
└── pom/                   # POM 测试脚本和页面类

src/
├── pages/                  # 页面对象模型
├── fixtures/               # 自定义 fixtures
└── setup/                  # 测试设置脚本

scripts/
├── record.ts               # 录制脚本（TypeScript）
├── optimize-recorded-test.ts  # 测试优化工具
├── generate-pom.ts         # POM 生成工具
├── compare-screenshots.ts   # 截图对比工具
└── analyze-test.ts         # 测试分析工具

results/
└── screenshot-comparison.html  # 截图对比报告

screenshots/
├── optimized/              # 优化测试的截图
└── pom/                   # POM 测试的截图
```

## 最佳实践

1. **使用语义化定位符**：优先使用 `getByRole()` 和 `getByLabel()` 而非 CSS 选择器
2. **页面对象模型**：将页面逻辑封装在可重用的页面类中
3. **存储状态**：使用 storageState 进行身份验证以避免重复登录
4. **适当的断言**：使用 Playwright 的 expect API 进行可靠的断言
5. **等待策略**：使用适当的等待方法（waitForLoadState, waitForTimeout）
6. **TypeScript 优先**：所有脚本使用 TypeScript 以获得类型安全

## 常用命令

```bash
# 安装依赖
npm install

# 安装 Playwright 浏览器
npx playwright install

# 运行测试
npm test

# 使用 run-tests.sh 运行测试
./run-tests.sh -p chromium -f tests/e2e/example.spec.ts

# 查看测试报告
npm run report

# 录制测试
npm run record

# 优化测试
npm run optimize tests/raw-recordings/test.spec.ts

# 生成 POM
npm run generate-pom tests/raw-recordings/test.spec.ts

# 对比截图
npm run compare-screenshots tests/optimized/test.optimized.spec.ts
```

## 故障排除

### 测试失败
- 检查 storageState 文件是否存在且有效
- 验证定位符是否匹配当前页面结构
- 确保使用了适当的等待条件
- 检查浏览器兼容性
- 查看 TROUBLESHOOTING.md 获取详细解决方案

### 录制问题
- 确保登录状态正确加载
- 验证 baseURL 对环境是否正确
- 检查目标目录是否存在

### 调试模式
- 使用 `--debug` 标志进行逐步执行
- 使用 `--ui` 标志进行可视化调试
- 检查 trace 文件以获取详细执行流程

### 元素定位问题
- 使用语义化定位符（getByRole, getByLabel）
- 添加适当的等待（waitForLoadState, waitForTimeout）
- 处理元素被覆盖的情况（使用 force: true）
- 使用 .nth(0) 替代 .first() 以确保兼容性

### 截图对比
- 确保截图目录存在
- 检查图片尺寸是否一致
- 使用重叠区域处理不同尺寸的图片
