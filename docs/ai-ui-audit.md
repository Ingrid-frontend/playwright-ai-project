# AI UI 审计（Layer 1 单图审计）

## 为什么需要这一层

现有 UI 回归链路解决的是「**这两张图的像素有没有变化**」，需要基线才能工作：

| 现有能力 | 局限 |
|---|---|
| `compare-screenshots`（pixelmatch） | 无基线 → 无法判断；像素没变但 UI 已坏 → 漏检 |
| `ui-issue-ai-review`（Claude Vision） | 只复审 pixelmatch **已标记**的 issue，需要基线 + diff 图 |

这一层解决的是「**UI 有没有发生有意义的衰退**」：默认对**单张截图**做结构化审计；若提供 Figma 设计稿，则以设计稿为基准做双图对比。

两层关系：

- **Layer 1（本模块）**：AI 审计 —— 无截图基线也能发现溢出、遮挡、截断、错位、元素缺失；有 Figma 稿时再对照设计稿
- **Layer 2（既有）**：pixelmatch 精确变更检测 —— 回答「哪里变了」，作为辅助输入而非最终裁判

## 数据来源：复用既有 sidecar

**不新增采集器**。项目在截图时已写出同名 `.meta.json` sidecar（由 `structure-check.ts` 定义的 `StepMeta`），本模块直接消费：

```
screenshots/<scriptKey>/run-<browser>/<timestamp>/step-01-xxx.png
screenshots/<scriptKey>/run-<browser>/<timestamp>/step-01-xxx.meta.json  ← 输入
```

sidecar 提供 AI 所需的四段输入中的三段：

| 字段 | 用途 |
|---|---|
| `viewport` / `imageWidth` / `imageHeight` | 坐标换算基准 |
| `selectors[].exists` / `.bbox` | 元素几何 + 缺失判定 |
| `layout.horizontalOverflow` / `scrollWidth` / `innerWidth` | 横向溢出 |
| `consoleErrors` / `pageErrors` | 运行时错误 |
| `textSections` / `url` / `title` | DOM 摘要与页面上下文 |

## 文件结构

```
scripts/report/
├── ui-audit-schema.ts     # 数据契约：类型/severity 映射/四态结论/归一化
├── ui-audit-prompt.ts     # 4 段式 prompt + 严格 JSON 输出契约
├── ui-audit-analyzer.ts   # mock 规则分析 + Claude Vision 调用 + 降级
├── ui-audit-report.ts     # HTML 报告 + bbox 标注框
├── ui-audit.ts            # 入口：扫描 png+meta 配对 → 分析 → 报告
└── figma-baseline.ts      # Figma URL 解析 / 配置匹配 / 导出图拉取

config/
└── figma-baselines.json   # 可选：script/step → Figma URL 映射
└── ui-audit-rules.json    # 可选：script/step → 业务白名单（不算缺陷）

scripts/verify/
└── verify-ui-audit.ts     # 全链路验证（无需 API Key）
```

## 快速开始

```bash
# 1) 无 Key 验证全链路（造 fixture，跑完自动清理）
npm run ui-audit:verify

# 2) mock 规则分析（无 Key 时自动进入）
npm run ui-audit -- --limit=8

# 3) AI 视觉分析（OpenAI 兼容接口）
export AI_API_KEY=sk-xxx
export AI_BASE_URL=https://api.openai.com/v1     # 可选，兼容网关填自己的
export AI_VISION_MODEL=gpt-4o                     # 可选
npm run ui-audit -- --limit=8

# 4) 只审计某个脚本
npm run ui-audit -- --script=审批列表页可见

# 5) 带 Figma 设计稿基准（需 FIGMA_ACCESS_TOKEN；URL 请加引号）
npm run ui-audit -- --figma="https://www.figma.com/design/xxx/name?node-id=12-34"

# 6) 用本地导出的设计稿图（无 Token / 自检）
npm run ui-audit -- --figma-image=path/to/design.png

# 7) CI 卡口：存在「需修复」时退出码 1
npm run ui-audit -- --gate
```

### 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--dir` | `screenshots` | 扫描根目录 |
| `--limit` | `12` | 最多审计多少张（按 mtime 倒序，优先最近） |
| `--out` | `results/ui-audit` | 报告输出目录 |
| `--script` | — | 按 scriptKey 子串过滤 |
| `--figma` | — | Figma 设计稿 URL（需含 `node-id`），本轮所有步骤共用 |
| `--figma-image` | — | 本地设计稿 PNG，不调 Figma API，便于自检 |
| `--gate` | 关 | 有 `fail` 时退出码 1 |

### 环境变量

视觉分析走 **OpenAI 兼容的 `/chat/completions` 接口**（`image_url` + `data:base64` 内联图片），
任何兼容网关都能接：OpenAI、火山方舟、DeepSeek-VL、one-api / new-api 等。

| 变量 | 回退顺序 | 说明 |
|---|---|---|
| `AI_API_KEY` | → `AI_TEST_OPENAI_API_KEY` → `OPENAI_API_KEY` | 启用 AI 视觉分析；全部未设置则自动降级 mock |
| `AI_BASE_URL` | → `AI_TEST_OPENAI_BASE_URL` → `OPENAI_API_BASE` → `OPENAI_BASE_URL` | 接口根地址，默认 `https://api.openai.com` |
| `AI_VISION_MODEL` | → `AI_MODEL` → `AI_TEST_MODEL` → `OPENAI_MODEL` | 视觉模型，默认 `gpt-4o-mini` |
| `AI_AUDIT_MOCK` | — | `1` 强制 mock；`0` 强制真跑 |
| `FIGMA_ACCESS_TOKEN` | → `FIGMA_TOKEN` → `FIGMA_API_TOKEN` | 拉取 Figma 节点导出图；未配置则忽略 `--figma` / 映射，仍走单图审计 |

**回退链的用意**：项目 `.env` 里若已配了 `AI_TEST_OPENAI_*`（供 `src/ai/llm-client.ts` 用），
审计模块直接复用，不必再配一份。只想给审计单独指定模型/网关时，才设 `AI_*` 覆盖。

> ⚠️ 回退链末端的 `AI_TEST_MODEL` 是给文本任务（Intent/NL）配的，**不保证支持图像输入**。
> 若模型不支持视觉，接口会报错，审计自动降级为规则分析并在报告里附一条 info 说明——不会中断流程，
> 但也拿不到真实的 AI 视觉结论。要稳妥就显式设 `AI_VISION_MODEL`。
>
> 实测：火山方舟 `ark-code-latest` 走 `/api/plan/v3` 可正常接受图像并返回结构化审计结果。

`AI_BASE_URL` 的拼接规则复用 `src/ai/llm-client.ts` 的 `buildChatCompletionsUrl`：

| 填入值 | 实际请求 |
|---|---|
| `https://api.openai.com` | `https://api.openai.com/v1/chat/completions` |
| `https://xxx/v1` | `https://xxx/v1/chat/completions` |
| `https://ark.cn-beijing.volces.com/api/plan/v3` | `.../v3/chat/completions` |
| `https://xxx/v1/chat/completions` | 原样使用 |

### Studio 图形入口

不想记命令行参数时，用 studio 面板跑：

```bash
npm run studio          # 默认 http://localhost:3001
```

打开「报告中心 → 截图对比」，页面下方的 **AI UI 审计（Layer 1）** 区块提供：

| 控件 | 对应 CLI |
|---|---|
| 审计张数上限 | `--limit` |
| 脚本过滤 | `--script` |
| Figma 设计稿 URL | `--figma` |
| Gate 模式 | `--gate` |
| 强制 mock 规则分析 | `AI_AUDIT_MOCK=1` |
| 运行 AI UI 审计 | `npm run ui-audit` |
| 打开已有审计报告 | 直接打开 `results/ui-audit/index.html` |
| 取消审计 | SIGTERM 结束子进程 |

审计过程的 stdout 实时回传到 studio 日志区，结束后区块内显示四态徽章（🟢🟡🔴⚪）、总步数、分析模式与报告链接，报告自动在新窗口打开。进入面板时会自动拉取上一次的审计结论。

> Gate 模式命中衰退时子进程退出码为 1，studio 会识别为「审计成功且发现问题」并弹出红色提示，不会误报成执行失败。

实现位置：`pw-files/lib/ui-audit-run.js`（后端）+ `pw-files/public/index.html`（面板与消息处理）；WS 指令为 `ui-audit:run` / `ui-audit:open` / `ui-audit:status` / `cancel:ui-audit`。报告经 `/repo-report/results/ui-audit/index.html` 提供，复用既有静态路由。

## 四态结论

比「通过/失败」多两态，避免把不确定当确定：

| 结论 | 触发条件 | 含义 |
|---|---|---|
| 🟢 `pass` | 有判定依据且无问题 | 通过 |
| 🟡 `review` | 有 `warning` / `noise` | 待人工确认 |
| 🔴 `fail` | 有 `blocker` | 需修复 |
| ⚪ `skipped` | **缺少判定依据** | 未做有效审计 |

### `skipped` 为什么必须存在

mock 规则模式只认识 sidecar 里既有的信号。实测本仓 100 个 sidecar 中**仅 6 个**配了 `selectors`，其余既无选择器也无错误记录。

若把「没检测出问题」当成「通过」，就会产生**假绿**——这正是本模块要消灭的问题。因此无判定依据时一律标 ⚪，并提示启用 AI 视觉分析。

> 注意：`layout.horizontalOverflow === false` 表示「这一项检查过且正常」，**不足以**证明整页健康，故不计入有效信号。

## severity 术语

沿用项目既有 `UiIssueSeverity`，模型返回的 high/medium/low 会自动映射：

| 模型输出 | 项目术语 | 影响结论 |
|---|---|---|
| high / critical | `blocker` | → 🔴 fail |
| medium | `warning` | → 🟡 review |
| low / minor | `noise` | → 🟡 review |
| — | `info` | 不影响结论 |

## 问题类型

`overflow`（溢出）、`occlusion`（遮挡）、`truncation`（截断）、`layout`（错位）、`whitespace`（异常空白）、`component`（控件渲染异常）、`missing-element`（关键元素缺失）、`console`（运行时报错）、`other`。

Prompt 中明确禁止：审美评价、业务逻辑猜测、把正常动态数据（时间/数字/头像）当缺陷。

## 报告标注

`bbox` 使用**视口坐标系**，报告按百分比定位，随图片缩放自适应：

```
缩放比 scale = imageWidth / viewportWidth
left% = (bbox.x * scale) / imageWidth * 100
```

这样 `fullPage` 截图（图高 > 视口高）也不会纵向错位。完全落在图外的框会被丢弃，避免误导。

## 输出产物

```
results/ui-audit/
├── index.html      # 带标注框的可视化报告
├── summary.json    # 结构化结论（可供 CI / 飞书通知消费）
└── assets/         # 截图副本，保证报告可独立分享
```

`summary.json` 结构：

```json
{
  "generatedAt": "...", "mode": "mock|ai",
  "total": 8, "pass": 0, "review": 0, "fail": 0, "skipped": 8,
  "steps": [{ "scriptKey": "...", "stepName": "...", "verdict": "...", "score": 0, "issues": [] }]
}
```

## 容错设计

- 无 `AI_API_KEY`（及回退链）→ 自动降级 mock，不报错中断
- AI 调用失败 / 返回非 JSON → 降级 mock 结果 + 附一条 `info` 说明失败原因
- 截图不可读或超 4.5MB → 降级 mock + `info` 说明
- 单步失败不影响其余步骤，整体流程始终产出报告

## 与既有能力的分工

| 场景 | 用哪个 |
|---|---|
| 有基线，想知道「哪里变了」 | `npm run compare-screenshots` |
| 有基线 + diff，想复审「变化是否真缺陷」 | `ui-issue-ai-review`（既有） |
| **无截图基线**，想知道「这一屏 UI 是否已坏」 | **`npm run ui-audit`（本模块）** |
| **有 Figma 设计稿**，想知道「实现是否偏离设计」 | **`npm run ui-audit -- --figma=...`（本模块）** |

## Figma 设计稿基准

默认行为不变：不传设计稿时仍是单图审计。

提供设计稿的三种方式（优先级从高到低）：

1. `--figma-image=<png>`：本地导出图，不调 Figma API
2. `--figma=<url>` / Studio 输入框：本轮所有步骤共用同一节点
3. `config/figma-baselines.json`：按 `script` 子串匹配，可再按 `step` 收窄

`figma-baselines.json` 可由 `npm run figma:export-helios` 从 `config/helios-audit-bindings.json` 自动合并生成。

## Helios Design System 规范打通

设计规范与 AI 审计三层接入：

| 配置 | 作用 |
|------|------|
| `config/helios-design-tokens.json` | 颜色/字体 Token（`figma:export-helios` 导出） |
| `config/helios-design-catalog.json` | 全量 81 页索引 |
| `config/helios-component-catalog.json` | **桌面端**可 sync 目录（A+C+基础，排除 B 移动端） |
| `config/helios-audit-bindings.json` | script/step → Figma 节点 + 布局约束 |
| `config/figma-baselines.json` | 审计时自动拉取设计稿 PNG |

### 同步设计规范

```bash
# 1) 导出 Token + 目录 + figma-baselines 映射（需 Token，偶尔跑）
npm run figma:export-helios

# 2) 拉取设计稿 PNG 到本地缓存（需 Token，设计稿更新时手动跑）
npm run figma:sync-baselines                              # 仅审计映射（request-flow 等）
npm run figma:sync-baselines -- --list                    # 查看桌面端全量组件目录
npm run figma:sync-baselines -- --catalog --code A06      # 按需 sync 单个组件
npm run figma:sync-baselines -- --catalog --all-desktop   # sync 全部桌面目录（不含 B 移动端）
# 强制覆盖：加 --force

# 3) 审计（只读本地缓存 + Helios 规范，不需要 Token）
npm run ui-audit -- --script=flows/request-flow --limit=8
```

设计稿 PNG 缓存在 `screenshots-baseline/figma/images/`，清单在 `manifest.json`。**审计不会访问 Figma API**；缓存缺失时跳过双图对比并提示运行 `figma:sync-baselines`。

审计 prompt 会多出 **【Helios 设计规范】** 段落；`summary.json` 含 `helios` 字段统计已注入规范的步骤数。

```json
{
  "mappings": [
    {
      "script": "intent/dev/审批列表页可见",
      "figmaUrl": "https://www.figma.com/design/FILEKEY/name?node-id=12-34"
    }
  ]
}
```

约束：

- URL 必须带 `node-id`（指向具体 Frame/节点，不能只给文件链接）
- **拉取设计稿 PNG** 需 `FIGMA_ACCESS_TOKEN`，通过 `npm run figma:sync-baselines` 一次性写入本地；**日常审计不访问 Figma API**
- 本地缓存路径：`screenshots-baseline/figma/`（`images/*.png` + `manifest.json`）
- 缓存缺失 → 打警告并回退单图审计，不中断
- mock 模式看不了图：即使给了 Figma，无规则信号时仍是 ⚪ skipped，不会假绿
- 对比只报结构/层级/关键区块的有意义偏差，不把动态数据与设计稿占位差异当缺陷

## 业务白名单（修正误报）

AI 把「设计如此 / 规范允许」报成 `truncation` / `layout` / `overflow` / `occlusion` 时，在 `config/ui-audit-rules.json` 声明**不算缺陷**：

```json
{
  "rules": [
    {
      "script": "approve",
      "step": "返",
      "expect": [
        "单号列省略号截断是列宽规范，不要报 truncation",
        "行左侧角标与展开按钮布局与 Figma 一致，不要报 layout",
        "右侧 AI 入口贴边裁切是产品设计，不要报 overflow",
        "开发/调试悬浮钮不计入 occlusion"
      ],
      "dropNoiseBelow": 0.55
    }
  ]
}
```

| 字段 | 作用 |
|---|---|
| `script` | 匹配 `scriptKey` 子串 |
| `step` | 可选，匹配步骤名/步号 |
| `expect` | 写入 prompt【业务期望】，让模型别报 |
| `dropNoiseBelow` | 后处理：丢弃低于该置信度的 `noise` / `warning`（`blocker` 不丢） |
| `dropTypes` | 后处理：丢弃指定类型 |
| `dropPatterns` | 后处理：描述含子串则丢弃 |

开发工具悬浮钮：白名单 + 截图前用 `config/ui-regression.json` 的 `maskSelectors` 遮掉更干净。

## 后续演进

- **P1**：把 `selectors` 检查项覆盖到更多脚本，减少 ⚪ 未审计占比（当前 94/100 缺依据）
- **P2**：把 Layer 2 的 `changedBox` 作为 bbox 提示注入 prompt，提升定位精度
- **P3**：Test Intent → 动态生成 Playwright 脚本
- **P4**：把审计结论接入飞书通知与 CI 卡口

## Change Log

### 2026-08-28

- 桌面端全量组件目录：`helios-component-catalog.json`（排除 B 移动端），`figma:sync-baselines --catalog` 按需 sync
- Figma 设计稿改为本地持久缓存：`screenshots-baseline/figma/`，`npm run figma:sync-baselines` 手动同步
- 审计默认只读本地缓存，不再每次请求 Figma API
- Helios Design System 与 AI 审计打通：`figma:export-helios` 导出 Token/目录并合并 `figma-baselines.json`
- 新增 `helios-audit-bindings.json`：request-flow 各 step 的布局约束 + Figma 节点映射
- 审计 prompt 注入【Helios 设计规范】；`summary.json` 增加 `helios` 计数
- `ui-regression.json` 为 `flows/request-flow` 补充 structureChecks 选择器

### 2026-08-24

- AI UI 审计支持可选 Figma 设计稿基准：`--figma` / `--figma-image` / `config/figma-baselines.json` / Studio 输入框
- 有稿时视觉模型收两张图（设计稿 + 实际页），并增加 `design-mismatch` 类型
- 无稿、无 Token、拉取失败时回退原单图审计，不中断
- mock 模式即使给了 Figma 也不改 skipped 结论，避免假绿
- `config/ui-audit-rules.json`：业务白名单 + `dropNoiseBelow` 后处理误报
- 是否影响旧逻辑：否（默认仍是单图审计）
- 是否影响默认行为：否
