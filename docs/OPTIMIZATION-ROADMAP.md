# 优化路线图

基于架构评审的落地项与后续计划。

## 已落地

| 项 | 说明 |
|----|------|
| CI Artifact 合并 | `npm run report:bundle-ci` → 单一 `full-report-*` |
| deprecated 排除 | `playwright.config.ts` `testIgnore` 含 `**/deprecated/**` |
| 截图对比降噪 | run-drift 仅比「最新 vs 上一次」；gate 不含 run-drift |
| auto-promote | 默认开启（`AUTO_PROMOTE_BASELINE=0` 关闭）；`AUTO_PROMOTE_MAX_DIFF` 阈值 |
| flake 追踪 | error-reporter 标记 flake + `results/history/YYYY-MM-DD.json` |
| 统一 CLI | `npm run cli -- --help` |
| 初始化 | `npm run setup` |
| Studio 模块化 | `pw-files/lib/repo-context.js`、`ws-safe.js` + WS 错误边界 |

## 进行中 / 建议下一步

| 优先级 | 项 | 说明 |
|--------|-----|------|
| P0 | Studio 继续拆分 | `routes/`、`services/`、`session/` 从 server.js 抽离 |
| P0 | CJS → ESM | 逐步迁移 `src/utils/*.cjs` 为 `.ts` |
| P1 | maskSelectors 实现 | 截图前 DOM 遮罩，降低动态区 diff |
| P1 | 测试数据 fixture | optimized spec 业务文本配置化 |
| P2 | DevContainer | `.devcontainer/devcontainer.json` |
| P3 | flake 仪表盘 | 基于 `results/history/` 聚合 trend |

## 环境变量速查

| 变量 | 默认 | 说明 |
|------|------|------|
| `AUTO_PROMOTE_BASELINE` | 开启 | 设 `0` 关闭自动晋升 Golden |
| `AUTO_PROMOTE_MAX_DIFF` | `0.005` | golden blocker 时允许晋升的最大 diff 比例 |
| `PLAYWRIGHT_PIXELMATCH_INCLUDE_AA` | - | 设 `0` 降低抗锯齿噪声 |
| `CI_BUNDLE_TEST_RESULTS` | - | CI 打包时含 test-results |
