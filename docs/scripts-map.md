# 脚本地图（scripts-map）

> 索引：[docs/README.md](./README.md)

> 生成时间：2026-09-10 · 共 **146** 条 npm scripts / **202** 个 TS 脚本（`scripts/` 下）。
> 本地图按业务域分组，是「有哪些命令可用」的唯一索引。
> 增删 npm scripts 时请同步更新本文件（`docs:check` 会校验 docs 索引完整性）。

## 孤儿脚本（未注册到 package.json，可手动 npx tsx 调用）

以下 6 个 TS 文件没有 npm script 入口、未被其他模块 import、未在 docs 提及，属于「可手动调用的工具 CLI」。
不建议直接删除（均为有用途的调试/校验工具），已在此登记纳管：

| 文件 | 用途 | 调用方式 |
|---|---|--- |
| `scripts/flow/flow-registry-json.ts` | 输出 flow 注册表 JSON（4 行薄封装） | `npx tsx scripts/flow/flow-registry-json.ts` |
| `scripts/index-frontend/verify-contract.ts` | 拿 ui-contract.json 结论到真实页面核对 | `npx tsx scripts/index-frontend/verify-contract.ts --env=stage --route=/main/approve` |
| `scripts/recording/resolve-recording-path.ts` | 解析录制落盘相对路径（Studio 转发 stdin） | `npx tsx scripts/recording/resolve-recording-path.ts --json < payload.json` |
| `scripts/studio/open-headed-page.ts` | Studio 有头调试：加载 profile 打开 baseURL | `npx tsx scripts/studio/open-headed-page.ts --baseURL=... --entry=/` |
| `scripts/verify/audit-customer-report.ts` | 客户报告一致性审计（独立比对链路） | `npx tsx scripts/verify/audit-customer-report.ts` |
| `scripts/verify/verify-diff-regions.ts` | 用真实截图验证差异区聚类不退化为整页框 | `npx tsx scripts/verify/verify-diff-regions.ts [issueIndex]` |

## 快速上手：按使用场景查命令

- **跑测试**：`test:dev / test:stage / test:uat / test:stage9084`（按环境）、`test`（默认）
- **跑流程**：`flow:run`（交互式）、`flow:debug-fast`（快速调试单 flow）、`{flow}:golden`（金数据回归）
- **看报告**：`report:customer`（客户报告）、`report:customer:standalone`（单文件内嵌版）、`report`（Playwright 原生）
- **交付**：`deliver:feishu`（飞书文档+多维表）、`feishu:customer-card`（卡片通知）
- **日常维护**：`smoke`（模块冒烟）、`typecheck`、`lint`、`prune:flow-videos`、`prune:flow-history`

---

### test — 测试执行（Playwright / 冒烟 / e2e）（20）

| 命令 | 内容 |
|---|---|
| `format` | `prettier --write "**/*.{ts,tsx,js,jsx,json,md}"` |
| `lint` | `eslint . --ext .ts,.tsx` |
| `lint:fix` | `eslint . --ext .ts,.tsx --fix` |
| `smoke` | `tsx scripts/verify/smoke-report-modules.ts && node scripts/verify/smoke-ws-dispatch.cjs && node scripts/verify/verify-ego-selector-probe.cjs && node scripts/verify/verify-ego-snapshot.cjs && node scripts/verify/verify-baseline-quality.cjs && node scripts/verify/verify-intent-assert.cjs && node scripts/verify/verify-failure-bundle.cjs && node scripts/verify/verify-heal-suggest.cjs && node scripts/verify/verify-intent-trust.cjs && node scripts/verify/verify-intent-boundary-ui.cjs && node scripts/verify/verify-replay-delete.cjs && node scripts/verify/verify-intent-delete.cjs && node scripts/verify/verify-request-flow-stable.cjs && npx tsx scripts/verify/verify-customer-report-html.ts` |
| `test` | `playwright test` |
| `test:ci` | `playwright test --project=optimized --project=optimized-webkit && npm run compare-screenshots -- --gate` |
| `test:ci:firefox` | `playwright test --project=optimized --project=optimized-webkit --project=optimized-firefox && npm run compare-screenshots -- --gate` |
| `test:debug` | `playwright test --debug` |
| `test:dev` | `npm run test:env --env=dev` |
| `test:e2e` | `playwright test tests/e2e` |
| `test:env` | `PLAYWRIGHT_ENV=$npm_config_env npm test` |
| `test:headed` | `playwright test --headed` |
| `test:optimized` | `playwright test --project=optimized --workers=1` |
| `test:pipeline` | `npm run pipeline-raw-to-optimized` |
| `test:regression` | `npm run test-job -- run` |
| `test:stage` | `npm run test:env --env=stage` |
| `test:stage9084` | `npm run test:env --env=stage9084` |
| `test:uat` | `npm run test:env --env=uat` |
| `test:ui` | `playwright test --ui` |
| `typecheck` | `tsc --noEmit` |

### ai — AI 生成用例（2）

| 命令 | 内容 |
|---|---|
| `ai:generate` | `tsx scripts/ai/generate-playwright-script.ts` |
| `ai:run` | `tsx scripts/ai/run-playwright-script.ts` |

### misc — 其他工具（29）

| 命令 | 内容 |
|---|---|
| `catalog:drift-check` | `tsx scripts/flow/run-catalog-drift-check.ts` |
| `check-baseline-pr` | `tsx scripts/report/check-baseline-pr.ts` |
| `cli` | `tsx scripts/cli.ts` |
| `create-feishu-doc` | `tsx scripts/feishu/create-feishu-doc.ts` |
| `depcheck` | `npx --yes depcheck --ignores=@types/*,@eslint/js,@typescript-eslint/*,eslint,globals,prettier,tsx,typescript,pixelmatch,pngjs,dotenv` |
| `docs:check` | `tsx scripts/verify/check-docs-index.ts` |
| `generate-pom` | `tsx scripts/generate-pom.ts` |
| `generate-raw-recording` | `tsx scripts/recording/generate-raw-recording.ts` |
| `heal:suggest` | `tsx scripts/ai/heal-suggest.ts` |
| `hooks:install` | `git config core.hooksPath .githooks` |
| `init-agents` | `npx playwright init-agents --loop=vscode` |
| `intent:run` | `tsx scripts/ai/run-intent.ts` |
| `mine:cases` | `tsx scripts/ai/mine-cases.ts` |
| `notify-failure` | `tsx scripts/flow/notify-failure.ts` |
| `notify:resend` | `tsx scripts/feishu/resend-delivery.ts` |
| `optimize-raw-recordings` | `tsx scripts/optimize/optimize-raw-recordings.ts` |
| `pipeline-raw-to-optimized` | `tsx scripts/preprocess/pipeline-raw-to-optimized.ts` |
| `pr-comment-ui-issues` | `tsx scripts/report/pr-comment-issues.ts` |
| `preprocess-raw-recordings` | `tsx scripts/preprocess/preprocess-raw-recordings.ts` |
| `promote-baseline` | `tsx scripts/report/promote-baseline.ts` |
| `prune-flow-golden-runs` | `tsx scripts/report/prune-flow-golden-runs.ts` |
| `rerun-regression-keep` | `tsx scripts/flow/rerun-regression-keep-screenshots.ts` |
| `run-optimized-tests` | `tsx scripts/flow/run-optimized-tests.ts` |
| `send-html-to-feishu` | `tsx scripts/feishu/send-html-to-feishu.ts` |
| `setup` | `tsx scripts/setup/init-project.ts` |
| `test-feishu-webhook` | `tsx scripts/feishu/test-feishu-webhook.ts` |
| `test-job` | `tsx scripts/jobs/test-job-cli.ts` |
| `trace:show` | `tsx scripts/report/show-latest-trace.ts` |
| `upload-to-feishu` | `tsx scripts/feishu/upload-to-feishu.ts` |

### report — 报告生成与打包（25）

| 命令 | 内容 |
|---|---|
| `analyze-errors` | `tsx scripts/analyze/analyze-errors.ts` |
| `analyze-test` | `tsx scripts/analyze/analyze-test.ts` |
| `compare-flow-screenshots` | `tsx scripts/report/compare-flow-screenshots.ts` |
| `compare-screenshots` | `tsx scripts/report/compare-screenshots.ts` |
| `open-screenshot-report` | `tsx scripts/report/open-screenshot-report.ts` |
| `open-screenshot-report:only` | `tsx scripts/report/open-screenshot-report.ts --open-only` |
| `report` | `playwright show-report` |
| `report:bundle` | `tsx scripts/report/bundle-public-reports.ts` |
| `report:bundle-ci` | `tsx scripts/report/bundle-ci-artifacts.ts` |
| `report:customer` | `tsx scripts/report/compare-screenshots-customer.ts` |
| `report:customer:bundle` | `tsx scripts/report/bundle-customer-report.ts` |
| `report:customer:pdf` | `tsx scripts/report/export-customer-report-pdf.ts` |
| `report:customer:standalone` | `tsx scripts/report/compare-screenshots-customer.ts --inline-assets` |
| `report:dashboard` | `tsx scripts/report/generate-quality-dashboard.ts` |
| `report:flow-batch` | `tsx scripts/report/build-flow-report-batch.ts` |
| `report:flow-customer` | `tsx scripts/report/flow-customer-report.ts` |
| `report:flow-probe` | `tsx scripts/report/flow-probe-report.ts` |
| `report:flow-replay` | `tsx scripts/report/flow-run-replay.ts` |
| `report:flow-summary` | `tsx scripts/report/flow-run-summary.ts` |
| `report:replay-summary` | `tsx scripts/report/flow-replay-summary.ts` |
| `screenshot-report` | `npm run compare-screenshots && npm run open-screenshot-report:only` |
| `style:run` | `tsx scripts/ai/run-intent.ts --engine=pw` |
| `trust:report` | `tsx scripts/ai/trust-report.ts` |
| `ui-regression:add-mask` | `tsx scripts/report/ui-regression-add-mask.ts` |
| `visual-review` | `tsx scripts/report/visual-review.ts` |

### flow — Flow 流程编排（run / 新建 / 目录）（7）

| 命令 | 内容 |
|---|---|
| `flow:debug-fast` | `tsx scripts/flow/flow-debug-fast.ts` |
| `flow:delete-runs` | `tsx scripts/flow/flow-run-delete.ts` |
| `flow:gen-catalog` | `tsx scripts/flow/gen-catalog-from-probe.ts` |
| `flow:list` | `tsx scripts/flow/flow-debug-fast.ts --list` |
| `flow:new` | `tsx scripts/flow/new-flow.ts` |
| `flow:run` | `tsx scripts/flow/run-flow-cli.ts` |
| `flow:verify` | `tsx scripts/flow/flow-verify.ts` |

### request-flow — 申请单流程（4）

| 命令 | 内容 |
|---|---|
| `request-flow:debug-fast` | `npm run flow:debug-fast -- --flow=request-flow` |
| `request-flow:golden` | `tsx scripts/flow/run-request-flow-golden.ts` |
| `request-flow:stability-gate` | `tsx scripts/flow/run-request-flow-stability-gate.ts` |
| `request-flow:write` | `tsx scripts/flow/run-request-flow-write.ts` |

### approval-flow — 审批流程（4）

| 命令 | 内容 |
|---|---|
| `approval-flow:debug-fast` | `npm run flow:debug-fast -- --flow=approval-flow` |
| `approval-flow:golden` | `tsx scripts/flow/run-approval-flow-golden.ts` |
| `approval-flow:stability-gate` | `tsx scripts/flow/run-approval-flow-stability-gate.ts` |
| `approval-flow:write` | `tsx scripts/flow/run-approval-flow-write.ts` |

### feishu — 飞书集成（文档 / 多维表 / 通知）（15）

| 命令 | 内容 |
|---|---|
| `feishu:bitable` | `tsx scripts/feishu/write-bitable-report.ts` |
| `feishu:bitable-backfill` | `tsx scripts/feishu/backfill-bitable-history.ts` |
| `feishu:bitable-maintain` | `tsx scripts/feishu/maintain-bitable.ts` |
| `feishu:bitable-setup` | `tsx scripts/feishu/setup-bitable-dashboard.ts` |
| `feishu:customer-alert` | `tsx scripts/feishu/send-customer-feishu-card.ts --alert` |
| `feishu:customer-card` | `tsx scripts/feishu/send-customer-feishu-card.ts` |
| `feishu:customer-notify` | `tsx scripts/feishu/send-customer-feishu-card.ts` |
| `feishu:customer-weekly` | `tsx scripts/feishu/send-customer-feishu-card.ts --weekly` |
| `feishu:feedback-table-setup` | `tsx scripts/feishu/create-feedback-table.ts` |
| `feishu:feedback-write` | `tsx scripts/feishu/write-feedback-bitable.ts` |
| `feishu:flow-notify` | `tsx scripts/feishu/send-flow-feishu-result.ts` |
| `feishu:flow-weekly-doc` | `tsx scripts/feishu/append-flow-weekly-doc.ts` |
| `feishu:grant-bitable-editor` | `tsx scripts/feishu/grant-bitable-editor.ts` |
| `feishu:send-card` | `tsx scripts/feishu/send-latest-card.ts` |
| `feishu:update-report` | `tsx scripts/feishu/update-feishu-report.ts` |

### record — 用例录制（1）

| 命令 | 内容 |
|---|---|
| `record` | `tsx scripts/recording/record.ts` |

### login — 登录态管理（2）

| 命令 | 内容 |
|---|---|
| `login` | `playwright test src/setup/login.setup.ts --project=setup --retries=0 --timeout=120000` |
| `login:force` | `PLAYWRIGHT_REFRESH_STORAGE=1 playwright test src/setup/login.setup.ts --project=setup --retries=0 --timeout=120000` |

### studio — Studio 交互（1）

| 命令 | 内容 |
|---|---|
| `studio` | `npm --prefix pw-files start` |

### auto-test — 自动测试通知（3）

| 命令 | 内容 |
|---|---|
| `auto-test` | `tsx scripts/flow/auto-test-flow.ts` |
| `auto-test:feishu-links` | `tsx scripts/flow/auto-test-flow.ts --feishu-mode=links --create-feishu-doc` |
| `auto-test:feishu-text` | `tsx scripts/flow/auto-test-flow.ts --feishu-mode=text` |

### optimize — 用例优化流水线（2）

| 命令 | 内容 |
|---|---|
| `optimize` | `npm run pipeline-raw-to-optimized` |
| `optimize:ai` | `tsx scripts/optimize/optimize-with-ai.ts` |

### ui-audit — UI 审计（2）

| 命令 | 内容 |
|---|---|
| `ui-audit` | `tsx scripts/report/ui-audit.ts` |
| `ui-audit:verify` | `tsx scripts/verify/verify-ui-audit.ts` |

### figma — Figma 设计基线（2）

| 命令 | 内容 |
|---|---|
| `figma:export-helios` | `tsx scripts/figma/export-helios-spec.ts` |
| `figma:sync-baselines` | `tsx scripts/figma/sync-figma-baselines.ts` |

### deliver — 报告交付（3）

| 命令 | 内容 |
|---|---|
| `deliver:feishu` | `NODE_OPTIONS=--dns-result-order=ipv4first tsx scripts/feishu/deliver-customer-report.ts --apply` |
| `deliver:feishu:notify` | `NODE_OPTIONS=--dns-result-order=ipv4first tsx scripts/feishu/deliver-customer-report.ts --apply --notify` |
| `deliver:preview` | `NODE_OPTIONS=--dns-result-order=ipv4first tsx scripts/feishu/deliver-customer-report.ts` |

### verify — 校验（1）

| 命令 | 内容 |
|---|---|
| `verify:customer-delivery` | `node scripts/verify/verify-customer-delivery.cjs` |

### reset — 数据重置（2）

| 命令 | 内容 |
|---|---|
| `reset:flow-artifacts` | `tsx scripts/flow/reset-flow-artifacts.ts` |
| `reset:regression-data` | `tsx scripts/flow/reset-regression-data.ts` |

### selector-drift — 选择器漂移修复（2）

| 命令 | 内容 |
|---|---|
| `selector-drift:apply` | `tsx scripts/report/selector-drift-suggest.ts -- --apply` |
| `selector-drift:suggest` | `tsx scripts/report/selector-drift-suggest.ts` |

### feedback — 反馈回路（3）

| 命令 | 内容 |
|---|---|
| `feedback:docs` | `tsx scripts/report/generate-feedback-docs.ts` |
| `feedback:import` | `tsx scripts/feedback/import-feedback.ts` |
| `feedback:submit` | `tsx scripts/feedback/submit-manual-feedback.ts` |

### index — 前端源码索引（4）

| 命令 | 内容 |
|---|---|
| `index:frontend` | `tsx scripts/index-frontend/build-ui-contract.ts` |
| `index:frontend:ab` | `tsx scripts/index-frontend/ab-run.ts` |
| `index:frontend:probe` | `tsx scripts/index-frontend/probe-live-page.ts` |
| `index:frontend:sync` | `tsx scripts/index-frontend/sync-frontend-repo.ts` |

### clean — 清理（2）

| 命令 | 内容 |
|---|---|
| `clean` | `rm -rf test-results playwright-report screenshots/results` |
| `clean:all` | `rm -rf node_modules test-results playwright-report screenshots results && npm install` |

### ego — ego 浏览器（3）

| 命令 | 内容 |
|---|---|
| `ego:audit` | `tsx scripts/ego/audit-selectors.ts` |
| `ego:explore` | `tsx scripts/ego/explore-to-intent.ts` |
| `ego:export-storage` | `tsx scripts/ego/export-storage-state-from-ego.ts` |

### approval — 审批目录（3）

| 命令 | 内容 |
|---|---|
| `approval:test:readonly` | `playwright test --config approval-flow/playwright.config.ts approval/filter.spec.ts approval/filter-tabs.spec.ts approval/filter-panel.spec.ts approval/load-and-tabs.spec.ts approval/search-and-open.spec.ts approval/full-flow.spec.ts` |
| `approval:test:write` | `APPROVAL_ENABLE_WRITE=1 playwright test --config approval-flow/playwright.config.ts approval/approve-reject.spec.ts` |
| `approval:verify-catalog` | `node scripts/verify/verify-approval-catalog.cjs` |

### expense-flow — 报销流程（2）

| 命令 | 内容 |
|---|---|
| `expense-flow:debug-fast` | `tsx scripts/flow/flow-debug-fast.ts --flow=expense-flow` |
| `expense-flow:golden` | `tsx scripts/flow/run-expense-flow-golden.ts` |

### prune — 产物回收（2）

| 命令 | 内容 |
|---|---|
| `prune:flow-history` | `tsx scripts/report/prune-flow-history.ts` |
| `prune:flow-videos` | `tsx scripts/report/prune-flow-videos.ts` |
