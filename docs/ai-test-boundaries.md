# AI / 框架 / 人：职责边界

主线：**AI 负责生成、探索、自愈；测试框架负责断言、回归、门禁；人负责定预期、判关键。**

## 三角色

| 角色 | 做什么 | 不做什么 |
|------|--------|----------|
| AI | NL→Intent、Explore、步骤自愈、视觉 triage | 不改写 assert 期望；不当唯一门禁；不自动合并关键用例 |
| 框架 | 结构化断言、像素/结构/样式 diff、`--gate`、CI | 不把「生成通过」当成「业务通过」 |
| 人 | 写/审 expect、Promote Golden、关键路径 review | 不依赖 AI 口头判成功 |

## Intent YAML 约定

| 字段 | 默认 | 说明 |
|------|------|------|
| `reviewRequired` | `false` | 支付/权限/数据销毁等关键路径：试跑通过后仍须人审再入库 |
| `trustLevel` | `trial` | 人设可信度：`trial` / `stable` / `watch`；运行会写建议值，不覆盖人设 |

示例：

```yaml
name: 审批列表页可见
reviewRequired: false
trustLevel: trial
env: stage
entry: /main/approve
steps:
  - id: assert-list
    action: assert
    kind: text
    expect: 我的审批
```

## 硬规则

1. **断言预期人定**：`assert` / `assertions` 只写可见原文或结构化 expect；叙述句会被校验拒绝。
2. **assert 永不自愈**：运行时禁止 heal 改写期望；自愈建议补丁也只允许改 click/fill/select 的描述或 value。
3. **AI 视觉结论默认不进硬门禁**：`config/ui-regression.json` → `aiReview.failOnUiBug` 默认 `false`。
4. **生成通过 ≠ 入库**：口语试跑通过后须「转为 YAML」并人工确认；`reviewRequired: true` 时合并前必须人过目。
5. **自愈写回须人合并**：`heal-suggest.*` 只是建议；`--apply` 显式执行，且不会改 assert。

## 闭环

```text
AI 生成 / Explore → intent:run（可 heal）→ 失败包 + heal-suggest
                              ↓
                    人审补丁 / 改 YAML → 入库 definitions
                              ↓
              截图 / style / structure gate → CI
                              ↓
                    trust 记录（升权 / 降权告警）
```

## 相关命令

| 命令 / 入口 | 作用 |
|------|------|
| Studio → YAML 用例 | 运行后展示 trust / heal-suggest；「应用已采纳补丁」「可信度」 |
| `npm run intent:run -- --intent=...` | 执行 Intent（默认 heal on；assert 除外） |
| `npm run heal:suggest -- --run=<dir>` | 从运行产物生成/查看自愈建议补丁 |
| `npm run heal:suggest -- --run=<dir> --intent=... --apply` | 人确认后写回非 assert 字段 |
| `npm run trust:report` | 查看 Intent 可信度与告警 |
| `npm run mine:cases` | 从失败历史挖用例建议（骨架） |
