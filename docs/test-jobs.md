# 测试任务（Test Jobs）

> 索引：[docs/README.md](./README.md)

通过 `config/test-jobs.json` 配置后台运行、失败即停与飞书通知。

## 快速开始

```bash
# 列出任务
npm run test-job -- list

# 前台执行
npm run test-job -- run --id=smoke-workbench

# 后台执行
npm run test-job -- run --id=smoke-workbench --background

# 指定环境（仅执行 tests/optimized/<env>/ 下匹配的用例）
npm run test-job -- run --id=nightly-regression --env=uat
npm run test-job -- run --id=smoke-workbench --env=dev --background

# 查看状态 / 日志 / 停止
npm run test-job -- status --id=smoke-workbench
npm run test-job -- logs --id=smoke-workbench
npm run test-job -- stop --id=smoke-workbench
```

## 配置文件

路径：`config/test-jobs.json`

| 字段 | 说明 |
|------|------|
| `defaults` | 全局默认值 |
| `jobs[].id` | 任务唯一 ID |
| `jobs[].enabled` | 是否启用 |
| `jobs[].schedule` | Cron 表达式，`null` 表示仅手动 |
| `jobs[].timezone` | 时区，默认 `Asia/Shanghai` |
| `jobs[].playwrightEnv` | 目标环境（定时/Cron 默认）；手动执行可用 `--env` 或 Studio 下拉覆盖 |
| `jobs[].specs` | `"all"` 或 glob 路径数组；`all` 仅扫描当前 env 目录；缺 env 段的 legacy glob 会自动补全 |
| `jobs[].stopOnTestFailure` | 用例失败即停 |
| `jobs[].stopOnCompareGate` | UI gate blocker 时任务失败 |
| `jobs[].runCompareAfterAbort` | 中断后是否仍跑对比 |
| `jobs[].steps.compareGate` | UI gate blocker 时任务失败（**defaults 默认 true**；smoke 等可显式 `false`） |

## 运行状态

每次运行写入：

```
results/jobs/<jobId>/
  lock.json              # 运行中锁（pid / runId）
  runs/<runId>/
    status.json
    summary.json
    stdout.log           # 后台模式日志
```

## 报错停止

1. **用例失败即停**：`stopOnTestFailure: true`（默认）
2. **UI blocker 即失败**：`steps.compareGate: true` + `stopOnCompareGate: true`
3. **中断后跳过对比**：`runCompareAfterAbort: false`（默认）

## 手动 / 云端触发

部分 Job 已配置 CI 定时调度（UTC cron），其余仅手动触发。

| Job ID | 调度 | 北京时间 | 触发来源 |
|--------|------|----------|----------|
| `request-flow-golden` | `0 2 * * 1-5` | 工作日 10:00 | CI cron |
| `request-flow-golden-all-envs` | `0 22 * * *` | 每天 06:00（次日） | CI cron |
| `request-flow-write` | `0 3 * * 2,4` | 周二、周四 11:00 | CI cron |
| `approval-flow-golden` | `null` | — | 仅手动 |
| `approval-flow-write` | `0 4 * * 3` | 周三 12:00 | CI cron |
| `catalog-drift-check` | `0 1 * * *` | 每天 09:00 | CI cron |

手动触发方式：

- Studio **定时任务** 工作区 → 前台/后台运行
- CLI：`npm run test-job -- run --id=<jobId> [--background]`
- GitHub Actions：[`.github/workflows/scheduled-test-jobs.yml`](../.github/workflows/scheduled-test-jobs.yml) → **Run workflow**（`workflow_dispatch`）或 CI cron 自动触发

## 本机定时

`scheduler: "local"` 的任务不由 GitHub 触发。`npm run studio` 起来后每分钟执行 `npm run test-job -- tick`，cron 按任务的 `timezone` 解释（北京时间）。Studio 没开着就错过该分钟，不补跑。

| Job ID | 调度 | 北京时间 | 做什么 |
|--------|------|----------|--------|
| `golden-all-flows` | `30 10 * * 1-5` | 工作日 10:30 | `dev`、`uat`、`stage9084` 上，申请单、审批、报销、对公申请单各做一次「检测全部」 |

每个流程只跑自己的 `golden-regression.spec.ts`，已登录的 golden 账号串行。不跑 `full-flow`，不跑 `deliver:feishu`，不先探活。某一条或某一个环境失败会继续后面的。退出码 1（用例失败、崩溃、没有已登录账号）算整轮失败；退出码 2（有登录态但无单据）只记跳过。该环境至少一条通过后跑一次 `deliver:ready`，并在有新的 `results/flow-ui-issues.json` 时写入现有飞书多维表。多维表写入失败不算整轮失败。有硬失败或预览失败时，结束再发一条飞书，只列失败和跳过项。

手动与到点是同一条编排：

```bash
npm run test-job -- run --id=golden-all-flows
npm run test-job -- run --id=golden-all-flows --background
```

Studio 侧栏「定时任务」里点前台或后台运行也可以。这次调用带上的 `--env`、`--profile` 不会把范围收成单个环境。已经有一轮在跑时再次启动会被锁跳过。手动运行不写 `schedule-fired.json`，当天 10:30 仍会再跑；那一轮还没结束时手动再点不会启动。

## Playwright Studio

侧栏 **工作模式 → 定时任务** 进入独立工作区（非折叠面板）：

- **左侧**：任务列表（`config/test-jobs.json`），支持前台/后台运行、停止
- **中间**：选中任务后可切换**执行环境**、查看对应用例数，以及配置摘要与日志
- **右侧**：控制台仍输出执行过程日志

WebSocket 消息：`jobs:list`、`jobs:preview`、`jobs:run`、`jobs:stop`、`jobs:status`

## GitHub Actions

云端手动触发见 [`.github/workflows/scheduled-test-jobs.yml`](../.github/workflows/scheduled-test-jobs.yml)（无 schedule，仅 `workflow_dispatch`）。与本地共用 `npm run test-job -- run --id=... [--env=...]`。

## 环境变量

与现有流程一致（路径约定见 [test-env-paths.md](./test-env-paths.md)）：

- `PLAYWRIGHT_ENV` — 由 Job 内 `playwrightEnv` 覆盖；`specs: all` 时仅扫描并执行 `tests/optimized/<env>/` 下用例（排除 `studio-auto`）
- `TEST_USERNAME` / `TEST_PASSWORD` — 登录
- `FEISHU_WEBHOOK_URL` / `FEISHU_WEBHOOK_SECRET` — 飞书通知

## 通知投递记录

飞书发送结果写入 `results/notification-deliveries/`（与任务执行解耦，失败可单独重投）：

```bash
npm run notify:resend -- --list
npm run notify:resend -- --latest-failed
npm run notify:resend -- --file=results/notification-deliveries/<file>.json
```

## 与 run-optimized-tests 的关系

`npm run run-optimized-tests` 现通过同一 `job-runner` 执行，行为与改造前兼容（含 `--stop`、对比、飞书文档）。

配置化任务请使用 `npm run test-job`。
