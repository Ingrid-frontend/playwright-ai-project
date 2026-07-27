# 优化路线图

基于架构评审的落地项与后续计划。

## 已落地

| 项 | 说明 |
|----|------|
| CI Artifact 合并 | `npm run report:bundle-ci` → 单一 `full-report-*` |
| deprecated 排除 | `playwright.config.ts` `testIgnore` 含 `**/deprecated/**` |
| 截图对比降噪 | run-drift 仅比「最新 vs 上一次」；gate 不含 run-drift |
| auto-promote | 默认开启（`AUTO_PROMOTE_BASELINE=0` 关闭）；`AUTO_PROMOTE_MAX_DIFF` 阈值 |
| maskSelectors | 截图前 DOM 遮罩（`config/ui-regression.json`）；支持 `{ selector, script }` |
| ignoreRegions 按 script | 对比时仅应用匹配 script 的矩形忽略区 |
| 报告离线打包 | `report:bundle` 含 screenshots + diffs，UI 报告可离线查看 |
| 多视口截图 | `viewports` 配置 + `SCREENSHOT_VIEWPORTS=all` |
| 结构巡检 | selector 存在 / bbox 偏移 / DOM 指纹 / 横向溢出（`structureChecks`） |
| baseline PR 门禁 | `check-baseline-pr`：变更 golden 需 label `baseline-update` |
| Firefox 项目 | `optimized-firefox`（Studio / CI / test-jobs 默认可见） |
| flake 追踪 | error-reporter 标记 flake + `results/history/YYYY-MM-DD.json` |
| 统一 CLI | `npm run cli -- --help` |
| 初始化 | `npm run setup` |
| Studio 模块化 | `pw-files/lib/repo-context.js`、`ws-safe.js` + WS 错误边界 |

## 进行中 / 建议下一步

| 优先级 | 项 | 说明 |
|--------|-----|------|
| P0 | Studio 继续拆分 | `routes/`、`services/`、`session/` 从 server.js 抽离 |
| P0 | CJS → ESM | 逐步迁移 `src/utils/*.cjs` 为 `.ts` |
| P1 | selector bbox 基线 | promote 时同步 `.meta.json`；首次需重跑建立基线 |
| P2 | 三引擎默认 CI | Firefox 已纳入 `test:ci`；若不稳定可再收窄 |
| P3 | flake 仪表盘 | 基于 `results/history/` 聚合 trend |

## 环境变量速查

| 变量 | 默认 | 说明 |
|------|------|------|
| `AUTO_PROMOTE_BASELINE` | 开启 | 设 `0` 关闭自动晋升 Golden |
| `AUTO_PROMOTE_MAX_DIFF` | `0.005` | golden blocker 时允许晋升的最大 diff 比例 |
| `SCREENSHOT_VIEWPORTS` | desktop | 视口：`all` 或逗号分隔名如 `desktop,mobile` |
| `SCREENSHOT_DIAGNOSTICS` | 开启 | 设 `0` 关闭 step meta 写入 |
| `BASELINE_UPDATE_OK` | - | 设 `1` 跳过 baseline PR 门禁 |
| `PLAYWRIGHT_PIXELMATCH_INCLUDE_AA` | - | 设 `0` 降低抗锯齿噪声 |
| `CI_BUNDLE_TEST_RESULTS` | - | CI 打包时含 test-results |
