# 交付冻结范围 · 2026-09（Stage9084）

> 索引：[docs/README.md](./README.md)

> 生效日期：2026-09-10  
> 验收环境：**Stage9084**（`--env=stage9084`）  
> 业务范围：`request-flow` + `approval-flow`

---

## 1. 交付定义（DoD）

以下 **6 条全部满足**即视为本次交付完成：

| # | 条件 | 验收 |
|---|------|------|
| 1 | standalone 归档物 | `npm run report:customer:standalone -- --env=stage9084` → `results/ui-regression-customer-stage9084.standalone.html` |
| 2 | 首屏数字自洽 | `npx tsx scripts/verify/verify-customer-report-html.ts --report=results/ui-regression-customer-stage9084.html`；`regressionDisplay.length` ≤ `regressionGroups.length` |
| 3 | 三门禁全绿 | `npm run smoke && npm run typecheck && npm run lint`（lint 0 error） |
| 4 | 无内部术语 / 租户泄漏 | verify 断言 + 人工扫一眼 |
| 5 | 飞书交付 | `deliver:preview` → `deliver:feishu --env=stage9084`；`verify:customer-delivery --env=stage9084` |
| 6 | Golden 有实际数据 | `request-flow:golden` + `approval-flow:golden`（stage9084），非全跳过 |

客户主交付形态：**飞书文档 + UI 验收明细多维表**（见 [feishu-customer-delivery.md](./feishu-customer-delivery.md)）。standalone HTML 作内部归档。

---

## 2. IN-SCOPE（已交付设计）

- `customer-report-bundle`：公共布局衰退合并为首屏一条（`regressionDisplay`）
- ImpactTier 三档、AI 审计结论注入、资产脱敏与脚本令牌化
- P0 收口：移除运行间 trend-hint（B3）、客户文案术语清洗（A9）

---

## 3. NOT-DOING（本次不做）

- G4 交互出口（签字区 / 转工单 / 接受新基线按钮）
- H3 具象化换算、H5 **新增**交付形态（PDF/静态 URL 等）
- `page-change-detection-design.md` 全部（元素指纹、乐观锁、表拆分）
- Firefox / mobile 三引擎、expense-flow 扩面、Studio 新功能
- `isChromeLayoutRegion` / `buildRegressionDisplay` 单测补全
- 无 `--env` 的多环境混报直接交付

---

## 4. POST-DELIVERY

- E1 三段式文案、E2 AI 结论剩余、G1 问题优先 + 证据折叠
- F3 质量覆盖率、F5 趋势微视图、B7 新增/遗留标签、E4 跨环境归因
- 脚本瘦身、`public-reports/` 深度清理、CI 全仓 lint 硬门禁

---

## 5. 冻结规则（交付前 48h）

1. 禁止递增 `DIFF_NATURE_VERSION`（当前 **8**）
2. 禁止改动 `customer-report-bundle` 合并逻辑（只修 verify 失败）
3. 只修 smoke / verify / lint 报出的错，不修「看起来更好」
4. 新想法写入 §4 POST-DELIVERY，不当场实现

---

## 6. 交付记录

| 字段 | 值 |
|------|-----|
| releaseTag | v1.0.0 |
| env | stage9084 |
| docUrl | https://feishu.cn/docx/DsZ6dI03Aoeztnxek5mc46rgn4K |
| bitable tableId | tblTH1Lf7iqBoGEc |
| 明细条数 | 20 新增 / 0 更新 |
| 图片上传 | 53 新传 + 7 缓存复用，失败 0 |
| standalone 归档 | `results/ui-regression-customer-stage9084.standalone.html` |
| 日期 | 2026-09-10 |
