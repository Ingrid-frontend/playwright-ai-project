# 🎭 Playwright Studio

一体化 Playwright 测试工具：录制 → AI 优化 → 执行 → 报告

## 快速启动

### 1. 安装依赖

```bash
cd pw-files
npm install
npx playwright install chromium
```

macOS 若 Chromium 下载失败，执行测试时会**默认使用本机 Google Chrome**（`channel: chrome`）。也可手动指定：`export PW_CHANNEL=chromium`。

执行测试默认超时（录制/优化脚本步骤较多时建议保留或加大）：

```bash
# 单用例总超时（默认 120 秒）
export PW_TEST_TIMEOUT=120000
# 页面导航超时（默认 60 秒）
export PW_NAVIGATION_TIMEOUT=60000
# 单次点击、fill、locator 等操作超时（默认 60 秒；iframe/登录框较慢时可加大）
export PW_ACTION_TIMEOUT=60000
# 浏览器语言/时区（默认 zh-CN / Asia/Shanghai，避免页面变英文导致「账号登录」等选择器找不到）
export PW_LOCALE=zh-CN
export PW_TIMEZONE=Asia/Shanghai
```

### 2. 配置环境变量

```bash
# macOS / Linux — Claude（Anthropic）
export ANTHROPIC_API_KEY=sk-ant-xxxxxx

# macOS / Linux — DeepSeek（OpenAI 兼容接口，可与 Claude 二选一或同时配置）
export DEEPSEEK_API_KEY=sk-xxxxxx
# 可选：自定义模型与接口根地址（默认模型 deepseek-chat，根地址 https://api.deepseek.com）
# export DEEPSEEK_MODEL=deepseek-v4-flash
# export DEEPSEEK_API_BASE=https://api.deepseek.com

# Windows
set ANTHROPIC_API_KEY=sk-ant-xxxxxx
set DEEPSEEK_API_KEY=sk-xxxxxx
```

### 3. 启动服务

```bash
npm start
# 或开发模式（自动重启）
npm run dev
```

### 4. 打开浏览器

访问 **http://localhost:3001**（与 `server.js` 中 `PORT` 一致；可用环境变量 `PORT` 修改）。

从仓库根也可执行：`npm run studio`。

---

## 界面布局（左侧双 Tab）

左侧边栏顶部分为两个 Tab，中间编辑区与右侧控制台共用，不随 Tab 切换。

| Tab | 用途 | 主要能力 |
|-----|------|----------|
| **手动录制** | Studio 内闭环：录制 → AI 优化 → 执行 → 报告 | **测试环境**（dev/uat/stage 等）、目标 URL、**保存命名（可选）**、操作流程按钮、四步执行管线、AI 与优化、执行设置；录制完成后自动按仓库规则建议 `original/` 保存路径 |
| **项目流水线** | 与主仓库 `playwright-ai-project` 对接 | 保存录制、运行 `pipeline-raw-to-optimized`、执行 optimized、截图对比报告 |

**Tab 行为**

- 上次选中的 Tab 写入浏览器 `sessionStorage`（键 `pw_studio_sidebar_tab`），刷新后保持。
- 在「手动录制」中点击「保存到主仓库…」链接，或执行项目流水线相关操作时，会自动切换到「项目流水线」Tab。
- 项目根未就绪（无 `playwright.config.ts`）时，会切到「项目流水线」并 Toast 提示。

### 项目流水线（主仓库）

当本目录位于某 Playwright 仓库内（或设置 `PLAYWRIGHT_REPO_ROOT` 指向该仓库根目录，且根目录存在 `playwright.config.ts`）时，在 **「项目流水线」** Tab 中可使用：

- **保存录制到项目**：将中间编辑区「录制脚本」内容写入 `tests/raw-recordings/original/<dateCategory>/`（仅允许该目录下路径，禁止 `..`）。文件名规则与 `npm run record` 一致：`<feature>_<YYYY-MM-DD_HH-mm-ss>.spec.ts`，`dateCategory` 来自根目录 `config/date-categories.json`；路径为空或为旧的 `studio-recording` 占位时，保存前会自动解析。
- **运行 pipeline**：在仓库根执行 `npm run pipeline-raw-to-optimized -- <路径>`（目标为 `original/` 下目录或 `.spec.ts`）。
- **在项目内执行 optimized**：仅允许 `tests/optimized/**/*.spec.ts`；使用仓库根 `playwright test --project=optimized`。截图由用例内 `takeStepScreenshot` 写入仓库 `screenshots/`，需已在仓库根安装依赖并完成与 `playwright.config` 一致的登录 setup。
- **生成并打开截图对比报告**：在仓库根执行 `npm run compare-screenshots`，完成后由前端 **`window.open` 新开窗口**打开同源下的 `results/screenshot-comparison.html`（服务端仅暴露只读的 `results/` 与 `screenshots/` 供报告与图片加载）。若浏览器拦截弹窗，请允许本站弹出窗口或按日志中的完整 URL 手动打开。

---

#### 界面填写 API 密钥（可选）

> 位于左侧 **「手动录制」** Tab → 折叠区 **「AI 与优化」**。

- 侧栏 **API 密钥** 中可填写 Anthropic / DeepSeek Key；输入框默认为**密码掩码**，可勾选「显示密钥」。
- 点击 **AI 优化** 时，密钥随 WebSocket 发往本机 `server.js` 进程，**仅保存在当前连接的服务端会话内存**，不写服务端磁盘；服务端日志只打印消息类型，不打印密钥内容。
- 勾选 **加密保存到浏览器**：使用 **AES-256-GCM** 将两条密钥加密后写入 `localStorage`；解密密钥（随机 32 字节）仅存 **`sessionStorage`**。关闭整个浏览器后无法解密，需重新输入或重新勾选保存。本功能依赖 `https` 或 `localhost` 下的 Web Crypto API。

---

## 功能说明

### 手动录制 Tab

| 步骤 | 按钮 | 说明 |
|------|------|------|
| ① | 开始录制 | 启动 `playwright codegen`，打开浏览器录制操作 |
| ② | 停止录制 | 关闭录制浏览器，保存脚本到中间编辑区「录制脚本」 |
| ③ | AI 优化 | 在界面选择 **Claude** 或 **DeepSeek**，调用对应 API 重构脚本（选择器/断言/等待/变量） |
| ④ | 执行测试 | `playwright test` 运行脚本；侧栏 **执行设置** 四选一：**有界面**、**调试**、**UI 模式**、**无头**；执行中可点「取消执行」 |
| ⑤ | 生成报告 | 汇总测试结果，可下载 spec.ts 和 HTML 报告 |

### 项目流水线 Tab

| 操作 | 说明 |
|------|------|
| 保存录制到项目 | 将当前录制脚本落盘到主仓库 `tests/raw-recordings/original/` |
| 运行 pipeline | 触发 `pipeline-raw-to-optimized`，生成 `tests/optimized/*.optimized.spec.ts` |
| 在项目内执行 optimized | 在主仓库 Playwright 工程中跑选定用例（可选 headed）；下拉在**连接时**即加载 `tests/optimized` 下最近 40 个 `*.optimized.spec.ts`，也可点 **刷新列表** |
| 生成并打开截图对比报告 | 执行 `compare-screenshots` 并新开窗口查看 HTML 报告 |

## 优化选项

- **AI 与优化** — 侧栏折叠区选择 Claude 或 DeepSeek，并配置密钥与优化选项；**仅使用当前选中模型对应的密钥**（两个都填也不会混用）。无可用 API 时会走**演示优化**（界面与 Toast 会标明，非真实 AI 结果）。优化进行中可点「取消优化」。
- **选择器优化** — 将 CSS/XPath 替换为 `getByRole`、`getByLabel`、`getByTestId`
- **补充断言** — 自动插入 `expect` 验证步骤
- **移除硬等待** — 删除 `waitForTimeout`，依赖 auto-waiting
- **环境变量** — 抽取 URL、账号等为 `process.env`
- **Page Object** — 封装为类结构（可选）
- **中文注释** — 关键步骤添加注释

## 目录结构

```
playwright-studio/
├── server.js          # 后端服务（WebSocket + API）
├── package.json
├── public/
│   └── index.html     # 前端界面
└── README.md
```

## 无 API Key 模式

未在环境变量与界面中提供任一可用密钥时，系统自动进入**演示模式**：
- 录制：使用内置示例脚本
- 优化：本地文本替换演示
- 执行：模拟执行流程
- 报告：基于模拟数据生成

---

## 技术栈

- **前端**: 原生 HTML/CSS/JS，无框架依赖
- **后端**: Node.js + Express + WebSocket (ws)
- **录制**: Playwright codegen
- **AI 优化**: Anthropic Claude（Messages API）或 DeepSeek（OpenAI 兼容 `/chat/completions` 流式），界面可选提供商
- **通信**: WebSocket 实时双向通信

---

## 变更记录

> **约定**：此后对 Playwright Studio（`pw-files/` 下前端、后端、脚本）的每一步功能或行为改动，均在本节追加一条，便于对照界面与实现。

| 日期 | 改动 | 涉及文件 |
|------|------|----------|
| 2026-05-18 | 左侧边栏拆为 **手动录制** / **项目流水线** 双 Tab；主仓库能力迁入「项目流水线」；Tab 状态 `sessionStorage` 持久化；流水线操作自动切 Tab | `public/index.html` |
| 2026-05-18 | 修复「选择 optimized 用例」下拉为空：连接时扫描 `tests/optimized`；pipeline 结束后回退全量列表并按保存文件名优先匹配；新增「刷新列表」 | `public/index.html`, `server.js` |
| 2026-05-18 | 手动录制保存路径对齐主仓库命名：复用 `raw-recording-naming` + `date-categories`；录制完成自动建议路径；可选功能名/行为；废弃固定 `studio-recording` | `scripts/recording/resolve-recording-path.ts`, `public/index.html`, `server.js` |
| 2026-05-18 | 界面切换测试环境（dev/uat/stage9084/stage）：读取 `datasource/base-config.json`；录制带 `--load-storage`；pipeline/项目内执行/对比报告传递 `PLAYWRIGHT_ENV` | `public/index.html`, `server.js` |
| 2026-05-18 | 修复切换环境后目标 URL 不更新：点击环境芯片即同步 baseURL；未手动改过 URL 时随环境联动 | `public/index.html` |
| 2026-05-18 | 录制结束自动保存登录态：codegen `--save-storage` 写入当前环境 `storage/loginState/*.json`；停止时 SIGTERM 优雅退出 | `server.js`, `public/index.html` |
| 2026-05-18 | **多账号档案**：侧栏账号下拉 +「用配置账号登录」；`PLAYWRIGHT_ACCOUNT` 透传 pipeline/录制；storage 按 profile 解析（`repo-env.js` 对齐 `src/utils/env-config.ts`） | `public/index.html`, `server.js`, `repo-env.js` |

### 测试环境切换（界面）

与主仓库 [README 环境切换](../README.md#-环境切换dev--uat--stage9084--stage) 一致：

- 配置来源：`datasource/base-config.json`（`baseURL` + `storageState`）
- 默认环境：`stage`（可用环境变量 `PLAYWRIGHT_ENV` 覆盖服务端默认）
- 界面选择会写入浏览器 `sessionStorage`（`pw_studio_playwright_env`），刷新后保持
- **开始录制**：使用当前环境的 `baseURL`（目标 URL 可改）；若已有 `storage/loginState/<env>.json` 则 `--load-storage` 加载；**停止录制**时 codegen 以 `--save-storage` 写回同路径（在浏览器中完成登录后停止即可生成/更新登录态）
- **项目流水线**（保存 / pipeline / 执行 optimized / 对比报告）：子进程携带 `PLAYWRIGHT_ENV=<所选环境>`
- 若某环境显示虚线边框，表示当前账号档案的 `storageState` 文件尚不存在；可在该环境下录制并在浏览器登录后停止，会自动写入；也可在侧栏点击「用配置账号登录」，或在仓库根执行 `PLAYWRIGHT_ACCOUNT=<profile> npm run login:force`

### 测试账号档案（界面）

- 配置来源：`datasource/accounts.json`（`profiles` 或旧版单账号，见仓库根 `accounts.json.example`）
- `default` 档案使用 `base-config.json` 的 `storageState`；其它档案默认 `storage/loginState/<env>/<profile>.json`
- 界面选择写入 `sessionStorage`（`pw_studio_account_profile`）；子进程携带 `PLAYWRIGHT_ACCOUNT`
- **用配置账号登录**：在仓库根执行 `login.setup.ts` 并设置 `PLAYWRIGHT_REFRESH_STORAGE=1` 强制覆盖已有登录态
