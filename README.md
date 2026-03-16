# Playwright AI 项目

这是一个使用 Playwright AI Agents 的现代化自动化测试项目，采用组件模型（Component Model）和语义化定位符（Semantic Locators）。

## 🚀 快速开始

## 前置要求（务必先看）

- Node.js **18 或更高版本**（Playwright Test 需要 18+；本项目使用 ESM：`package.json` 中 `type: "module"`）
- 已安装 Playwright 浏览器（首次需要下载）

### 1. 安装依赖

```bash
npm install
```

### 2. 初始化 Playwright 浏览器

```bash
npx playwright install
```

### 3. 初始化 AI 代理

```bash
npm run init-agents
```

这将把 Playwright AI Agents（Planner, Generator, Healer）注入到你的 IDE 中。

### 4. 配置测试账号

#### 本地开发

1. 复制示例文件：
```bash
cp datasource/accounts.json.example datasource/accounts.json
```

2. 编辑 `datasource/accounts.json`，填入真实的账号密码：
```json
{
  "stage": {
    "username": "your-account@example.com",
    "password": "your-password"
  }
}
```

#### CI/CD 环境

在 GitHub Secrets 中配置：
- `TEST_USERNAME`: 测试账号
- `TEST_PASSWORD`: 测试密码

**注意**：
- `datasource/accounts.json` 已添加到 `.gitignore`，不会被提交到 GitHub
- 环境变量优先级高于配置文件
- 如果没有配置文件或环境变量，测试将使用默认值

## 🧭 项目执行流程（一图读懂）

你在本项目里通常会走这条链路：

- **选择环境**（默认 `stage`）→
- **执行登录前置** `src/setup/login.setup.ts`（生成 `storageState`）→
- **录制**（`npm run record` 生成 `tests/raw-recordings/*.spec.ts`）→
- **回放/调试**（CLI 或 `--ui`）→
- **产出报告**（`playwright show-report`）

## 📁 项目结构

```
my-playwright-ai-project/
├── .github/workflows/       # CI/CD 配置
├── .vscode/                 # VS Code 配置
│   └── mcp.json             # MCP Agent 运行指令
├── src/
│   ├── pages/               # 页面级组合对象 (POM)
│   ├── fixtures/            # 增强型 Fixtures（登录、数据库初始化）
│   └── setup/               # 测试前置设置（登录等）
├── tests/
│   ├── ai-generated/        # 由 AI Agent 自动生成的测试脚本
│   ├── e2e/                 # 手写/精修的核心业务逻辑测试
│   ├── optimized/            # 优化后的测试脚本（来自 raw-recordings）
│   └── raw-recordings/       # 录制生成的原始测试脚本
├── .ai-prompts/             # 存放专门给 AI 的提示词模板
├── playwright.config.ts     # 核心配置文件
└── package.json
```

## 🌍 环境切换（dev / uat / stage9084 / stage）

项目通过 `NODE_ENV` 选择环境，未设置时默认 `stage`：

- **默认环境**：`stage`
- **切环境方式**：在命令前加 `NODE_ENV=xxx`

示例：

```bash
# 以 uat 环境运行（会读取 datasource/base-config.json 和 datasource/accounts.json 中的 uat 配置）
NODE_ENV=uat npx playwright test --project=chromium
```

环境配置来源：

- `datasource/base-config.json`：每个环境的 `baseURL` 与 `storageState` 路径
- `datasource/accounts.json`：每个环境的登录账号/密码

## 🎯 核心实践

### 1. 使用语义化定位符

优先使用 `getByRole()` 和 `getByLabel()` 而非 CSS/XPath：

```typescript
// ✅ 推荐：语义化定位符
this.loginButton = page.getByRole('button', { name: '登录' });

// ❌ 不推荐：CSS 选择器
this.loginButton = page.locator('.btn-login');
```

### 2. 页面对象模型 (Page Object Model)

使用语义化定位符封装页面操作：

```typescript
// 页面对象示例
export class LoginPage {
  readonly usernameInput: Locator;
  readonly loginButton: Locator;

  constructor(public readonly page: Page) {
    this.usernameInput = page.getByLabel('用户名');
    this.loginButton = page.getByRole('button', { name: '登录' });
  }

  async login(user: string, pass: string) {
    await this.usernameInput.fill(user);
    await this.loginButton.click();
  }
}
```

### 3. AI 生成测试

在 `.ai-prompts/` 目录中编写测试意图，让 AI Agent 自动生成测试代码：

```markdown
# .ai-prompts/login-test.md
测试用户登录功能，包括成功登录和失败场景。
```

### 4. 视觉回归测试

对于复杂布局，使用截图比对：

```typescript
await expect(page).toHaveScreenshot('login-page.png');
```

## 🔐 登录前置：`src/setup/login.setup.ts` 什么时候会执行？

本项目使用 **Project Dependencies**（而不是 `globalSetup`）来实现“先登录、后跑用例”。

- `playwright.config.ts` 中定义了一个 `setup` project：
  - `testDir: './src/setup'`
  - `testMatch: /.*\\.setup\\.ts/`
- 真实浏览器项目（`chromium / firefox / webkit / Mobile Chrome`）都配置了：
  - `dependencies: ['setup']`

因此：

- 运行 `--project=chromium` 时，会 **先执行一次** `[setup] login.setup.ts`，再执行你的用例
- UI 模式（`--ui`）同样遵循依赖链

另外，`login.setup.ts` 内部做了缓存判断：

- 若 `curConfig.storageState` 文件已存在且文件大小 > 10，会打印"跳过登录"并提前返回

## 🔑 StorageState 配置与使用详解

### 什么是 StorageState？

StorageState 是 Playwright 提供的一种机制，用于保存和恢复浏览器的认证状态（包括 cookies、localStorage、sessionStorage 等）。使用 StorageState 可以避免每次测试都重新登录，提高测试效率。

### 配置说明

本项目在 `playwright.config.ts` 中采用了分离式配置：

```typescript
// 全局配置中不包含 storageState
use: {
  baseURL: curConfig.baseURL,
  // storageState 在各个项目中单独配置
}

// setup 项目：不加载 storageState，而是生成它
{
  name: 'setup',
  testDir: './src/setup',
  testMatch: /.*\.setup\.ts/,
  // 不配置 storageState，避免循环依赖
}

// 测试项目：加载 storageState
{
  name: 'chromium',
  use: { 
    ...devices['Desktop Chrome'],
    storageState: curConfig.storageState  // 自动加载登录状态
  },
  dependencies: ['setup'],
}
```

### 如何生成 StorageState 文件

#### 方法 1：自动生成（推荐）

运行任何测试时，Playwright 会自动先执行 `login.setup.ts`：

```bash
# 运行 setup 项目
npx playwright test --project=setup

# 运行任何测试（会自动先执行 setup）
npx playwright test tests/e2e/login.spec.ts
```

#### 方法 2：手动重新生成

如果登录状态过期或需要重新登录：

```bash
# 删除现有文件
rm storage/loginState/stage.json

# 重新运行 setup
npx playwright test --project=setup
```

#### 方法 3：通过录制脚本生成

运行录制脚本时会自动检查并生成登录状态：

```bash
npm run record
```

### 在测试中使用 StorageState

#### 方式 1：依赖全局配置（推荐）

测试脚本无需额外配置，自动使用全局 storageState：

```typescript
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('/');
  // 页面已自动加载登录状态，直接进行业务操作
  await page.getByText('工作台').click();
});
```

#### 方式 2：在测试级别覆盖配置

如果需要为特定测试指定不同的 storageState：

```typescript
import { test, expect } from '@playwright/test';

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
  await page.goto('/');
  // 使用指定的 storageState
});
```

### StorageState 文件位置

根据环境不同，storageState 文件保存在不同位置：

- `dev`: `storage/loginState/dev.json`
- `uat`: `storage/loginState/uat.json`
- `stage9084`: `storage/loginState/stage9084.json`
- `stage`: `storage/loginState/stage.json`（默认）

### 验证 StorageState

```bash
# 查看文件是否存在
ls -la storage/loginState/

# 查看文件内容（包含 cookies 和 localStorage）
cat storage/loginState/stage.json

# 检查文件大小（有效文件应该 > 10 字节）
ls -lh storage/loginState/stage.json
```

### 常见问题

#### 1. 测试仍然停留在登录页

**原因**：storageState 文件不存在或无效

**解决方案**：
```bash
# 删除现有文件并重新生成
rm storage/loginState/stage.json
npx playwright test --project=setup
```

#### 2. setup 项目报错 "ENOENT: no such file or directory"

**原因**：setup 项目尝试加载不存在的 storageState 文件

**解决方案**：确保 `playwright.config.ts` 中 setup 项目没有配置 `storageState`，或者先创建空文件：
```bash
echo '{"cookies":[],"origins":[]}' > storage/loginState/stage.json
```

#### 3. 登录状态过期

**原因**：token 或 session 过期

**解决方案**：重新运行 setup 生成新的登录状态：
```bash
rm storage/loginState/stage.json
npx playwright test --project=setup
```

#### 4. 切换环境后仍然使用旧的 storageState

**原因**：不同环境使用不同的 storageState 文件

**解决方案**：确保使用正确的 `NODE_ENV`：
```bash
NODE_ENV=uat npx playwright test
```

### 最佳实践

1. **不要提交 storageState 文件到版本控制**：在 `.gitignore` 中已配置
2. **定期更新 storageState**：token 过期后及时重新生成
3. **使用环境隔离**：不同环境使用不同的 storageState 文件
4. **CI/CD 中自动生成**：在 CI 环境中首次运行时自动生成 storageState

## 🧪 运行测试

### 前置要求

- Node.js 18 或更高版本
- 如果使用 nvm，请先切换到 Node.js 18+：
  ```bash
  nvm use 18  # 或 nvm use 20, 22, 24
  ```

### 快速运行示例测试

```bash
# 方式 1: 使用运行脚本（推荐）
./run-tests.sh -p chromium -f tests/e2e/example.spec.ts

# 方式 2: 手动运行
npx playwright test tests/e2e/example.spec.ts --project=chromium
```

### 运行录制用例（raw-recordings）

```bash
# 运行某个录制文件（会先跑 setup，再跑录制用例）
npx playwright test tests/raw-recordings/2026-01-26T08-31-41.spec.ts --project=chromium
```

### 用 UI 模式调试（推荐）

```bash
npx playwright test tests/raw-recordings/2026-01-26T08-31-41.spec.ts --project=chromium --ui
```

如果你只想调试用例、不想跑登录依赖（跳过 setup）：

```bash
npx playwright test tests/raw-recordings/2026-01-26T08-31-41.spec.ts --project=chromium --ui --no-deps
```

### 快速确认“依赖链是否会执行到 setup”（排查用）

```bash
# 查看 setup 项目能发现哪些测试（应该能列出 src/setup/login.setup.ts）
npx playwright test --project=setup --list

# 查看 chromium + 依赖 setup 的执行清单（应该同时列出 setup 与目标用例）
npx playwright test --project=chromium --list tests/raw-recordings/2026-01-26T08-31-41.spec.ts
```

### 其他测试命令

```bash
# 运行所有测试
npm test

# 运行 AI 生成的测试
npm run test:ai

# 运行 E2E 测试
npm run test:e2e

# 以 UI 模式运行（可视化测试）
npm run test:ui

# 调试模式
npm run test:debug

# 查看测试报告
npm run report
```

## 🎥 录制流程：`npm run record` 会做什么？

`npm run record` 实际执行的是 `tsx scripts/record.ts`，流程如下：

1. 确保目录 `tests/raw-recordings/` 存在
2. 检查登录态文件 `storage/loginState/stage.json` 是否存在且有效
   - 若不存在或过小：自动执行一次登录脚本 `npx playwright test src/setup/login.setup.ts`
3. 生成带时间戳的录制文件名：`tests/raw-recordings/YYYY-MM-DD_HH-MM-SS.spec.ts`
4. 启动 Playwright Codegen，并加载登录态进行录制：

```bash
npx playwright codegen https://stage.huilianyi.com/ \
  --load-storage=storage/loginState/stage.json \
  -o tests/raw-recordings/YYYY-MM-DD_HH-MM-SS.spec.ts
```

你在浏览器里完成操作并关闭 Codegen 后，就会在 `tests/raw-recordings/` 下得到一个可回放的用例文件。

## 🛠️ 录制脚本优化指南

录制生成的测试脚本通常存在以下问题，需要优化以提高通过率和可维护性：

### 文件命名规范

录制脚本使用以下文件命名格式：

- **格式**：`YYYY-MM-DD_HH-MM-SS.spec.ts`
- **示例**：`2026-03-02_10-20-26.spec.ts`
- **说明**：
  - 使用下划线分隔日期和时间
  - 使用短横线分隔日期和时间部分
  - 避免使用冒号（:）等特殊字符

**重命名工具**：
```bash
npm run rename-recordings
```

### 常见问题

1. **混合定位符**：同时使用 `getByText`, `locator`, `getByRole`
2. **复杂 CSS 选择器**：如 `.anticon.anticon-close > svg`
3. **缺少等待和断言**：没有适当的等待和验证
4. **未使用 POM**：没有页面对象模型
5. **测试命名不清晰**：使用通用名称 "test"
6. **缺少错误处理**：没有异常处理机制

### 优化工具

本项目提供了三个优化工具：

#### 1. 分析工具 (`npm run analyze-test`)

分析录制脚本的问题并提供优化建议：

```bash
npm run analyze-test tests/raw-recordings/2026-03-02_10-20-26.spec.ts
```

**输出内容**：
- 统计信息（定位符数量、等待操作、断言数量等）
- 发现的问题（错误、警告、建议）
- 优化建议

#### 2. 自动优化工具 (`npm run optimize`)

自动优化录制的测试脚本：

```bash
npm run optimize tests/raw-recordings/2026-03-02_10-20-26.spec.ts
```

**优化内容**：
- 添加适当的等待（`waitForLoadState`, `waitForTimeout`）
- 添加断言验证
- 改进测试命名
- 优化定位符（CSS → 语义化）
- 添加页面截图功能（每个操作前后自动截图）
- 添加注释说明

**输出文件**：`tests/optimized/2026-03-02_10-20-26.optimized.spec.ts`

**截图功能**：
- 页面加载完成后自动截图
- 每个关键操作（点击、填写、勾选等）前后都会截图
- 截图保存到 `screenshots/{脚本名称}/` 目录，按脚本名称区分
- 每次执行测试都会创建新的时间戳子目录，便于对比不同执行的结果
- 截图文件名格式：`step-{编号}-{before/after}-{元素名称}.png`
- 时间戳格式：`YYYY-MM-DD_HH-MM-SS`（例如：2026-03-04_08-34-03），每次执行自动生成
- 增加等待时间到 800ms，确保页面加载完成后再截图
- 支持的操作类型：click、check、fill、type、selectOption、press、dblclick、hover

**截图目录结构示例**：
```
screenshots/
├── optimized/
│   └── 2026_03_02_10_20_26/
│       ├── 2026-03-04_08-34-03/
│       │   ├── step-1-home.png
│       │   ├── step-2-before-anticon-anticon-close.png
│       │   ├── step-3-after-anticon-anticon-close.png
│       │   └── ...
│       ├── 2026-03-04_09-15-22/
│       │   ├── step-1-home.png
│       │   ├── step-2-before-anticon-anticon-close.png
│       │   └── ...
│       └── 2026-03-04_10-30-45/
│           └── ...
└── pom/
    └── 2026_03_02_10_20_26/
        ├── 2026-03-04_08-34-09/
        │   ├── step-1-home.png
        │   ├── step-2-before-点击报销单.png
        │   ├── step-3-after-点击报销单.png
        │   └── ...
        ├── 2026-03-04_09-15-28/
        │   ├── step-1-home.png
        │   └── ...
        └── 2026-03-04_10-30-52/
            └── ...
```

**说明**：
- `optimized/` 目录：存放 .optimized 脚本生成的截图
- `pom/` 目录：存放 .pom 脚本生成的截图
- `2026_03_02_10_20_26` 是脚本名称（从文件名提取）
- `2026-03-04_08-34-03` 是执行时间戳（每次执行自动生成）
- 多次执行同一脚本会创建多个时间戳子目录，便于对比

#### 3. POM 生成器 (`npm run generate-pom`)

根据录制脚本自动生成页面对象模型：

```bash
npm run generate-pom tests/raw-recordings/2026-03-02_10-20-26.spec.ts
```

**生成内容**：
- 页面对象类（`src/pages/XXXPage.ts`）
- 优化的测试文件（`tests/optimized/2026-03-02_10-20-26.pom.spec.ts`）
- 自动截图功能（与优化工具相同的截图策略）

**截图功能**：
- POM 版本同样支持自动截图
- 截图保存到 `screenshots/pom/{脚本名称}/` 目录
- 截图文件名格式：`step-{编号}-{before/after}-{操作名称}.png`
- 每个操作前后都会截图，便于调试

#### 4. 截图对比工具 (`npm run compare-screenshots`)

对比 POM 版本和 Optimized 版本的截图差异：

```bash
npm run compare-screenshots
```

**生成内容**：
- HTML 格式的对比报告（`results/screenshot-comparison.html`）
- 可视化展示所有截图
- 按步骤分组对比
- 支持点击放大查看

**功能特点**：
- 📊 统计信息：总步骤数、截图数量、执行次数
- 📸 截图展示：网格布局展示所有截图
- 🔍 放大预览：点击截图可放大查看
- 📱 响应式设计：支持各种屏幕尺寸
- 🎨 美观界面：渐变色头部、卡片式布局
- 🔄 Tab 切换：POM 版本和 Optimized 版本独立展示
- 📐 紧凑布局：优化展示空间，同屏显示更多截图

**报告结构**：
```
┌─────────────────────────────────────┐
│  📸 截图对比报告              │
│  POM 版本 vs Optimized 版本    │
├─────────────────────────────────────┤
│  统计卡片（4个）              │
│  - 总步骤数                    │
│  - POM 截图数                 │
│  - Optimized 截图数            │
│  - 执行次数                    │
├─────────────────────────────────────┤
│  [POM 版本] [Optimized 版本]      │
│  (Tab 切换)                     │
├─────────────────────────────────────┤
│  POM 版本 Tab 内容：             │
│  步骤 1: home                 │
│  └─ [截图网格]                 │
│  步骤 2: 点击报销单              │
│  └─ [截图网格]                 │
├─────────────────────────────────────┤
│  Optimized 版本 Tab 内容：        │
│  步骤 1: home                 │
│  └─ [截图网格]                 │
│  步骤 2: 点击报销单              │
│  └─ [截图网格]                 │
└─────────────────────────────────────┘
```

### 优化前后对比

#### 优化前（录制生成）

```typescript
import { test, expect } from '@playwright/test';

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
  await page.goto('https://stage.huilianyi.com/main/home');
  await page.getByText('报销单').click();
  await page.locator('.anticon.anticon-close > svg').click();
  await page.getByRole('cell', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: '账本费用' }).click();
  await page.locator('.ant-table-row.chooser-table-row > .ant-table-selection-column > span > .ant-checkbox-wrapper > .ant-checkbox > .ant-checkbox-input').check();
  await page.getByRole('button', { name: '取 消' }).click();
  await page.getByRole('button', { name: '返 回' }).click();
});
```

#### 优化后（自动优化）

```typescript
import { test, expect } from '@playwright/test';

/**
 * 优化的录制测试脚本
 * - 添加了适当的等待
 * - 添加了断言验证
 * - 改进了测试命名
 */

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('应该能够访问首页', async ({ page }) => {
  await page.goto('https://stage.huilianyi.com/main/home');
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/.*huilianyi.*/);
  await page.getByText('报销单').click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /关闭|close/i }).click();
  await page.waitForTimeout(500);
  await page.getByRole('cell', { name: '1', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '账本费用' }).click();
  await page.waitForTimeout(500);
  await page.getByRole("checkbox").first().check();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '取 消' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '返 回' }).click();
});
```

#### 使用 POM（最佳实践）

```typescript
import { test, expect } from '@playwright/test';
import { HomePage } from 'HomePage';

test.describe('首页功能测试', () => {
  test('应该能够执行报销单操作', async ({ page }) => {
    const homePage = new HomePage(page);
    
    await homePage.navigateTo();
    await expect(page).toHaveURL(/.*huilianyi.*/);
    
    await homePage.openReimbursement();
    await homePage.closeDialog();
    await homePage.selectDate('1');
    await homePage.selectExpenseType();
    await homePage.selectExpenseItem();
    await homePage.cancelSelection();
    await homePage.goBack();
  });
});
```

### 优化工作流

#### 自动化流程（推荐）

一键完成录制、优化、执行和对比：

```bash
npm run auto-test
```

这个命令会自动执行以下步骤：
1. 🎬 录制测试脚本
2. ⚙️ 优化测试脚本
3. ▶️ 执行优化后的测试
4. 📊 生成截图对比报告

**输出文件**：
- 录制文件：`tests/raw-recordings/YYYY-MM-DD_HH-MM-SS.spec.ts`
- 优化文件：`tests/optimized/YYYY-MM-DD_HH-MM-SS.optimized.spec.ts`
- 对比报告：`results/screenshot-comparison.html`

#### 手动流程

如果需要手动控制每个步骤：

```bash
# 1. 录制测试
npm run record

# 2. 分析录制脚本
npm run analyze-test tests/raw-recordings/2026-03-02_10-20-26.spec.ts

# 3. 自动优化脚本
npm run optimize tests/raw-recordings/2026-03-02_10-20-26.spec.ts

# 4. 生成 POM（可选，推荐）
npm run generate-pom tests/raw-recordings/2026-03-02_10-20-26.spec.ts

# 5. 运行优化后的测试
npx playwright test tests/optimized/2026-03-02_10-20-26.optimized.spec.ts --project=chromium --ui

# 6. 生成截图对比报告
npm run compare-screenshots
```

### 最佳实践

1. **优先使用语义化定位符**：`getByRole()`, `getByText()`, `getByLabel()`
2. **使用页面对象模型**：封装页面逻辑，提高可维护性
3. **添加适当的等待**：`waitForLoadState()`, `waitForSelector()`
4. **添加断言验证**：确保测试结果正确
5. **使用描述性测试名称**：清晰表达测试意图
6. **添加错误处理**：使用 try-catch 处理异常

### 手动优化建议

如果自动优化工具无法满足需求，可以手动优化：

1. **优化定位符**
   ```typescript
   // ❌ 不推荐
   await page.locator('.anticon.anticon-close > svg').click();
   
   // ✅ 推荐
   await page.getByRole('button', { name: '关闭' }).click();
   ```

2. **添加等待**
   ```typescript
   // ❌ 不推荐
   await page.goto('https://example.com');
   await page.getByText('内容').click();
   
   // ✅ 推荐
   await page.goto('https://example.com');
   await page.waitForLoadState('networkidle');
   await page.getByText('内容').click();
   ```

3. **添加断言**
   ```typescript
   // ❌ 不推荐
   await page.goto('https://example.com');
   
   // ✅ 推荐
   await page.goto('https://example.com');
   await expect(page).toHaveURL(/.*example.*/);
   ```

4. **使用 POM**
   ```typescript
   // ❌ 不推荐
   test('test', async ({ page }) => {
     await page.goto('https://example.com');
     await page.getByText('登录').click();
     await page.getByLabel('用户名').fill('user');
     await page.getByLabel('密码').fill('pass');
     await page.getByRole('button', { name: '登录' }).click();
   });
   
   // ✅ 推荐
   test('应该能够成功登录', async ({ loginPage }) => {
     await loginPage.goto();
     await loginPage.login('user', 'pass');
     await loginPage.expectLoginSuccess();
   });
   ```

## 🤖 AI Agents

### Planner Agent
自动探索 Web 应用并生成测试计划。

### Generator Agent
根据测试意图生成测试代码。

### Healer Agent
自动修复失效的定位符和测试用例。

## 📊 CI/CD

GitHub Actions 已配置，包含：

### 1. 自动测试（Push/PR）
- 自动运行测试
- AI 失败分析
- PR 评论自动生成

### 2. 定时测试（Scheduled）
- 每天凌晨 2 点自动执行（UTC 时间）
- 支持手动触发
- 自动生成截图对比报告
- 上传测试结果和截图
- 发送执行通知

**配置文件**：`.github/workflows/scheduled-tests.yml`

**使用方法**：
1. **定时执行**：每天凌晨 2 点自动运行
2. **手动触发**：在 GitHub Actions 页面点击 "Run workflow"
3. **查看结果**：在 Actions 页面查看执行记录和下载 Artifacts

**Artifacts**：
- `playwright-results`：测试报告（保留 30 天）
- `screenshots`：测试截图（保留 7 天）
- `screenshot-comparison`：截图对比报告（保留 30 天）
- `screenshot-diffs`：差异图（保留 7 天）

**环境变量**：
在 GitHub Secrets 中配置：
- `BASE_URL`：测试环境 URL（可选，默认 http://localhost:3000）
- `TEST_USERNAME`：测试账号（可选）
- `TEST_PASSWORD`：测试密码（可选）

**注意**：
- 定时测试使用 UTC 时间，北京时间是 10:00
- 单次执行限制 6 小时
- 月度免费额度 2000 分钟

## 📚 最佳实践

1. **Shift-Left 测试**：将 AI 生成的测试计划直接发给开发看
2. **视觉回归为主**：对于多表格、复杂布局，使用截图比对
3. **使用 Cursor IDE**：目前对 Playwright + AI 支持最好的编辑器

## 🔗 相关资源

- [Playwright 文档](https://playwright.dev)
- [Playwright AI Agents](https://playwright.dev/docs/ai-agents)
- [语义化定位符](https://playwright.dev/docs/locators#locating-by-role)
