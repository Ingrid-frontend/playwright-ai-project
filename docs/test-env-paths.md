# 用例路径与环境分区

> 索引：[docs/README.md](./README.md)

用例、录制与截图按 **Playwright 环境**（`PLAYWRIGHT_ENV` / `datasource/base-config.json` 中的 env id）分区，避免在 stage 环境误跑 uat 用例。

## 环境 Profile（`config/env-profiles.json`）

连接层（URL / 登录态）仍在 `datasource/base-config.json`；**报告、交付、跨浏览器**等差异集中在 env profile：

| 字段 | 作用 |
|------|------|
| `label` | 客户报告中的环境名 |
| `compareCrossBrowser` | 该环境默认是否做 Chrome vs WebKit 对比 |
| `defaultBrowsers` | 报告/门禁期望的浏览器集合 |
| `deliverySuffix` | 交付载荷文件名后缀（如 `customer-delivery-stage9084.json`） |
| `customerDeliveryPrimary` | 标记主交付环境（当前为 stage9084） |

优先级：**`PLAYWRIGHT_COMPARE_CROSS_BROWSER` 环境变量** > env profile > `config/ui-regression.json`。

```bash
# 查看某环境是否开启跨浏览器（生成客户报告时会打印）
npm run report:customer -- --env=dev

# 临时覆盖
PLAYWRIGHT_COMPARE_CROSS_BROWSER=0 npm run compare-screenshots
```

工具函数：`src/utils/env-profile.ts`（`getEnvProfile`、`resolveDeliveryPayloadPath` 等）。

## 路径约定

| 类型 | 路径 |
|------|------|
| 优化用例 | `tests/optimized/<env>/<dateCategory>/xxx.optimized.spec.ts` |
| 原始录制（Studio 备份） | `tests/raw-recordings/original/<env>/<dateCategory>/xxx.spec.ts` |
| 截图 | `screenshots/<env>/<dateCategory>/<fileName>/` |
| 草稿 optimized | `tests/optimized/<env>/<dateCategory>/<feature>_<timestamp>.optimized.spec.ts` |

`<dateCategory>` 来自 `config/date-categories.json`（如 `260612`）。

### 旧路径（legacy）

无 `<env>` 段的历史路径视为 **`legacyEnvDefault`**（默认 `stage`），例如：

- `tests/optimized/260612/xxx.optimized.spec.ts` → 等价于 `stage` 环境

可通过 `config/test-path-layout.json` 调整：

```json
{
  "envSegmentEnabled": true,
  "legacyEnvDefault": "stage",
  "enforceSpecEnvInCi": true
}
```

## 环境校验

执行前会校验用例 env 与运行 env 是否一致：

| 场景 | 行为 |
|------|------|
| Studio 执行 / 批量执行 | 不匹配则报错 |
| Test Jobs / `run-optimized-tests` | 同上；`specs: all` 仅匹配当前 job 的 `playwrightEnv` |
| CI | 默认强制（`enforceSpecEnvInCi: true`） |
| 本地 | 不匹配时 `console.warn`，可用 `PLAYWRIGHT_ENFORCE_SPEC_ENV=1` 强制 |

工具函数：`src/utils/test-env-path.cjs`（`assertSpecEnvMatch`、`buildOptimizedRel` 等）。

## Studio

- 侧栏切换环境后，用例下拉框只显示该 env 下的 spec
- 录制 / pipeline 落盘路径自动带上当前 session 环境
- 切换环境时 WebSocket `env:changed` 会刷新 `optimizedSpecs` 列表

## Test Jobs

`config/test-jobs.json` 中每个 job 可配置 `playwrightEnv`（默认 `stage`）。glob 示例：

```json
"specs": ["tests/optimized/stage/260612/工作台_*.optimized.spec.ts"]
```

`specs: "all"` 时只收集与 `playwrightEnv` 匹配的用例。

## 常用命令

```bash
# 在 stage 环境跑指定用例
PLAYWRIGHT_ENV=stage npx playwright test tests/optimized/stage/260612/xxx.optimized.spec.ts --project=optimized

# 批量回归（按 PLAYWRIGHT_ENV 过滤）
PLAYWRIGHT_ENV=stage npm run run-optimized-tests
```
