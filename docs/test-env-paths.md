# 用例路径与环境分区

用例、录制与截图按 **Playwright 环境**（`PLAYWRIGHT_ENV` / `datasource/base-config.json` 中的 env id）分区，避免在 stage 环境误跑 uat 用例。

## 路径约定

| 类型 | 路径 |
|------|------|
| 优化用例 | `tests/optimized/<env>/<dateCategory>/xxx.optimized.spec.ts` |
| 原始录制（Studio 备份） | `tests/raw-recordings/original/<env>/<dateCategory>/xxx.spec.ts` |
| 截图 | `screenshots/<env>/<dateCategory>/<fileName>/` |
| 草稿 optimized | `tests/optimized/studio-unsaved-draft.optimized.spec.ts`（固定，不分 env） |

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

## 迁移旧目录

```bash
# 预览
npm run migrate:test-env-paths

# 执行迁移（legacy dateCategory 目录 → stage/<dateCategory>/）
npm run migrate:test-env-paths -- --apply

# 仅修正已迁移 spec 内的 import / 截图路径
npm run migrate:test-env-paths -- --fix-specs-only

# 指定目标 env
npm run migrate:test-env-paths -- --env=uat --apply
```

## 常用命令

```bash
# 在 stage 环境跑指定用例
PLAYWRIGHT_ENV=stage npx playwright test tests/optimized/stage/260612/xxx.optimized.spec.ts --project=optimized

# 批量回归（按 PLAYWRIGHT_ENV 过滤）
PLAYWRIGHT_ENV=stage npm run run-optimized-tests
```
