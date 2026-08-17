# Visual Review Lite

本重构的方案说明与唯一改动记录。后续相关代码改动只追加本文 Change Log，不写到 `OPTIMIZATION-ROADMAP.md` 或其他 changelog。

## 目标

从「截图对比工具」升级为人审流水线：UI State 命名、Diff Region、报告内 Approve/Reject、按状态更新 Golden。不换 pixelmatch，不引入 Chromatic / Percy / Argos SaaS。

## 主路径

```text
visualTest / takeStepScreenshot
  → 稳定截图（Mask + Stabilize）
  → PNG + meta
  → pixelmatch
  → Diff Region 聚类
  → HTML Visual Review
  → Approve / Reject
  → promote 单张 Golden
```

## 约定

- API：`visualTest` 与 `takeStepScreenshot` 并存；`visualTest` 固定 `mode: 'stable'`
- 文件名：仍为 `step-*.png`，扫描器按步骤号分组
- `visualTest` 落盘：`step-{n}-{name}__{state}.png`（`n` 默认 90）
- Baseline：整 run `promoteRunToGolden` 与按 step `promoteStepsToGolden` 并存
- Gate：仍用整体 `blockerRatio`，Region 只用于展示

## 明确不做

- Chromatic / Percy / Argos SaaS
- SSIM 或其他新对比算法
- DOM + CSS archive
- 全量改 optimizer、去掉 before/after 截图
- 改 `takeStepScreenshot` 默认 `fast`

## Change Log

### 2026-08-17

- 新增 `docs/visual-review-lite.md`；`docs/ui-regression-workflow.md` 只加入口链接
- `src/utils/screenshot.ts`：新增 `visualTest({ dir, name, state, step })`，内部走 `takeStepScreenshot` + `mode: 'stable'`；`.meta.json` 写 `snapshotName` / `state`
- `src/utils/screenshot-wait.ts`：`screenshotWhenStable` 路径增加 `waitForViewportStable`；fast 默认不变
- `tests/optimized/stage/260612/我的审批_*.optimized.spec.ts`：补 `approval-list/normal`、`approval-detail/normal`、`approval-detail/action-bar` 三个 visualTest，原 before/after 保留
- `scripts/report/image-diff.ts`：pixelmatch 后连通域聚类 `clusterDiffRegions`；`ImageDiffResult` / 缓存 meta 带 `regions`；gate 公式不变
- `config/ui-regression.json`：追加 `diffRegions`（默认 enabled，只影响展示）
- `scripts/report/baseline-manager.ts`：新增 `promoteStepsToGolden`（按文件覆盖，不删其他 step）
- `scripts/report/promote-baseline.ts`：`--step=` 可重复；不传则仍整 run
- `scripts/report/visual-review.ts`：读写 `results/visual-review.json`；approved 时调用 `promoteStepsToGolden`
- HTML 报告新增 Visual Review Tab：Region 列表 + Approve/Reject；复用滑块/闪烁/标注/并排
- Studio：`POST /api/visual-review` 与 WS `repo:visual-review`；静态 HTML 失败时复制 CLI
- 是否影响旧逻辑：否（旧 API / 整 run promote / `--gate` 阈值均保留）
- 是否影响默认行为：稳定截图路径多一次视口稳定等待；对比缓存若旧 meta 无 `regions` 会重算一次
- 流程验证：审批样例 `我的审批` 在主文档侧栏，iframe 定位失败；改为 iframe 优先、主文档 `menuitem` 兜底后用例通过。`visualTest(approval-list/normal)` 已落盘；step 3/4 单据未出现走 skipped，detail visualTest 未拍。`compare-screenshots` 已生成 Visual Review Tab。新 snapshot 尚无 Golden，需 Approve 后下次才会出 diff。
