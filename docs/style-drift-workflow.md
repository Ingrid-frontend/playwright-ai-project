# Style-Drift 样式守护工作流

本文档是 **Style-Drift UI 样式衰退检测** 的唯一记录入口。像素 diff 仍可用于 Visual Review 附件，但 **Gate 默认仅 style-drift + required structure**。

## 核心路径

```
YAML Intent → pw 执行 → 截图 + styleFingerprint(.meta.json)
  → compare-screenshots → Golden 基线对比 → 报告三档 triage
```

| 概念 | 说明 |
|------|------|
| 逻辑键 | `snapshotName` + `state`（写在 `.meta.json`） |
| 物理文件 | `step-{n}-{snapshotName}__{state}.png` |
| Gate | `config/ui-regression.json` → `gate.mode: style-only` |
| 基线 | `screenshots-baseline/{scriptKey}/run-chromium-optimized/` |

## 快速开始（Mock，无需登录）

```bash
# 1. 写入 Golden 基线
npm run style:seed-mock

# 2. 跑 mock intent + gate 对比
npm run style:compare:mock

# 3. 打开报告
npm run open-screenshot-report:only
```

Studio：`npm run studio` → **YAML 用例** Tab → 选择 `style-drift-mock.yaml` → **样式守护全流程**。

Studio Tab 与口语试跑说明见 [studio-yaml-and-nl-workflow.md](./studio-yaml-and-nl-workflow.md)。

## Intent YAML 约定

```yaml
scriptKey: mock/style-drift-demo
styleChecks:
  - key: primary-btn
    selector: "#primary-btn"
    props: [backgroundColor, color, fontSize, borderRadius]
    required: true
steps:
  - action: screenshot
    snapshotName: mock-list
    state: normal
```

- `{repoRoot}` 在 `run-intent.ts` 执行前展开为仓库绝对路径
- 默认引擎：**pw**（`--engine=ego` 可切回 ego）
- `--compare` / `--gate` 可在 CLI 跑完 intent 后自动对比

## npm scripts

| 命令 | 作用 |
|------|------|
| `style:run` | Intent + pw（需 `--intent=`） |
| `style:run:mock` | 跑 mock 定义 |
| `style:seed-mock` | mock 跑完 promote Golden |
| `style:compare:mock` | mock + gate 对比 |

## 报告三档 Triage

| 档位 | 规则（摘要） |
|------|----------------|
| **confirmed** | `style-drift` blocker；或 Visual Review 判 ui_bug |
| **pending** | structure blocker / 其他 warning |
| **ignored** | run-drift、likely_noise、非 required missing-selector |

汇总写入 `results/ui-issues.json` → `summary.triage`。

## 配置要点

`config/ui-regression.json`：

- `compareRunDrift: false` — 跳过 run-drift
- `baselineStrategy: golden`
- `gate.mode: style-only` — 像素 diff 不进 gate
- `styleChecks.enabled: true` — 按 `script` 字段匹配 scriptKey

## Change Log

| 日期 | 变更 |
|------|------|
| 2026-08-18 | 初版：style 指纹采集、style-drift-check、gate style-only、mock 全流程、Studio YAML 用例 Tab 内样式守护 |
