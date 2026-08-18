# Studio：YAML 用例与口语试跑

Playwright Studio（`npm run studio`）编辑器区有两个与 AI 测试相关的 Tab，定位不同，不要混用。

## Tab 对照

| Tab | 原称 | 输入 | 产物 | 适合场景 |
|-----|------|------|------|----------|
| **YAML 用例** | Intent 运行 | `tests/definitions/*.yaml` | `results/intent-runs/`、`screenshots/intent/` | 正式回归、样式守护、截图对比、Explore 沉淀 |
| **口语试跑** | NL 验证 | 自然语言 + 可选入口 URL | `results/ego-studio/`（Intent YAML 或临时脚本） | 快速验证「能不能跑通」 |

```text
口语试跑（探索）              YAML 用例（沉淀）
─────────────────            ─────────────────
一句话描述                    YAML 文件
      ↓                            ↓
Intent YAML + ego 执行        语义步骤（ego / pw）
（或临时 Playwright 脚本）          ↓
      ↓                            ↓
试跑通过 ──转为 YAML 用例──→  保存 definitions → 回归 / 样式守护
```

## YAML 用例 Tab

### 能做什么

- 选择或编辑 Intent YAML，**运行用例**（引擎：playwright / ego）
- **保存定义** 到 `tests/definitions/`
- **Explore → 生成 Intent**：ego 代操探索后填入 YAML 编辑器
- **样式守护全流程**：用上方同一 YAML 路径 → pw 截图 + style 指纹 → Golden 对比（见 [style-drift-workflow.md](./style-drift-workflow.md)）

### CLI 等价

```bash
npm run intent:run -- --intent=tests/definitions/smoke.yaml
npm run intent:run -- --intent=tests/definitions/smoke.yaml --engine=pw --headed
npm run ego:explore -- --goal="进入审批列表" --entry=/main/approve
```

## 口语试跑 Tab

### 流程（界面内）

```text
1. 填写自然语言 + 可选入口 URL，选择引擎（默认 ego）
2. 点「开始试跑」
3. ego：LLM 生成 intent.preview.yaml → ego 执行；pw：生成 generated.ts → Playwright 执行
4. 界面预览区展示 YAML 或临时脚本
5. （pw 且勾选）ego 选择器体检 — 仅 optimized.spec 有效
6. 结果区显示通过/失败；通过后可「转为 YAML 用例」
```

产物目录：`results/ego-studio/<timestamp>/`

| 文件 | 说明 |
|------|------|
| `intent.preview.yaml` | ego 引擎：AI 生成的 Intent YAML |
| `generated.ts` | playwright 引擎：AI 生成的临时脚本 |
| `run/result.json` | 执行是否通过 |
| `run/stdout.log` | 执行日志（pw） |

### 能做什么

1. 用自然语言描述步骤，点 **开始试跑**（默认 **ego**：NL → Intent YAML → ego 执行）
2. 也可选 **playwright**：`generate-playwright-script.ts` → `run-playwright-script.ts`（可选 ego 选择器体检）
3. 试跑通过后，点 **转为 YAML 用例**：ego 试跑可直接填入编辑器；pw 试跑调用 `nl-to-intent.ts`
4. 在 YAML 用例 Tab 确认后 **保存定义**

### WS 事件

| 事件 | 说明 |
|------|------|
| `ego:nl-run` | 开始试跑 |
| `intent:from-nl` | 试跑通过后转为 Intent YAML 预览 |

### CLI 等价

```bash
# 仅转换（需自行准备 case / script）
npx tsx scripts/ai/nl-to-intent.ts \
  --case="打开我的审批，进入第一条" \
  --entry=/main/approve \
  --env=stage \
  --script=results/ego-studio/.../generated.ts \
  --run-dir=results/ego-studio/.../run \
  --out=results/nl-to-intent/demo
```

## AI 模型配置（Explore / 口语试跑 / Intent 自愈）

在项目根 **`.env`** 配置（Studio 启动时加载；改后需重启）：

```env
AI_TEST_PROVIDER=openai          # deepseek | anthropic | openai

# 火山方舟（OpenAI 兼容）示例
AI_TEST_OPENAI_API_KEY=ark-xxxx
AI_TEST_MODEL=ep-xxxxxxxx      # 或 ark-code-latest 等接入点 ID
AI_TEST_OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3

# DeepSeek 示例
# AI_TEST_PROVIDER=deepseek
# DEEPSEEK_API_KEY=sk-xxxx
```

启动 `npm run studio` 时终端会打印：

```text
AI_TEST_PROVIDER: openai
火山方舟（Explore / NL / Intent）: ✓ 已配置 · model=... · base=...
```

### 与侧栏「AI 优化脚本」的区别

| 能力 | 配置位置 |
|------|----------|
| Explore、口语试跑、Intent 自愈、NL→YAML | 项目根 `.env` |
| 录制脚本 **AI 优化** | 侧栏密钥 **或** `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY` |

侧栏填写的 Key **不会**传给 Explore / 口语试跑子进程。

## 右侧「用例」面板

与编辑器 Tab 独立：侧栏工作模式 **新建用例 / 运行用例 / 定时任务** 在控制台 **用例** Tab 中切换（录制 → optimized → 批量执行等传统流程）。

## Change Log

| 日期 | 变更 |
|------|------|
| 2026-08-18 | Tab 改名 YAML 用例 / 口语试跑；口语试跑→YAML 转换；样式守护并入 YAML Tab；火山方舟启动检测 |
