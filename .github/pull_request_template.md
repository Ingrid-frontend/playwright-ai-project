## Summary

<!-- 简述本次改动的目的与范围 -->

## Test plan

- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 无新增 warning
- [ ] 相关 flow 本地运行通过（如适用）

## Checklist

- [ ] 是否影响 golden 种子数据（`*/datasource/golden-seeds.json`）
- [ ] 是否涉及交付链路（`report:customer` / `deliver:feishu` / 飞书多维表）
- [ ] 是否需要更新文档（`docs/` 索引）

## 审查要求

涉及以下**关键路径**变更时，需 **2 人审查**通过后合并：

- 交付链路（客户报告、飞书写入、多维表 schema）
- Golden 回归与稳定性门禁（`flow:flake-check`、golden runner、种子数据）

紧急修复可先合并并标记 `hotfix`，24h 内补审查。
