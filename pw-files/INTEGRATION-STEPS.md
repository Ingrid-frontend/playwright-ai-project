# Playwright Studio ↔ 主仓库融合 — 执行记录

> **状态**：已应用（Agent 模式）。详见下方变更日志。

## 步骤总览

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1 | [server.js](server.js) | `resolveRepoRoot`、`repoSave`、`runRepoPipeline`、`runRepoTest`、路径白名单、`makeSession` 扩展、`repo:info`、WebSocket 分支 |
| 2 | [public/index.html](public/index.html) | 侧栏「项目流水线」、`handleMessage` 分支、`busyState.repoPipeline`、`syncRepoButtons` |
| 3 | [../package.json](../package.json) | `"studio": "npm --prefix pw-files start"` |
| 4 | [README.md](README.md) | 端口 3001、主仓库流水线、`npm run studio` |

---

## 变更日志

- [x] 步骤 1 `server.js`
- [x] 步骤 2 `public/index.html`
- [x] 步骤 3 根 `package.json`
- [x] 步骤 4 `README.md`

### 2026-05-15

1. **server.js**：连接时下发 `repo:info`；新增 `repo:save` / `repo:pipeline` / `repo:test` 及取消；`cwd` 为仓库根执行 `npm run pipeline-raw-to-optimized` 与 `playwright test … --project=optimized`；路径白名单。
2. **index.html**：侧栏「项目流水线」表单与按钮；`repo:*` 与 `run:done` 中截图路径提示。
3. **package.json**：根目录 `studio` 脚本。
4. **README.md**：`cd pw-files`、端口 3001、流水线说明。

---

## 验证清单

1. 仓库根 `npm install`，再 `cd pw-files && npm install`，`npm start`，浏览器打开 `http://localhost:3001`，侧栏项目根应显示为仓库路径且非红色告警（需存在 `playwright.config.ts`）。
2. 录制或粘贴脚本 → **保存录制到项目** → 对应 `tests/raw-recordings/original/.../*.spec.ts` 出现。
3. **运行 pipeline** → 日志含 `[pipeline]`，且 `tests/optimized/.../*.optimized.spec.ts` 更新；下拉框出现候选路径。
4. **在项目内执行 optimized** → 日志含截图目录；`screenshots/` 是否有新图取决于用例是否含 `takeStepScreenshot`。
