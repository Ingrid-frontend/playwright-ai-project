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
| Firefox 项目 | `optimized-firefox` 已启用；Studio 默认可选，默认 CI 仍 Chrome+WebKit |
| flake 追踪 | error-reporter 标记 flake + `results/history/YYYY-MM-DD.json` |
| 统一 CLI | `npm run cli -- --help` |
| 初始化 | `npm run setup` |
| Studio 模块化 | `pw-files/lib/` 分域 WS handler + session / 静态路由 |
| CJS → ESM | `src/utils/*.ts` 为实现；Studio 仍 `require('*.cjs')` shim |
| selector bbox 基线 | `promoteRunToGolden` 同步复制 `.meta.json` |
| flake 仪表盘 | `report:dashboard` 读取 `results/history/test-runs/` 展示 flake 趋势 |
| Studio jobs 拆分 | `test-jobs-actions`（任务）与 `test-jobs-spec-actions`（用例文件）分域 |
| 对比引擎扫描拆分 | PNG 扫描在 `compare-screenshots-scan`；pixelmatch 配对仍在 `compare-screenshots-engine` |
| 大脚本拆分 | optimize / Figma 报告 / 飞书文档 / auto-test 通知 / 报告 viz 资产按域抽出 |
| 设计稿收集拆分 | `design-spec-collect` 负责区域/色板收集；`extractDesignSpec` 只做装配 |
| 报告日期分组 | `compare-screenshots-render-date` 抽出日历日分组 |
| Job 执行拆分 | `job-runner-execute` 负责按档案跑用例 |
| 录制优化拆分 | `optimize-raw-passes` / `optimize-raw-codegen` / `optimize-raw-wait` |
| Job 通知卡片 | `job-notify-card` 负责 Markdown/趋势/卡片；发送仍在 `job-notify` |
| 截图 helper | mask/诊断在 `screenshot-capture`；等待在 `screenshot-wait` |
| 线上规范采集 | `live-spec-collect` 负责页面采集；`captureLiveSpec` 只做装配 |

## 进行中 / 建议下一步

暂无 P0。三引擎默认 CI 因 Firefox `storageState` 兼容性未并入 `test:ci`；需要时用 `npm run test:ci:firefox`。

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
