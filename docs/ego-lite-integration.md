# ego lite 集成

ego lite 是 Chromium 内核浏览器，Agent 在独立 task space 中操作，**默认继承当前用户的登录态**。

本项目把 ego 定位为 **AI 驱动测试体系里的智能执行层**，不是 Playwright 的替代品。

## 四层架构

```text
Studio / CLI
    │
    ▼
项目内 LLM（completeJson / heal）
    │
    ▼
ego-browser（Snapshot / click / fill / Space）
    │
    ▼
目标业务系统
```

并行保留：

| 类型 | 入口 | 引擎 |
| --- | --- | --- |
| 稳定回归 / CI 大规模 | `tests/optimized/**/*.spec.ts` | Playwright（`test:ci` 不变） |
| 易变流程 / 语义验收 | `tests/definitions/*.yaml` | 项目内 LLM + ego Snapshot（默认） |
| 口语试跑 → 沉淀 YAML | Studio **口语试跑** Tab → **转为 YAML 用例** | LLM + 临时 pw 脚本 |
| 选择器体检 | `ego:audit` / 口语试跑可选体检 | ego（旁路，不改执行路径） |

Studio 两个编辑器 Tab 的说明见 [studio-yaml-and-nl-workflow.md](./studio-yaml-and-nl-workflow.md)。

## 双模式

### Explore（探索）

```bash
npm run ego:explore -- --goal="进入审批列表" --entry=/main/approve --env=stage
```

1. 在命名 Space（默认 `explore:<goal>`）里用 Snapshot 代操
2. 落盘语义轨迹（**不含 `@N` / CSS**）到 `results/ego-explore/<run>/`
3. 项目内 LLM 压缩为 Intent YAML 预览
4. Studio / CLI 确认后再写入 `tests/definitions/`

### Regression（回归）

```bash
npm run intent:run -- --intent=tests/definitions/approval-smoke.yaml
# 默认 --engine=ego；回退 Playwright：--engine=pw
```

固定的是 Test Definition（YAML）；动态的是运行时对 Snapshot/`@N` 的解析。

断言由程序判定（Snapshot / 可见文本），**禁止**让模型口头说「我认为成功了」。`assert` 步骤禁止 heal 改写期望文案。

截图写入：

```text
screenshots/intent/<env>/<intent-name>/run-chromium-<stamp>/step-NN-<id>.png
```

可被现有 `compare-screenshots` / Golden promote 扫描（与 optimized 同管线）。

## Snapshot 约定

- 页面导航、Dialog、表单提交、重大重渲染后重新 Snapshot
- **不要把 `@N` 存进 YAML**；YAML 只写语义（如「点击审批」）
- 尽量在一次 `ego-browser nodejs` 脚本里连续执行多步，减少往返

### snapshotText 真实格式

`snapshotText()` 返回**缩进树**，可访问名有两种落点：写在同一行引号里，或写在更深缩进的子 `text` 行。`[ref=N, loc=…, url=…]` 之后全是元数据，不参与 role / name 解析。

```
root
  anchor [ref=8, loc=href:/page.html#list, url=http://127.0.0.1:8799/page.html#list]
    text "审批列表"          ← 名称在子 text 行
  textbox "姓名" [ref=1, loc=css:input[aria-label="姓名"]]
                             ← 名称在同一行
  checkbox [ref=4, loc=unstable]
  text "同意"                ← 无名控件由紧邻同级 text 兄弟做标签
```

role 词表与 ARIA 不完全一致：链接是 `anchor`（不是 `link`），图片是 `image`，另有 `container` / `table_row` / `table_cell` / `unordered_list` / `list_item`。新增 role 过滤时以真实 snapshot 为准，别照搬 ARIA 名。

解析实现在 `src/runtime/ego-snapshot.ts`，离线回归在 `scripts/verify/verify-ego-snapshot.cjs`（fixture 必须用真实格式，否则解析缺陷会被掩盖）。

## Space 命名

| 场景 | Space 名 |
| --- | --- |
| Intent 回归 | `intent:<name>` |
| Explore | `explore:<goal 短名>` |
| 选择器体检 | `audit selectors <spec basename>` |

## 已接入：选择器体检

```bash
npm run ego:audit -- tests/optimized/stage/260814/studio-unsaved-draft.optimized.spec.ts
```

它做三件事：

1. 解析 optimized spec 中每个步骤的定位链
2. 在 ego lite 已登录页面里逐 frame 复算每条链的匹配数
3. 按健康 / 未匹配 / 多重匹配 / 存在但不可见输出

详见下方选项与退出码（与历史行为一致）。

### 选项

| 选项 | 说明 |
| --- | --- |
| `--url=<path 或 url>` | 体检页面，默认取 spec 里的 `page.goto` 目标 |
| `--env=<env>` | 解析 baseURL 用的环境名，默认 `stage` |
| `--json=<file>` | 结果写入 JSON |
| `--settle=<sec>` | 页面加载后额外等待秒数，默认 3 |
| `--keep-tab` | 体检后保留 task space 与页面 |

### 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 无必经步骤断裂 |
| 1 | 有必经步骤定位失败 |
| 2 | ego lite 不可用 |
| 3 | task space 被用户接管 |
| 4 | ego lite 中该环境尚未登录 |

## 前置条件

1. 安装并启动 ego lite，确保 `ego-browser` 在 PATH 中
2. 在 ego lite 里手动登录一次目标环境
3. 不要在沙箱内运行

## 离线校验

```bash
node scripts/verify/verify-ego-selector-probe.cjs
```

## 后续（本期不做）

- 官方 Experience 经验库复用
- 用 ego 替换全部 optimized CI
- 被动完整录制人类每一次 pointer 事件
