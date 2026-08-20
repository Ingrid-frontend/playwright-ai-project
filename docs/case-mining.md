# 用例挖掘（骨架）

从历史失败包归纳「该补哪些断言 / 加固定位」的草稿，**不自动入库、默认不调 LLM**。

```bash
npm run mine:cases
npm run mine:cases -- --root=results/intent-runs
```

产物：`results/mined-cases/suggestions.md`

后续可扩展：读 OpenAPI schema 造边界数据、从飞书/缺陷单反推断言。当前仅消费本仓库 `failure-bundle.json`。

边界见 [ai-test-boundaries.md](./ai-test-boundaries.md)。
