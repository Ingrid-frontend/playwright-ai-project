# 测试任务（Test Jobs）

通过 `config/test-jobs.json` 配置后台运行、定时调度、失败即停与飞书通知。

## 快速开始

```bash
# 列出任务
npm run test-job -- list

# 前台执行
npm run test-job -- run --id=smoke-workbench

# 后台执行
npm run test-job -- run --id=smoke-workbench --background

# 查看状态 / 日志 / 停止
npm run test-job -- status --id=smoke-workbench
npm run test-job -- logs --id=smoke-workbench
npm run test-job -- stop --id=smoke-workbench

# 启动定时守护（读取 config 中带 schedule 的 Job）
npm run test-job:daemon
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
| `jobs[].specs` | `"all"` 或 glob 路径数组 |
| `jobs[].stopOnTestFailure` | 用例失败即停 |
| `jobs[].stopOnCompareGate` | UI gate blocker 时任务失败 |
| `jobs[].runCompareAfterAbort` | 中断后是否仍跑对比 |
| `jobs[].steps.*` | login / compare / compareGate / feishuNotify 等 |

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

## 定时调度

方式一：内置守护进程

```bash
npm run test-job:daemon
```

方式二：系统 crontab

```cron
0 2 * * * cd /path/to/playwright-ai-project && npm run test-job -- run --id=nightly-regression --background
```

方式三：macOS launchd（示例）

```xml
<!-- ~/Library/LaunchAgents/com.playwright.test-jobs-daemon.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.playwright.test-jobs-daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/npm</string>
    <string>run</string>
    <string>test-job:daemon</string>
  </array>
  <key>WorkingDirectory</key><string>/path/to/playwright-ai-project</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/test-jobs-daemon.log</string>
  <key>StandardErrorPath</key><string>/tmp/test-jobs-daemon.err</string>
</dict>
</plist>
```

加载：`launchctl load ~/Library/LaunchAgents/com.playwright.test-jobs-daemon.plist`

## Playwright Studio

Studio 侧栏「定时任务」面板支持：

- 查看 `config/test-jobs.json` 中的 Job 列表与最近运行状态
- 前台 / 后台手动触发
- 停止运行中的 Job
- 查看最近运行日志 tail

WebSocket 消息：`jobs:list`、`jobs:run`、`jobs:stop`、`jobs:status`

## GitHub Actions 定时

云端定时见 [`.github/workflows/scheduled-test-jobs.yml`](../.github/workflows/scheduled-test-jobs.yml)：

- Cron：`0 18 * * *`（UTC，约北京时间 02:00）
- 手动触发时可指定 `job_id` 输入参数
- 与本地共用 `npm run test-job -- run --id=...`

## 环境变量

与现有流程一致：

- `PLAYWRIGHT_ENV` — 可被 Job 内 `playwrightEnv` 覆盖
- `TEST_USERNAME` / `TEST_PASSWORD` — 登录
- `FEISHU_WEBHOOK_URL` / `FEISHU_WEBHOOK_SECRET` — 飞书通知

## 与 run-optimized-tests 的关系

`npm run run-optimized-tests` 现通过同一 `job-runner` 执行，行为与改造前兼容（含 `--stop`、对比、飞书文档）。

配置化任务请使用 `npm run test-job`。
