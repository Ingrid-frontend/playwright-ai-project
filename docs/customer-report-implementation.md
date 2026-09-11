# 客户版 UI 衰退报告 · 实现说明（内部）

> 客户可见的交付文档见 `ui-regression-report-for-customer.md`。本文只记实现口径与维护要点。
> 入口：`npm run report:customer` → `scripts/report/compare-screenshots-customer.ts` → `results/ui-regression-customer.html`
> 工程师报告 `npm run compare-screenshots` 与 CI `--gate` 逻辑均未改动。

---

## 1. 模块职责

| 文件 | 职责 |
|---|---|
| `change-nature.ts` | 判定单个差异区的变化性质（位移/渲染/新增/缺失/内容变化），误判治理的核心 |
| `coverage-stats.ts` | 步骤状态 + 对外四档 impactTier（需修复/影响体验/可忽略/未判定）+ 判定理由 |
| `customer-report-model.ts` | 组装展示模型，按根因聚类成 issue group，生成锚点 id |
| `customer-report-summary.ts` | 写出 `customer-report-summary.json`（诚实口径，供飞书/CI） |
| `customer-report-plain.ts` | 大白话描述文案 |
| `customer-report-naming.ts` | 展示名清洗：环境名、步骤 slug、方位描述 |
| `customer-report-render.ts` | HTML 结构：结论速览 + 对比明细 + 检测范围 |
| `customer-report-assets.ts` | CSS 与前端交互脚本 |

## 2. 判定口径（性质优先，不是差异率优先）

`classifyDifference` 顺序：

1. 过滤 `severity==='low'` 与贴边滚动条条带 → `significantRegions`
2. 按 `isActionableRegion` 分流。**性质未知时保守视为实质变化**，绝不悄悄降级
3. 全部区域都是 `shifted`/`rendering` → `minor` + impactTier `benign`
4. 仅 actionable 区域可触发 `regress` / `blocking`：单块像素数超限 / 宽高同时超限 / 差异率超限且 actionable ≥ 3
5. 小范围 actionable 内容变化 → `minor` + impactTier `degraded`（影响体验，不是可忽略）

`change-nature.ts` 关键参数与设计：

- `maxShift: 32`（原为 8，实测真实位移达 9–12px，是主要误判来源）
- 位移搜索两阶段：先用行列一维投影取 top-3 候选，再在候选点 ±1 精搜，避免 65×65 全搜索。全流程耗时约 2–3s
- `visibleChange`：统计 |Δ亮度| > 40 的像素，占比 < 3% 且数量 < 40 视为人眼不可见 → `rendering`
- 仅当变化人眼可见才允许判 `appeared`/`vanished`，防止极淡 1px 分隔线被当成新增内容
- 符号约定：`shiftX` 正值 = 当前截图内容相对基线**右移**

**改判定逻辑必须同时递增 `DIFF_NATURE_VERSION`（当前 6），否则增量缓存不失效。**

## 3. 不许回退的基线

当前 `screenshots/` 数据下的判定结果：

```
需修复 / 影响体验 / 可忽略 / 完全一致 / 未判定（步骤级）
旧口径「轻微变化」现拆成影响体验（小范围内容变化）与可忽略（位移/渲染）
```

`passRate` 现为完全一致占比，不再把可忽略算进通过。改动后用 `npx tsx scripts/verify/dump-customer-model.ts` 核对四档数字。

## 4. 验证命令

```bash
npx tsc --noEmit -p tsconfig.json
npx tsx scripts/verify/smoke-report-modules.ts        # 单元级，含 6 项性质判定断言
npm run report:customer
npx tsx scripts/verify/verify-customer-report-html.ts # 结构级，10 项
npx tsx scripts/verify/dump-customer-model.ts         # 判定明细核对
npx tsx scripts/verify/probe-change-nature.ts         # 逐区域性质探针
```

## 5. 展示层要点

- **结论页只放速览清单**（`.brief-list`），一行一个问题；大图证据全部在「对比明细」，靠 `openCustomerIssue(anchorId)` 切 Tab + 滚动 + 高亮
- 标注框按性质着色：`mark-real` 红实线 / `mark-benign` 灰虚线，配 `mark-legend` 图例
- 统计四格为**步骤级**（需修复 / 影响体验 / 可忽略 / 未判定），问题清单为**根因级**并同时写出影响步数
- 首屏不展示「合格率」；脚注「完全一致占比」= `passSteps / comparedSteps`
- 步骤 slug 词典在 `customer-report-naming.ts` 的 `STEP_SLUG_LABELS`；新项目接入时按需扩充，未命中的 `step-N` 回落为「第 N 步页面」

## 6. 已知维护陷阱

1. **autoPromote 会吃掉小差异**：生效阈值 = 环境变量 `AUTO_PROMOTE_MAX_DIFF` ?? 配置 `autoPromote.maxDiffRatio`（**现为 0.001，原为 0.005**）?? 硬编码兜底 0.005（`scripts/flow/flow-shared.ts:221`）。阈值压到 0.001 是为了让 0.1–0.5% 的轻微差异先以「需关注（attention）」状态浮到结论栏、由人确认后再决定是否固化基线，而不是被自动晋升静默吞掉。完全关闭自动固化：设 `AUTO_PROMOTE_BASELINE=0`（同文件 `:196`）。
2. **未检测占比偏高**（当前 25/41）：多为 before/skipped 过程截图与未固化基线，需要按业务重要性逐步 promote
3. `verify-customer-report-html.ts` 的断言与文案强耦合，改首屏措辞时同步更新正则

## 7. 总结结论状态（summary verdict）

`buildCoverageStats` 产出的 `verdict` 有四种，对应结论栏左边框配色与首屏大字（详见 `customer-report-render.ts` 的 `verdictClass` / `customer-report-assets.ts` 的 `.verdict.*`）：

| verdict | 触发条件 | 左边框色 | 首屏大字示例 |
|---|---|---|---|
| `regress` | `regressSteps > 0` | 红 `#e03131` | 需修复 N 步（归并为 M 个问题） |
| `attention` | 无阻断但 `degradedSteps > 0` | 琥珀 `#f08c00` | 有 N 步影响体验，建议确认 |
| `pass` | 无阻断且无影响体验（可忽略不刷红/琥珀） | 绿 `#2f9e44` | 没有需要修复的项 / 均完全一致 |
| `insufficient_coverage` | `comparedSteps === 0` | 琥珀（unknown） | 本次无有效对比，无法给出结论 |

**passRate 破坏性变更**：旧值 `(passSteps + minorSteps) / comparedSteps` 把可忽略算进「合格率」。新值仅 `passSteps / comparedSteps`，客户 HTML 不再使用「合格率/通过率」字样。内部非阻断占比见 `nonBlockingRate`。

要点：

- **影响体验**（小范围内容变化）走琥珀色 `attention`，**可忽略**（位移/渲染）不再把结论刷成「建议确认」。
- **CI 安全**：`--gate` 读取的是 `issuesReport` 的 `blocker` 严重度，**不读** `coverage.verdict`。`attention` 不会造成 CI 误判失败。
- 客户摘要 JSON：`results/customer-report-summary.json`（主报告）或与 HTML 同目录的 `*-summary.json`。
