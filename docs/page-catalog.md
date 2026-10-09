# page-catalog：全站页面清单

> 索引：[docs/README.md](./README.md)

`datasource/page-catalog.json` 是由爬虫自动发现、人工可标注的全站页面清单，是 Smoke 巡检（P1）与用例生产（P2）的页面来源。

## 生成与更新

```bash
npm run catalog:crawl -- --env=stage          # 实爬全站菜单 + 静态底册合并
npm run catalog:crawl -- --env=dev --limit=5  # 限爬前 5 项（调参用）
npm run catalog:crawl -- --only=request       # 只爬指定页（id/label 模糊匹配）
npm run catalog:crawl -- --static-only        # 不开浏览器，仅静态底册合并（CI 校验用）
```

登录态与 Golden 同源（storageState）。落在登录页时实爬中止并回退静态种子，结果以 `verify` 字段区分。

## 数据来源（三源合一）

| source | 含义 |
|---|---|
| `menu-crawl` | 侧栏菜单实爬（展开分组 → 逐项点击 → 记录 zoom iframe 落地路由） |
| `route-table` | 静态底册 `datasource/menu_routes.json` + `menu_items.json` 兜底 |
| `manual` | 人工维护条目（合并时原样保留，爬虫不删除） |

## 关键字段

- `verify`：`ok`（本轮实爬落地成功）/ `partial`（点击但未取到新路由）/ `unseen`（本轮未出现）/ `unverified`（仅静态种子）
- `status`：`active` / `retired`（人工标记；retired 不参与 smoke 与入口解析）
- `smoke.weight`：`core`（三个 Golden 入口默认）/ `normal`
- `smoke.keyElements`：关键元素清单（P1 的 `catalog:suggest-key-elements` 可生成建议，`keyElementsAiSuggested: true` 待人审）
- `suspectDuplicateOf`：同路由不同名的疑似重复（人工裁决后可删或改 status）
- `listApiHint`：实爬时自动发现的列表类 POST 接口（形状判定：数组 + 分页字段）

## 合并规则（重跑安全）

- 按 `route` 完全一致自动合并；同名不同 route 只标注不合并
- 人工标记（`status` / `smoke.enabled` / `smoke.weight` / `smoke.keyElements` / `goldenFlowId`）人工优先，重爬不覆盖
- 旧条目本轮未出现 → 保留并标 `unseen`，不自动删除

## 消费方

- `scripts/flow/resolve-flow-entry.ts` 的 `loadMenuMaps()`：page-catalog 优先于静态底册，`flow:new` 自动受益
- P1 `scripts/smoke/run-smoke-patrol.ts`：巡检范围 = `smoke.enabled && status=active`
- P2 `scripts/ai/batch-explore.ts`：初稿生产范围 = `weight=core`
