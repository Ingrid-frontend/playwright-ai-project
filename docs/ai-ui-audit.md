# AI UI 审计（Layer 1 单图审计）

## 为什么需要这一层

现有 UI 回归链路解决的是「**这两张图的像素有没有变化**」，需要基线才能工作：

| 现有能力 | 局限 |
|---|---|
| `compare-screenshots`（pixelmatch） | 无基线 → 无法判断；像素没变但 UI 已坏 → 漏检 |
| `ui-issue-ai-review`（Claude Vision） | 只复审 pixelmatch **已标记**的 issue，需要基线 + diff 图 |

这一层解决的是「**UI 有没有发生有意义的衰退**」：不依赖基线，对**单张截图**做结构化审计。

两层关系：

- **Layer 1（本模块）**：AI 单图审计 —— 无基线也能发现溢出、遮挡、截断、错位、元素缺失
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
└── ui-audit.ts            # 入口：扫描 png+meta 配对 → 分析 → 报告

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

# 5) CI 卡口：存在「需修复」时退出码 1
npm run ui-audit -- --gate
```

### 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--dir` | `screenshots` | 扫描根目录 |
| `--limit` | `12` | 最多审计多少张（按 mtime 倒序，优先最近） |
| `--out` | `results/ui-audit` | 报告输出目录 |
| `--script` | — | 按 scriptKey 子串过滤 |
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
| **无基线**，想知道「这一屏 UI 是否已坏」 | **`npm run ui-audit`（本模块）** |

## 后续演进

- **P1**：把 `selectors` 检查项覆盖到更多脚本，减少 ⚪ 未审计占比（当前 94/100 缺依据）
- **P2**：把 Layer 2 的 `changedBox` 作为 bbox 提示注入 prompt，提升定位精度
- **P3**：Test Intent → 动态生成 Playwright 脚本
- **P4**：把审计结论接入飞书通知与 CI 卡口
