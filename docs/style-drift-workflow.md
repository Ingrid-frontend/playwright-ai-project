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

## 快速开始

```bash
# 1. 跑 intent + gate 对比
npm run style:run -- --intent=tests/definitions/xxx.yaml
npm run compare-screenshots -- --gate

# 2. 打开报告
npm run open-screenshot-report:only
```

Studio：`npm run studio` → **YAML 用例** Tab → 选择 `YAML 定义` → **样式守护全流程**。

Studio Tab 与口语试跑说明见 [studio-yaml-and-nl-workflow.md](./studio-yaml-and-nl-workflow.md)。

## Intent YAML 约定

```yaml
scriptKey: your/script-key
styleChecks:
  - key: primary-btn
    selector: "#primary-btn"
    props: [backgroundColor, color, fontSize, borderRadius]
    required: true
    snapshotName: your-snapshot   # 仅在该 snapshot 截图上采集/对比
steps:
  - action: screenshot
    snapshotName: your-snapshot
    state: normal
```

- `{repoRoot}` 在 `run-intent.ts` 执行前展开为仓库绝对路径
- 默认引擎：**pw**（`--engine=ego` 可切回 ego）
- `--compare` / `--gate` 可在 CLI 跑完 intent 后自动对比
- **optimized spec** 也可通过 `config/ui-regression.json` 的 `styleChecks.items`（按 `script` 匹配）守护样式，无需 YAML

## 真实页面（我的审批）

`stage/260612/我的审批_2026-06-09_16-48-19` 已配置 5 项设计系统级 `styleChecks`（主按钮、表头、页签选中、输入框、主文案），作用域 `snapshotName: approval-list`、`frame: first`（iframe 内）。

```bash
# 跑 optimized 用例并截图
npx playwright test tests/optimized/stage/260612/我的审批_2026-06-09_16-48-19.optimized.spec.ts --project=optimized

# promote approval-list Golden（文件名含路由后缀时按实际 PNG 名）
npx tsx scripts/report/promote-baseline.ts \
  --script='stage/260612/我的审批_2026-06-09_16-48-19' \
  --latest \
  --step='step-2-approval-list__normal__main_approve.png'

npm run compare-screenshots -- --gate
```

## 检查项作用域

`structureChecks` / `styleChecks` 的 `items` 支持可选字段：

| 字段 | 说明 |
|------|------|
| `snapshotName` | 仅在该逻辑快照上采集指纹与对比；不传则对所有 step 生效 |
| `state` | 与 `snapshotName` 组合；不传则匹配任意 state |

用于避免「首页尚无表格却在 step-1 报 missing-selector」等作用域错误。

## 容差

`styleChecks.tolerance`：

| 字段 | 默认 | 说明 |
|------|------|------|
| `fontSizePx` | `0` | 字号 px 绝对差；`0` 为严格相等 |
| `colorDelta` | `3` | `#RRGGBB` RGB 欧氏距离；`#1677FF` vs `#1678FF` 在阈值内 |

颜色属性：`backgroundColor`、`color`、`borderColor`（归一化 hex 后比较）。

## npm scripts

| 命令 | 作用 |
|------|------|
| `style:run` | Intent + pw（需 `--intent=`） |
| `compare-screenshots -- --gate` | Golden 基线对比 + 门禁 |

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
- `styleChecks.tolerance.colorDelta` — 颜色 RGB 距离容差（已实现）

## Change Log

| 日期 | 变更 |
|------|------|
| 2026-08-18 | 真实页面：`我的审批` 5 项 styleChecks + `approval-list` Golden；`snapshotName`/`state` 检查项作用域；`colorDelta` 实现；iframe 页 promote 质量校验（样式指纹+selector 兜底）；mock YAML 补 `snapshotName` |
| 2026-08-18 | 初版：style 指纹采集、style-drift-check、gate style-only、mock 全流程、Studio YAML 用例 Tab 内样式守护 |
