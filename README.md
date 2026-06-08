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

2. 编辑 `datasource/accounts.json`，填入真实的账号密码（支持单账号或 `profiles` 多档案，见 `accounts.json.example`）：
```json
{
  "stage": {
    "defaultProfile": "default",
    "profiles": {
      "default": {
        "label": "默认账号",
        "username": "your-account@example.com",
        "password": "your-password"
      }
    }
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
- 如果没有配置文件或环境变量，相关测试会报错提示缺少凭据

## 🧭 项目执行流程（一图读懂）

你在本项目里通常会走这条链路：

- **选择环境**（默认 `stage`）→
- **执行登录前置** `src/setup/login.setup.ts`（生成 `storageState`）→
- **录制**（`npm run record` 生成 `tests/raw-recordings/*.spec.ts`）→
- **回放/调试**（CLI 或 `--ui`）→
- **产出报告**（`playwright show-report`）

**图形界面（可选）**：仓库根执行 `npm run studio`，在 Playwright Studio 中选择 **新建用例** 或 **运行用例** 模式，完成录制 → 生成用例 → 执行 → 报告。操作说明见 [pw-files/README.md](pw-files/README.md#工作模式侧栏顶部)。

若目标是 **发现 UI 视觉回归**（而不仅是功能通过），请走下方 [UI 回归流程](#-ui-回归流程录制--截图对比--发现-ui-问题)：`录制 → 优化 → 双浏览器执行 → 截图对比 → 问题清单 / Golden 基线`。

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
│   ├── ai-generated/        # Legacy：旧 AI 生成用例，新用例请用 raw-recordings
│   ├── e2e/                 # 手写/精修的核心业务逻辑测试
│   ├── optimized/           # 优化后的可执行用例（主执行目录）
│   └── raw-recordings/      # 录制原始脚本（Codegen / Studio 写入）
├── config/
│   └── ui-regression.json   # UI 回归阈值、mask、基线策略
├── screenshots/             # 每次运行的步骤截图
├── screenshots-baseline/    # Golden 基线截图（promote 后）
├── results/
│   ├── screenshot-comparison.html
│   ├── ui-issues.json       # 结构化 UI 问题清单
│   └── ui-regression/       # baseline manifest、last-green 元数据
├── .ai-prompts/             # 存放专门给 AI 的提示词模板
├── playwright.config.ts     # 核心配置文件
└── package.json
```

## 🌍 环境切换（dev / uat / stage9084 / stage）

项目通过 `PLAYWRIGHT_ENV` 选择环境，未设置时默认 `stage`：

- **默认环境**：`stage`
- **切环境方式**：使用 `PLAYWRIGHT_ENV=xxx`

示例：

```bash
# 以 uat 环境运行（会读取 datasource/base-config.json 和 datasource/accounts.json 中的 uat 配置）
PLAYWRIGHT_ENV=uat npx playwright test --project=optimized
```

环境配置来源：

- `datasource/base-config.json`：每个环境的 `baseURL` 与 `storageState` 路径
- `datasource/accounts.json`：每个环境的登录账号/密码（或 `profiles` 多档案）

### 换测试账号（三步）

1. 在 `datasource/accounts.json` 为目标环境配置 `profiles`（或使用旧版单 `username`/`password`，等价于 `default` 档案）。
2. 选择档案并**强制重新登录**（已有 `storageState` 文件时不会自动换账号）：
   ```bash
   # 默认档案
   npm run login:force

   # 指定档案（如 admin）
   PLAYWRIGHT_ACCOUNT=admin npm run login:force
   ```
3. 运行测试或录制时带上相同环境变量：
   ```bash
   PLAYWRIGHT_ENV=stage PLAYWRIGHT_ACCOUNT=admin npm run record
   ```

说明：

- `default` 档案沿用 `base-config.json` 中的 `storageState`（如 `storage/loginState/stage.json`）。
- 其它档案默认写入 `storage/loginState/stage/<profile>.json`，也可在 `base-config.json` 用 `storageStates` 自定义路径。
- Playwright Studio（`npm run studio`，详见 [pw-files/README.md](pw-files/README.md)）：**新建用例 / 运行用例** 双模式；界面**不提供**「用配置账号登录」，请在 codegen 浏览器中手动登录，停止录制后写入 `storageState`。支持草稿生成用例、多浏览器执行、批量运行与报告中心。

## ⚙️ 常用开关（环境变量速查）

默认策略：**不开启就不生效**（避免噪声/泄露/卡住执行）。需要时按表格开启即可。

| 开关 | 默认 | 用途 | 如何开启 |
|---|---|---|---|
| `ENABLE_PAUSE` | 0 | 允许 optimized 用例在异常点 `page.pause()` | `ENABLE_PAUSE=1` |
| `SCREENSHOT_MODE` | fast | 截图模式：`fast`(直接截图) / `stable`(更稳) | `SCREENSHOT_MODE=stable` |
| `ENABLE_LIST_REPORTER` | 0 | 控制 Playwright `list` reporter，减少控制台噪声 | `ENABLE_LIST_REPORTER=1` |
| `ENABLE_SENSITIVE_LOGS` | 0 | 允许输出签名串、请求体等敏感调试信息 | `ENABLE_SENSITIVE_LOGS=1` |
| `ENABLE_GITHUB` | 0 | 允许生成 GitHub/Pages 相关链接（飞书卡片按钮等） | `ENABLE_GITHUB=1` |
| `PUBLIC_REPORT_URL` | - | 公开报告 URL（配合 `ENABLE_GITHUB=1`） | `ENABLE_GITHUB=1 PUBLIC_REPORT_URL=...` |
| `PUBLIC_ASSET_BASE_URL` | - | 公开静态资源基址（图片/截图 URL，配合 `ENABLE_GITHUB=1`） | `ENABLE_GITHUB=1 PUBLIC_ASSET_BASE_URL=...` |
| `ENABLE_POM` | 0 | 启用 POM 生成相关能力（默认关闭，避免误用） | `ENABLE_POM=1` |
| `ENABLE_GLOBAL_SETUP` | 0 | 回退启用 `globalSetup`（默认走 project dependencies） | `ENABLE_GLOBAL_SETUP=1` |
| `ENABLE_LEGACY_LOGIN_FIXTURE` | 0 | 回退到“每个用例内登录”（需要 `TEST_USERNAME/TEST_PASSWORD`） | `ENABLE_LEGACY_LOGIN_FIXTURE=1` |
| `PLAYWRIGHT_ACCOUNT` | default | 账号档案 ID（对应 `accounts.json` 的 `profiles`） | `PLAYWRIGHT_ACCOUNT=admin` |
| `PLAYWRIGHT_REFRESH_STORAGE` | 0 | 强制重新登录并覆盖已有 `storageState` | `PLAYWRIGHT_REFRESH_STORAGE=1` 或 `npm run login:force` |

飞书相关（如需通知/文档）：

- **Webhook**：`FEISHU_WEBHOOK_URL`（可选 `FEISHU_WEBHOOK_SECRET`）
- **建议**：默认不要打开 `ENABLE_SENSITIVE_LOGS`，只有在排查签名/请求体问题时临时开启。

## ✅ 代码质量（lint / fix / typecheck）

```bash
# 只检查（不自动改文件）
npm run lint

# 自动修复（显式执行）
npm run lint:fix

# 类型检查
npm run typecheck
```

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

- 运行 `--project=optimized` 时，会 **先执行一次** `[setup] login.setup.ts`，再执行你的用例
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

**解决方案**：确保使用正确的 `PLAYWRIGHT_ENV`：
```bash
PLAYWRIGHT_ENV=uat npx playwright test
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
# 手动运行（以 project=optimized 为准）
npx playwright test tests/e2e/example.spec.ts --project=optimized
```

### 运行录制用例（raw-recordings）

```bash
# 运行某个录制文件（会先跑 setup，再跑录制用例）
npx playwright test tests/raw-recordings/2026-01-26T08-31-41.spec.ts --project=optimized
```

### 用 UI 模式调试（推荐）

```bash
npx playwright test tests/raw-recordings/2026-01-26T08-31-41.spec.ts --project=optimized --ui
```

如果你只想调试用例、不想跑登录依赖（跳过 setup）：

```bash
npx playwright test tests/raw-recordings/2026-01-26T08-31-41.spec.ts --project=optimized --ui --no-deps
```

### 快速确认“依赖链是否会执行到 setup”（排查用）

```bash
# 查看 setup 项目能发现哪些测试（应该能列出 src/setup/login.setup.ts）
npx playwright test --project=setup --list

# 查看 optimized + 依赖 setup 的执行清单（应该同时列出 setup 与目标用例）
npx playwright test --project=optimized --list tests/raw-recordings/2026-01-26T08-31-41.spec.ts
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

`npm run record` 实际执行的是 `tsx scripts/recording/record.ts`，流程如下：

1. 确保目录 `tests/raw-recordings/` 存在
2. 检查登录态文件 `storage/loginState/stage.json` 是否存在且有效
   - 若不存在或过小：自动执行一次登录脚本 `npx playwright test src/setup/login.setup.ts`
3. 生成带时间戳的录制文件名：`tests/raw-recordings/YYYY-MM-DD_HH-MM-SS.spec.ts`
4. 启动 Playwright Codegen，并加载登录态进行录制：

```bash
# URL 使用当前环境的 baseURL（由 datasource/base-config.json 决定）
npx playwright codegen <baseURL> \
  --load-storage=storage/loginState/stage.json \
  -o tests/raw-recordings/YYYY-MM-DD_HH-MM-SS.spec.ts
```

说明：
- `npm run record` 会使用当前环境（`PLAYWRIGHT_ENV`）对应的 `datasource/base-config.json` 中的 `baseURL` 作为 codegen 入口
- 因此示例中的 URL 可以理解为“当前环境的 baseURL”

你在浏览器里完成操作并关闭 Codegen 后，就会在 `tests/raw-recordings/` 下得到一个可回放的用例文件。

## 📝 快速生成录制脚本：`npm run generate-raw-recording`

除了使用浏览器录制，你还可以通过代码快速生成录制脚本。这个功能特别适合：

1. **快速创建测试模板**：基于现有代码生成测试文件
2. **代码片段转换**：将手动编写的测试代码转换为完整测试文件
3. **批量生成**：从文件或命令行参数生成多个测试脚本

### 使用方法

#### 方法1：从文件生成
```bash
# 从文本文件生成录制脚本
npm run generate-raw-recording -- --file path/to/code.txt --name "测试名称"

# 示例
npm run generate-raw-recording -- --file my-test-code.txt --name "登录测试"
```

#### 方法2：从命令行参数生成
```bash
# 直接提供代码片段
npm run generate-raw-recording -- --code "await page.getByText('按钮').click();"

# 多行代码
npm run generate-raw-recording -- --code "await page.goto('https://example.com');
await page.getByText('登录').click();
await page.fill('#username', 'testuser');"
```

#### 方法3：交互式输入
```bash
# 不提供参数，进入交互模式
npm run generate-raw-recording
```

### 命名规则

生成的文件使用以下命名格式：
- **格式**：`[内容摘要]_[时间戳].spec.ts`
- **示例**：`click-登录按钮_2026-03-19_10-30-45.spec.ts`

脚本会自动从代码中提取关键信息：
- `page.goto()` → `goto-[域名]`
- `page.getByText('文本')` → `click-[文本]`
- `page.getByRole('button')` → `role-button`

### 生成的文件结构

生成的测试文件包含完整的Playwright测试结构：
```typescript
import { test, expect } from '@playwright/test';

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
  // 你的代码在这里
  await page.getByText('按钮').click();
});
```

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

## 📸 UI 回归流程（录制 → 截图对比 → 发现 UI 问题）

本项目的 **UI 回归** 能力：在功能测试通过的基础上，用步骤截图 + 像素对比找出页面视觉变化，并输出可分级、可阻断 CI 的问题清单。

更细的命令表与配置说明见：[docs/ui-regression-workflow.md](docs/ui-regression-workflow.md)。

### 流程总览

```
登录 (storageState)
    ↓
录制 → tests/raw-recordings/*.spec.ts
    ↓
优化 → tests/optimized/**/*.optimized.spec.ts
    ↓
执行 (Chromium + WebKit) → screenshots/<迭代>/<脚本>/run-*-optimized/<timestamp>/step-*.png
    ↓
对比 → results/screenshot-comparison.html + results/ui-issues.json
    ↓
[可选] Promote Golden → screenshots-baseline/...
    ↓
[CI] compare-screenshots --gate → blocker 时失败
```

### 推荐：一键全流程（本地）

```bash
# 录制 → 优化 → 执行（optimized + webkit）→ 截图对比
npm run auto-test

# 指定某条 raw 录制（不只用「最新一条」）
npm run auto-test -- --spec tests/raw-recordings/2026-05-18/我的用例.spec.ts

# 批量：raw-recordings 下全部用例
npm run auto-test -- --batch

# 对比存在 blocker 时整个流程失败（与 CI 一致）
npm run auto-test -- --gate
```

**产出**：

| 文件 | 说明 |
|------|------|
| `tests/raw-recordings/...` | 原始录制 |
| `tests/optimized/.../*.optimized.spec.ts` | 可执行优化用例 |
| `screenshots/<迭代>/<脚本>/run-chromium-optimized/` 或 `run-webkit-optimized/<时间戳>/` | 每步 PNG |
| `results/screenshot-comparison.html` | 可视化对比报告（含「问题列表」Tab） |
| `results/ui-issues.json` | 结构化问题：脚本、步骤、浏览器、严重度、compareKind |
| `results/history/<日期>.json` | 按日聚合的差异趋势 |

CI 环境下 `auto-test` 会跳过录制，使用仓库内已有用例与截图（见 `.github/workflows/playwright.yml`）。

### 推荐：分步手动执行

```bash
# 0. 登录（首次或 storage 过期）
npm run login

# 1. 录制
npm run record

# 2. 优化（单文件 / 目录 / 默认整库 raw-recordings）
npm run optimize-raw-recordings -- tests/raw-recordings/你的用例.spec.ts

# 3. 执行并截图（建议双浏览器，便于跨浏览器对比）
npx playwright test tests/optimized/你的路径/xxx.optimized.spec.ts \
  --project=optimized --project=optimized-webkit

# 4. 生成对比报告 + 问题清单
npm run compare-screenshots

# 5. 在浏览器中打开报告（也可不跑用例，只要有 screenshots/）
npm run screenshot-report
```

### Golden 基线（预期 UI）

当某次运行的 UI **确认为正确** 时，可将其提升为 Golden，后续对比优先与 Golden 比（Hybrid 策略）。

```bash
# 将某次 run 的截图复制到 screenshots-baseline/
npm run promote-baseline -- --script 260612/工作台_2026-05-18_17-00-07 --run 2026-05-21T10-46-34-813Z

# 撤销该脚本的 Golden
npm run promote-baseline -- --script 260612/工作台_2026-05-18_17-00-07 --revert
```

**Hybrid 对比优先级**（可用 `PLAYWRIGHT_COMPARE_BASELINE` 强制）：

1. **golden** — `screenshots-baseline/` 中同步骤 PNG  
2. **last-green** — 测试通过后写入的 `results/ui-regression/last-green-run.json`  
3. **oldest** — 同浏览器最早一次 run（兼容旧数据，标记为 `run-drift`）

### 问题分级与门禁

阈值在 `config/ui-regression.json`：

| 配置项 | 默认 | 含义 |
|--------|------|------|
| `blockerRatio` | `0.005` (0.5%) | 达到即 **blocker**，`--gate` 时导致失败 |
| `warningRatio` | `0.001` (0.1%) | **warning**，记入报告但不阻断（除非调高 gate 逻辑） |
| `crossBrowser.*` | 单独阈值 | Chrome vs WebKit；默认不参与 CI gate |
| `ignoreRegions` | `[]` | 对比前涂黑的固定区域，降低动态区误报 |

```bash
# 本地/CI：存在 golden/last-green/run-drift 的 blocker 时 exit 1
npm run compare-screenshots -- --gate
```

打开 `results/screenshot-comparison.html` → **「问题列表」** Tab，或查看 `results/ui-issues.json`。

### Playwright Studio

```bash
npm run studio
```

在 **报告 → 截图对比** 中可：

- **打开已有对比报告** / **从 screenshots 重新生成**（无需先跑用例）
- 填写脚本键 + run 时间戳 → **将本次 run 设为 Golden**（二次确认）
- **刷新问题列表**（读取 `ui-issues.json`）

### CI（GitHub Actions）

推送/PR 到 `main` / `develop` 时，`.github/workflows/playwright.yml` 会：

1. `npm run login`（需 Secrets：`TEST_USERNAME`、`TEST_PASSWORD`）  
2. `playwright test --project=optimized --project=optimized-webkit`  
3. `npm run compare-screenshots -- --gate`  
4. 上传 artifact：`screenshot-comparison.html`、`ui-issues.json`、`diffs/`  

可选：`FEISHU_WEBHOOK_URL` 配置后，失败时发送含 blocker 数的飞书摘要。

---

### 脚本速查（高效使用）

建议按下面的顺序使用（从录制到对比一条链路跑通即可）：

```bash
# 1) 录制（Playwright Codegen）
npm run record

# 2) 分析（看脚本质量与改进建议）
npm run analyze-test -- tests/raw-recordings/2026-03-02_10-20-26.spec.ts
```

#### 2. 优化 / POM / 对比（常用）

```bash
# 优化（统一入口：单文件 / 目录 / 不传参）
npm run optimize -- tests/raw-recordings/2026-03-02_10-20-26.spec.ts
npm run optimize -- tests/raw-recordings/
npm run optimize
```

输出：
- 优化用例：`tests/optimized/<日期目录>/*.optimized.spec.ts`

说明：
- `npm run optimize` 是统一入口；需要强制走 raw-recordings 批量管线时用 `npm run optimize-raw-recordings`。

截图输出：
- 优化脚本截图：`screenshots/optimized/`
- POM 脚本截图：`screenshots/pom/`

#### 3. POM 生成器 (`npm run generate-pom`)

根据录制脚本自动生成页面对象模型：

```bash
npm run generate-pom -- tests/raw-recordings/2026-03-02_10-20-26.spec.ts
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

**不执行用例也可打开报告**（只需 `screenshots/` 里已有 PNG，或已生成过 HTML）：

```bash
# 有 screenshots 时生成并打开；已有 results/screenshot-comparison.html 则直接打开
npm run open-screenshot-report

# 仅打开已有 HTML（不重新跑 pixelmatch）
npm run open-screenshot-report:only
```

在 Playwright Studio（`npm run studio`）中：侧栏 **「截图对比报告」** → 报告面板 **「截图对比」** → **打开已有对比报告** / **从 screenshots 重新生成并打开**。

**可选环境变量**（对比引擎与报告筛选）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PLAYWRIGHT_COMPARE_CONCURRENCY` | `4` | 并行对比任务数 |
| `PLAYWRIGHT_COMPARE_INCREMENTAL` | `1` | 源图未变时复用 `results/diffs/*.meta.json` 缓存 |
| `PLAYWRIGHT_PIXELMATCH_THRESHOLD` | `0.06` | pixelmatch 颜色阈值（越小越敏感） |
| `PLAYWRIGHT_PIXELMATCH_INCLUDE_AA` | 开启 | 设为 `0` 时不计入抗锯齿像素 |
| `PLAYWRIGHT_DIFF_ONLY_TAB_MIN_RATIO` | `0.003` | 「有差异」Tab 最低收录比例（0.3%） |
| `PLAYWRIGHT_COMPARE_CROSS_BROWSER` | `1` | Chrome(基线) vs WebKit 同步骤跨浏览器对比 |
| `PLAYWRIGHT_COMPARE_BASELINE` | hybrid | 基线策略：`golden` / `last-green` / `oldest` / `hybrid` |

**UI 回归（Golden + 问题清单）** — 详见 [docs/ui-regression-workflow.md](docs/ui-regression-workflow.md)：

```bash
npm run compare-screenshots -- --gate          # blocker 时 exit 1（CI 门禁）
npm run promote-baseline -- --script 260612/xxx --run <timestamp>
```

- 配置：`config/ui-regression.json`（阈值、mask 区域）
- Golden：`screenshots-baseline/`；Hybrid 对比：golden → last-green → 最早 run
- 输出：`results/ui-issues.json` + `results/ui-issues-analysis.md` + HTML「**分析摘要**」（合并重复行）/「问题明细」Tab
- 主录制目录：`tests/raw-recordings/`（`tests/ai-generated` 为 legacy）

**生成内容**：
- HTML 格式的对比报告（`results/screenshot-comparison.html`）
- 结构化 UI 问题清单（`results/ui-issues.json`）
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

#### 5. Chrome Recorder 优化工具 (`npm run optimize-chrome-recorder`)

专门用于优化从 Chrome Recorder 导出的 JavaScript 脚本，将其转换为稳定的 Playwright 测试：

```bash
# 优化单个文件
npm run optimize-chrome-recorder -- "tests/chrome-recorder/Recording 2026_3_18 at 14_48_15.js"

# 批量优化整个文件夹
npm run optimize-chrome-recorder -- "tests/chrome-recorder/"
```

**功能特点**：
- 🔄 自动转换：将 Chrome Recorder 导出的 JS 脚本转换为 TypeScript 测试
- 🎯 智能等待：使用 `attached` 状态等待，避免因元素不可见导致的超时
- 🛡️ 错误处理：每个操作都包含 try-catch 错误处理
- 📸 自动截图：每个操作前后自动截图，便于调试
- 🔍 跟踪支持：集成 Playwright Tracing，便于问题排查
- ⚙️ 选择器优化：自动优化不稳定的选择器（如动态类名）
- 📝 测试步骤：使用 `test.step()` 组织测试逻辑

**优化内容**：
1. **等待机制优化**
   - 使用 `waitFor({ state: 'attached' })` 替代 `visible` 状态
   - 增加等待超时时间到 15000ms
   - 操作超时设置为 30000ms

2. **选择器优化**
   - 移除 `.filter({ visible: true })` 过滤器
   - 使用 `.first()` 选择第一个匹配元素
   - 优化动态选择器（如 `li.ant-menu-item-active span` → `li.ant-menu-item span`）

3. **测试结构优化**
   - 添加 storageState 配置
   - 设置测试超时时间为 60000ms
   - 集成截图和跟踪功能
   - 使用 test.step() 组织测试步骤

**输出文件**：`tests/optimized/{原文件名}.optimized.spec.ts`

**示例**：省略（直接运行生成的 `tests/optimized/*.optimized.spec.ts`，结合 `screenshots/` 与 `trace.zip` 排查即可）

**支持的操作类型**：
- `click` - 点击操作
- `fill` - 填写表单
- `type` - 输入文本
- `check` - 勾选复选框
- `selectOption` - 选择下拉选项
- `press` - 按键操作

**注意事项**：
1. 输入文件必须是 `.js` 格式的 Chrome Recorder 导出文件
2. 输出文件名与原文件名对应，不会每次都创建新文件
3. 生成的测试文件会自动使用 storageState 进行登录
4. 截图保存在 `screenshots/{脚本名称}/` 目录下
5. Tracing 文件保存在 `{截图目录}/trace.zip`

### 优化前后对比

（示例代码已省略：对照 `tests/raw-recordings/` 与 `tests/optimized/` 的同名用例即可快速理解差异）

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

可选（飞书通知样式）：

```bash
# 纯文本通知
npm run auto-test:feishu-text

# 卡片 + 链接（并创建飞书文档）
npm run auto-test:feishu-links

# 或者自定义参数（注意 npm 透传参数需要 `--`）
npm run auto-test -- --feishu-mode=none
```

这个命令会自动执行以下步骤：
1. 🎬 录制测试脚本（CI 环境跳过，使用已有用例）
2. ⚙️ 优化测试脚本（`optimize-raw-recordings`）
3. ▶️ 执行优化后的测试（默认 `optimized` + `optimized-webkit`）
4. 📊 生成截图对比报告与 `ui-issues.json`（测试通过时记录 last-green）

**常用参数**：

```bash
npm run auto-test -- --spec tests/raw-recordings/xxx.spec.ts   # 指定录制
npm run auto-test -- --batch                                   # 批量 raw
npm run auto-test -- --gate                                    # 对比 blocker 则失败
npm run auto-test -- --playwright-project=optimized            # 仅 Chromium
npm run auto-test -- --feishu-mode=interactive               # 飞书卡片含 UI 问题摘要
```

**输出文件**：
- 录制文件：`tests/raw-recordings/.../*.spec.ts`
- 优化文件：`tests/optimized/.../*.optimized.spec.ts`
- 对比报告：`results/screenshot-comparison.html`
- UI 问题：`results/ui-issues.json`

#### 手动流程

如果需要手动控制每个步骤：

**Playwright Codegen 录制流程**：
```bash
# 1. 录制测试
npm run record

# 2. 分析录制脚本
npm run analyze-test -- tests/raw-recordings/2026-03-02_10-20-26.spec.ts

# 3. 自动优化脚本
npm run optimize -- tests/raw-recordings/2026-03-02_10-20-26.spec.ts

# 4. 生成 POM（可选，推荐）
npm run generate-pom -- tests/raw-recordings/2026-03-02_10-20-26.spec.ts

# 5. 运行优化后的测试
npx playwright test tests/optimized/2026-03-02_10-20-26.optimized.spec.ts --project=optimized --ui

# 6. 生成截图对比报告
npm run compare-screenshots
```

**Chrome Recorder 导出流程**：
```bash
# 1. 使用 Chrome Recorder 录制并导出 JS 文件到 tests/chrome-recorder/

# 2. 优化 Chrome Recorder 导出的脚本
npm run optimize-chrome-recorder -- "tests/chrome-recorder/Recording 2026_3_18 at 14_48_15.js"

# 3. 运行优化后的测试
npx playwright test tests/optimized/Recording\ 2026_3_18\ at\ 14_48_15.optimized.spec.ts --project=optimized --ui
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
