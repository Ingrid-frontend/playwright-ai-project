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

## 工作模式（侧栏顶部）

| 模式 | 流程 | 说明 |
|------|------|------|
| **新建用例** | 新建流程 1→4 步 | 录制 → 优化/生成用例 → 执行（草稿）→ 保存与报告 |
| **运行用例** | 运行流程 1→3 步 | 在「测试用例」区选 **单个** 或 **批量** → 执行 → 截图对比报告 |

- 模式选择写入 `sessionStorage`（`pw_studio_workflow_mode`），运行子模式为 `pw_studio_run_sub_mode`。
- **运行 · 单个**：下拉选择 optimized，可载入编辑器或**删除所选用例**；执行所选文件。
- **运行 · 批量**：多选列表，支持搜索筛选、**删除所选**，可选「遇错停止」；顺序执行 `repo:batch-test`；步骤 2 展示进度与结果表。
- **删除用例**：仅允许删除 `tests/optimized/` 下正式 `*.optimized.spec.ts`（不含草稿 `studio-unsaved-draft`），删除后不可恢复。
- 编辑器 Tab 选择会记住（`pw_studio_editor_tab`）；切换工作模式前会确认是否保留编辑器内容。

---

## 界面布局

三栏布局：**侧栏**（环境、工作模式、执行设置、流程步骤）| **编辑器**（录制 / 优化 / Diff）| **控制台**（日志、报告中心）。

顶栏显示 WebSocket 状态、当前环境、全局任务（录制/优化/执行中）及 **状态条**（仓库连接、草稿、登录态）。

### 执行设置（作用域）

| 区域 | 新建用例 | 运行用例 |
|------|----------|----------|
| 运行模式四选一 | 步骤 3「执行（含截图）」；优化脚本 Tab 中栏执行为项目内 test | 步骤 2 与中栏执行 |
| 浏览器多选 | 同上（`--project`） | 同上 |
| 录制脚本 Tab 中栏 | 沙箱快速验证（**不**使用浏览器多选） | — |

浏览器选择写入 `sessionStorage`（`pw_studio_browser_projects`）。

### 报告中心（右侧「报告」面板）

- **运行统计**：沙箱或执行后的统计卡片（原「生成报告」）。
- **截图对比**：前置条件 checklist + 生成 `compare-screenshots` HTML。
- **执行历史**：最近 10 次执行记录（`pw_studio_run_history`）。

### 项目内能力（主仓库）

当本目录位于某 Playwright 仓库内（或设置 `PLAYWRIGHT_REPO_ROOT` 指向该仓库根目录，且根目录存在 `playwright.config.ts`）时可用：

#### 推荐操作流程

1. **录制**（「手动录制」Tab 或粘贴脚本）→ 中间编辑区出现「录制脚本」。
2. **生成用例**（无需先保存）：将当前录制脚本写入草稿文件，并在仓库根执行 `npm run pipeline-raw-to-optimized`。
3. **执行（含截图）**：从下拉框选择 `tests/optimized/.../*.optimized.spec.ts`，按侧栏「执行设置」运行；可多次调试。
4. **保存到项目**：确认录制脚本与「优化脚本」Tab 内容无误后，一次性落盘正式录制文件与优化用例。
5. **生成并打开截图对比报告**：仅当第 4 步已完成，且编辑器内容与磁盘文件一致时可点击。

#### 能力说明

- **生成用例（草稿 + pipeline）**
  - 点击时发送当前「录制脚本」全文；服务端先写入草稿，再执行 pipeline。
  - 草稿路径：`tests/raw-recordings/original/<dateCategory>/studio-unsaved-draft.spec.ts`（`<dateCategory>` 与 `npm run record` 相同，来自根目录 `config/date-categories.json`）。
  - 命名解析规则与 `resolve-recording-path.ts` 一致（可选侧栏「保存命名」中的功能名/行为描述会参与 slug）。
  - pipeline 成功后自动将首个生成的优化用例载入「优化脚本」Tab，并刷新「测试用例」下拉框。
- **保存到项目**
  - 将「录制脚本」写入正式路径：`tests/raw-recordings/original/<dateCategory>/<feature>_<YYYY-MM-DD_HH-mm-ss>.spec.ts`（禁止 `..`，仅允许 `original/` 下）。
  - 将「优化脚本」Tab 内容写入当前选中的 `tests/optimized/**/*.optimized.spec.ts`（须已生成用例或手动选择路径）。
  - 保存成功后删除草稿 `studio-unsaved-draft.spec.ts`（若存在）。
- **在项目内执行 optimized（执行流程第 3 步）**
  - 固定执行 `tests/optimized/studio-unsaved-draft.optimized.spec.ts`；执行前将「优化脚本」Tab 内容同步到该文件。
  - 使用仓库根 `playwright test`，按「执行设置」所选浏览器追加 `--project`（如 `optimized`、`optimized-webkit`，可多选）；运行模式见同区。
  - 截图由用例内 `takeStepScreenshot` 写入仓库 `screenshots/`；需已在仓库根安装依赖并完成与 `playwright.config` 一致的登录 setup。
- **测试用例（侧栏独立区域）**
  - 浏览历史 `tests/optimized` 正式用例（列表不含草稿）；**保存到项目** 时可选择写入目标路径，留空则按录制文件名自动命名。
- **生成并打开截图对比报告**
  - 在仓库根执行 `npm run compare-screenshots`；完成后由前端 **`window.open` 新开窗口**打开 `results/screenshot-comparison.html`。
  - **前置条件**：录制与优化脚本均已「保存到项目」，且中间编辑器内容与磁盘文件一致（修改后需重新保存）。
  - 若浏览器拦截弹窗，请允许本站弹出窗口或按日志中的完整 URL 手动打开。

> **与 CLI 的对应关系**：界面「生成用例」≈ 写草稿后执行 `npm run pipeline-raw-to-optimized -- tests/raw-recordings/original/<dateCategory>/studio-unsaved-draft.spec.ts`；「保存到项目」≈ 分别落盘 original 与 optimized 文件。

---

#### 界面填写 API 密钥（可选）

> 位于 **新建用例** 流程步骤 2 → 折叠区 **「AI 与优化」**。

- 侧栏 **API 密钥** 中可填写 Anthropic / DeepSeek Key；输入框默认为**密码掩码**，可勾选「显示密钥」。
- 点击 **AI 优化** 时，密钥随 WebSocket 发往本机 `server.js` 进程，**仅保存在当前连接的服务端会话内存**，不写服务端磁盘；服务端日志只打印消息类型，不打印密钥内容。
- 勾选 **加密保存到浏览器**：使用 **AES-256-GCM** 将两条密钥加密后写入 `localStorage`；解密密钥（随机 32 字节）仅存 **`sessionStorage`**。关闭整个浏览器后无法解密，需重新输入或重新勾选保存。本功能依赖 `https` 或 `localhost` 下的 Web Crypto API。

---

## 功能说明

### 新建用例流程

| 步骤 | 按钮 | 说明 |
|------|------|------|
| ① | 开始录制 | 启动 `playwright codegen`，打开浏览器录制操作 |
| ② | 停止录制 | 关闭录制浏览器，保存脚本到中间编辑区「录制脚本」 |
| ③ | AI 优化 | 在界面选择 **Claude** 或 **DeepSeek**，调用对应 API 重构脚本（选择器/断言/等待/变量） |
| ④ | 执行测试 | `playwright test` 运行脚本；侧栏 **执行设置**：运行模式四选一（**有界面** / **调试** / **UI 模式** / **无头**），浏览器可多选（**Chrome** / **Safari**）；执行中可点「取消执行」 |
| ⑤ | 生成报告 | 汇总测试结果，可下载 spec.ts 和 HTML 报告 |

### 新建用例 · 入库步骤（步骤 2 分支）

侧栏步骤 2「保存并生成用例」与中间编辑区「录制脚本 / 优化脚本」联动：

| 步骤 | 操作 | 说明 |
|------|------|------|
| ② | **生成用例** | 草稿写入 `original/.../studio-unsaved-draft.spec.ts` 后跑 pipeline；**不要求先保存** |
| ② | **保存到项目** | 正式保存录制 + 优化两份脚本；需已有优化脚本内容 |
| ③ | **执行（含截图）** | 固定执行 `studio-unsaved-draft.optimized.spec.ts`，与优化脚本 Tab 同步 |
| ③ | **生成并打开截图对比报告** | 须已完成「保存到项目」且编辑器未改未存 |
| — | **测试用例**（侧栏） | 浏览/选择正式用例路径，供「保存到项目」写入；不含草稿 |

**按钮状态（简要）**

| 按钮 | 启用条件 |
|------|----------|
| 生成用例 | 录制脚本非空，且未在生成中 |
| 保存到项目 | 录制与优化脚本均非空，且未在流水线忙碌中 |
| 执行（含截图） | 优化脚本非空（已生成用例） |
| 生成对比报告 | 双脚本已保存到项目，且与编辑器内容一致 |

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
| 2026-05-18 | **模式 3 登录态时机**：开录 load / 停录 save / 不自动清；新增「清除当前登录态」；有 storage 时开录前确认；自动登录覆盖前确认 | `public/index.html`, `server.js` |
| 2026-05-18 | 修复关闭 codegen 浏览器后录制按钮仍为「停止录制」：`record:done` 重置 UI；已退出进程不再空等 SIGTERM | `public/index.html`, `server.js` |
| 2026-05-18 | 录制脚本头部自动追加元信息注释（环境、登录账号、storageState、录制时间） | `server.js`, `repo-env.js`, `scripts/recording/record.ts`, `src/utils/recording-meta.ts` |
| 2026-05-18 | Studio 隐藏「用配置账号登录」与账号档案下拉，仅支持浏览器手动登录 | `public/index.html`, `server.js`, `repo-env.js` |
| 2026-05-18 | 录制注释「登录账号」从脚本 fill 或 storageState 自动推断（不读 accounts.json） | `src/utils/extract-login-account.cjs`, `recording-meta.ts`, `repo-env.js` |
| 2026-05-18 | 录制结束自动剥离登录步骤并注入 `test.use({ storageState })`，仅保留登录后操作 | `strip-login-from-recording.cjs`, `server.js`, `record.ts` |
| 2026-05-18 | **项目流水线**：生成用例先写草稿 `studio-unsaved-draft.spec.ts` 再 pipeline，无需先保存；「保存到项目」一次提交录制+优化；对比报告需双脚本已保存且与编辑器一致 | `public/index.html`, `server.js` |
| 2026-05-18 | **测试用例**独立侧栏区域；执行流程固定 `studio-unsaved-draft.optimized.spec.ts`；保存时从侧栏选择正式路径或自动命名 | `public/index.html`, `server.js` |
| 2026-05-18 | **顶层双模式**：新建用例 / 运行用例；运行域支持单个与批量执行（`repo:batch-test`） | `public/index.html`, `server.js` |

### 测试环境切换（界面）

与主仓库 [README 环境切换](../README.md#-环境切换dev--uat--stage9084--stage) 一致：

- 配置来源：`datasource/base-config.json`（`baseURL` + `storageState`）
- 默认环境：`stage`（可用环境变量 `PLAYWRIGHT_ENV` 覆盖服务端默认）
- 界面选择会写入浏览器 `sessionStorage`（`pw_studio_playwright_env`），刷新后保持
- **开始录制**：有登录态则 `--load-storage` 加载（界面会确认）；**不会**自动清除；换账号请先点「清除当前登录态」
- **停止录制**：在浏览器完成登录后停止，codegen `--save-storage` 写回当前 env/profile 路径（未登录就停止可能写入无效文件）
- **项目流水线**（保存 / pipeline / 执行 optimized / 对比报告）：子进程携带 `PLAYWRIGHT_ENV=<所选环境>`
- 若某环境显示虚线边框，表示 `storageState` 尚不存在；请开始录制 → 浏览器自行登录 → 停止录制后写入

### 登录态（界面 · 仅手动登录）

- Studio **不提供**「用配置账号登录」，不在界面使用 `accounts.json`
- 流程：开始录制 → codegen 浏览器自行登录 → 停止录制保存 `storageState`
- 换账号：先「清除当前登录态」，再重新录制登录
- CLI 仍可使用 `npm run login` / `accounts.json`（与 Studio 界面无关）
