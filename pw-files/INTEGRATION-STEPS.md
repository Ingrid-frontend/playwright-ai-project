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

### 2026-05-18

1. **server.js**：`repo:pipeline` 支持 `code` 写草稿 `<feature>_<timestamp>.spec.ts`；新增 `repo:commit-artifacts` 一次保存录制 + 优化。
2. **index.html**：「生成用例」不依赖先保存；「保存到项目」；对比报告需双脚本已保存且与编辑器一致。
3. **README.md** / **INTEGRATION-STEPS.md**：更新推荐流程与验证清单。

---

## 验证清单

1. 仓库根 `npm install`，再 `cd pw-files && npm install`，`npm start`，浏览器打开 `http://localhost:3001`，侧栏项目根应显示为仓库路径且非红色告警（需存在 `playwright.config.ts`）。
2. 录制或粘贴脚本 → **生成用例**（无需先保存）→ 日志含 `[repo] 草稿已写入` 与 `[pipeline]`；`tests/raw-recordings/original/<env>/<dateCategory>/<feature>_<timestamp>.spec.ts` 出现；`tests/optimized/.../*.optimized.spec.ts` 更新；「优化脚本」Tab 自动载入内容。
3. **执行（含截图）** → 选择下拉中的用例执行；`screenshots/` 是否有新图取决于用例是否含 `takeStepScreenshot`。
4. **保存到项目** → 正式 `original/.../<feature>_<timestamp>.spec.ts` 与 optimized 文件落盘；草稿 `<feature>_<timestamp>.spec.ts` 被删除。
5. **生成并打开截图对比报告** → 仅第 4 步完成且未改编辑器时可点；新开窗口打开 `results/screenshot-comparison.html`。
