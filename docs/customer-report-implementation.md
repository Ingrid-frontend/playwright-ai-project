# 客户版 UI 衰退报告 · 实现说明（内部）

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

1. **autoPromote 会吃掉小差异**：`flow-shared.ts` 的 `autoPromote.maxDiffRatio` 默认 0.005，会把 0.1–0.5% 的差异自动覆盖进基线。需要人工把关时设 `AUTO_PROMOTE_BASELINE=0`
2. **未检测占比偏高**（当前 25/41）：多为 before/skipped 过程截图与未固化基线，需要按业务重要性逐步 promote
3. `verify-customer-report-html.ts` 的断言与文案强耦合，改首屏措辞时同步更新正则
