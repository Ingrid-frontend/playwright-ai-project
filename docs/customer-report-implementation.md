# 客户版 UI 衰退报告 · 实现说明（内部）

> 索引：[docs/README.md](./README.md)

> 客户可见的交付文档见 `ui-regression-report-for-customer.md`。本文只记实现口径与维护要点。
> 入口：`npm run report:customer` → `scripts/report/compare-screenshots-customer.ts` → `results/ui-regression-customer.html`
> 工程师报告 `npm run compare-screenshots` 与 CI `--gate` 逻辑均未改动。

---

## 1. 模块职责

| 文件 | 职责 |
|---|---|
| `change-nature.ts` | 判定单个差异区的变化性质（位移/渲染/新增/缺失/内容变化），误判治理的核心 |
| `coverage-stats.ts` | 四档状态分级（pass/minor/regress/uncovered）+ 判定理由文本 |
| `customer-report-model.ts` | 组装展示模型，按根因聚类成 issue group，生成锚点 id |
| `customer-report-plain.ts` | 大白话描述文案 |
| `customer-report-naming.ts` | 展示名清洗：环境名、步骤 slug、方位描述 |
| `customer-report-render.ts` | HTML 结构：结论速览 + 对比明细 + 检测范围 |
| `customer-report-assets.ts` | CSS 与前端交互脚本 |

## 2. 判定口径（性质优先，不是差异率优先）

`classifyDifference` 顺序：

1. 过滤 `severity==='low'` 与贴边滚动条条带 → `significantRegions`
2. 按 `isActionableRegion` 分流。**性质未知时保守视为实质变化**，绝不悄悄降级
3. 全部区域都是 `shifted`/`rendering` → 强制 `minor`，理由写明偏移量与「内容完全一致」
4. 仅 actionable 区域可触发 `regress`：单块像素数超限 / 宽高同时超限 / 差异率超限且 actionable ≥ 3

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
明显衰退 3 · 轻微变化 10 · 一致 3 · 未检测 25 · 已对比 16
衰退分组 2（我的审批 1.04% / 返回 0.82%，均为真实 appeared）
轻微变化分组 4（DEV管理员 9px 位移 / 审批历史 12px 位移 / 导航到页面 / 工作台）
```

改动后用 `npx tsx scripts/verify/dump-customer-model.ts` 核对上述数字。

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
- 统计四格为**步骤级**，问题清单为**根因级**，二者数字不同是预期的，首屏文案已分别说明
- 步骤 slug 词典在 `customer-report-naming.ts` 的 `STEP_SLUG_LABELS`；新项目接入时按需扩充，未命中的 `step-N` 回落为「第 N 步页面」

## 6. 已知维护陷阱

1. **autoPromote 会吃掉小差异**：生效阈值 = 环境变量 `AUTO_PROMOTE_MAX_DIFF` ?? 配置 `autoPromote.maxDiffRatio`（**现为 0.001，原为 0.005**）?? 硬编码兜底 0.005（`scripts/flow/flow-shared.ts:221`）。阈值压到 0.001 是为了让 0.1–0.5% 的轻微差异先以「需关注（attention）」状态浮到结论栏、由人确认后再决定是否固化基线，而不是被自动晋升静默吞掉。完全关闭自动固化：设 `AUTO_PROMOTE_BASELINE=0`（同文件 `:196`）。
2. **未检测占比偏高**（当前 25/41）：多为 before/skipped 过程截图与未固化基线，需要按业务重要性逐步 promote
3. `verify-customer-report-html.ts` 的断言与文案强耦合，改首屏措辞时同步更新正则

## 7. 总结结论状态（summary verdict）

`buildCoverageStats` 产出的 `verdict` 有四种，对应结论栏左边框配色与首屏大字（详见 `customer-report-render.ts` 的 `verdictClass` / `customer-report-assets.ts` 的 `.verdict.*`）：

| verdict | 触发条件 | 左边框色 | 首屏大字示例 |
|---|---|---|---|
| `regress` | `regressSteps > 0`，存在明显衰退 | 红 `#e03131` | 发现 N 个 UI 问题需要处理 |
| `attention` | 无衰退但 `minorSteps > 0`，仅轻微变化 | 琥珀 `#f08c00` | 存在 N 处轻微变化，建议人工确认 |
| `pass` | 无衰退且无轻微变化 | 绿 `#2f9e44` | 本次未发现 UI 衰退 |
| `insufficient_coverage` | `comparedSteps === 0`，无有效对比 | 琥珀（unknown） | 本次无有效对比，无法给出结论 |

要点：

- **轻微变化不再被算作绿色「通过」**。此前 minor-only 场景落到 `pass`，结论栏仍是绿色、只在副标题里加一句括号说明，容易被误读为「完全没问题」。现独立为琥珀色 `attention`，明确提示「需人工确认」。
- 渲染层三处同步改动：`customer-report-render.ts` 的 `verdictClass` 新增 `watch` 分支（minor-only 走 `watch`）；`customer-report-assets.ts` 新增 `.verdict.watch`（左边框 + 标题色 `#a37200`）；`compare-report-viz.ts` 的 `OverviewData.coverage.verdict` 类型放开 `'attention'`。
- **CI 安全**：`--gate` 读取的是 `issuesReport` 的 `blocker` 严重度，**不读** `coverage.verdict`。因此 `attention` 不会造成 CI 误判失败——只有真实 `regress`（blocker）才会卡门禁。本次新增的 `attention` 状态对工程报告与 CI 均无副作用。
- **与 autoPromote 的配合**：`maxDiffRatio` 从 0.005 降到 0.001（§6 陷阱 1），使轻微差异先以 `attention` 浮出、而非被自动晋升吞掉；确认接受后再手动固化基线。

---

## 8. 业务影响三档与数字对账（2026-09-10）

### 8.1 为什么要把 minor 拆开

此前只有 `regress / minor` 两档对外。实测同一批数据里，「表格最后一行被分页栏遮挡无法点击」和「整体平移 9px」同为 minor，严重度被抹平，客户无法判断该看哪一个。

`DiffEvidence.impactTier` 由 `classifyDifference` 的**判定分支直接给出**，展示层不得二次猜测：

| impactTier | 客户可见说法 | 对应 status | 触发条件 |
|---|---|---|---|
| `blocking` | 需要修复 | `regress` | 内容变了且达到阻断阈值 |
| `degraded` | 影响体验 | `minor` | 内容确实有变化，但未阻断操作 |
| `benign` | 可忽略 | `minor` / `pass` | 内容未变（位移 / 渲染 / 数据漂移） |

恒定式：`regressSteps + degradedSteps + benignSteps + passSteps === comparedSteps`。
`verify-customer-report-html.ts` 的「三档之和 = 已对比步骤数」断言会守住它。

`IMPACT_TIER_LABEL` / `IMPACT_TIER_ORDER` 在 `coverage-stats.ts`，渲染层与摘要 JSON 共用，不要另写一份中文标签。

### 8.2 步数口径：slot 级，不是页面级

`CoverageStats.minorSteps` 等计数是 **slot（一次页面比对）** 级；而 `CustomerPageCard` 是页面级，多浏览器会产生多个 slot。

此前 `groupIssues` 用 `sorted.length`（页面数）填 `affectedSteps`，导致首屏同时出现 26 / 16 / 24 三个数——客户第一屏就发现对不上账。

规则：

- `CustomerPageCard.slotCount` = 该页 slot 数
- `CustomerIssueGroup.affectedSteps` = 成员 `slotCount` 求和
- 差额由 `model.accounting.ungroupedSteps` 承接，且**必须在对账句里写明去处**（当前为被 `hasVisibleDifference` 过滤掉的 0.00% 差异），不允许静默消失

### 8.3 结论动词必须与发版建议同源

`buildHeadline` 与 `deriveShipAdvice` 不得各说各话。此前标题写「无需处理」、副标题写「建议业务确认」，同一屏自相矛盾。

现在 `buildHeadline` 内部直接调用 `deriveShipAdvice`：advice 为 `confirm` 时标题只能是「建议确认后发布」，为 `baseline` 时只说覆盖不足。断言见 `verify-customer-report-html.ts` 的「结论标题动词不与发版建议冲突」。

### 8.4 变化性质标签必须与结论同源

此前卡片标签取「第一个区域」的 `nature`，而结论文案取 `evidence.reason`，两者可能完全不同（标签写「内容变化」、结论写「只是整体挪了约 9px」）。

现在统一由 `CustomerIssueGroup.natureLabel` 提供：`actionableRegions === 0` 时输出「位置偏移 / 显示差异」，否则输出主导性质；区域性质未知时回落 `evidence.dominantNature`，仍未知用中性词「有变化」，**不再武断写「内容变化」**。

### 8.5 passRate 已去掉粉饰

`passRate` 原为 `(pass + minor) / compared`，26 处差异也能显示 100%。现改为 `(pass + benign) / compared`，即「完全没有实质变化的占比」。飞书通知与多维表的「UI 通过率」会随之下降，这是预期修正，不是回归。
