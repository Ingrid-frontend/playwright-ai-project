# 流程调试提速指南

新增流程时先用 debug-fast 通道定位问题，通过后再跑完整 golden。debug-fast 不生成截图基线、不晋升 golden、不产出客户报告，也不发送飞书通知；它保留 Playwright JSON、步骤进度和 manifest，用于快速判断脚本是否跑通。

## 快速调试

```bash
# 申请单：只跑第一个已登录 golden 角色
npm run request-flow:debug-fast -- --env=dev

# 审批：只跑第一个已登录 golden 角色
npm run approval-flow:debug-fast -- --env=dev
```

如果卡在某个步骤，用 `--grep` 只跑该测试，避免每次从头重放整条流程：

```bash
npm run approval-flow:debug-fast -- \
  --env=dev \
  --grep="用现场单号搜索并打开详情"

npm run request-flow:debug-fast -- \
  --env=dev \
  --grep="按单号搜索并校验列表"
```

也可以显式指定角色，避免调试对象漂移：

```bash
npm run request-flow:debug-fast -- --env=dev --profile=golden
```

debug-fast 会自动开启：

| 开关 | 值 | 作用 |
|---|---|---|
| `FLOW_DEBUG_FAST` | `1` | 只跑一个角色，跳过报告后处理、golden 对比和晋升 |
| `SCREENSHOT_CAPTURE` | `0` | 关闭步骤截图 |
| `FLOW_TRACE` | `off` | 关闭 trace |
| `FLOW_DISABLE_VIDEO` | `1` | 关闭录像 |
| `PW_TEST_TIMEOUT` | `90000` | 缩短整用例超时 |
| `PW_ACTION_TIMEOUT` | `10000` | 缩短单步操作超时 |
| `PW_NAVIGATION_TIMEOUT` | `20000` | 缩短导航超时 |
| `PW_EXPECT_TIMEOUT` | `8000` | 缩短断言超时 |

## 调试闭环

1. 用 `debug-fast --grep=<失败测试>` 复现单步。
2. 查看 `results/flow-runs/<flow>/<runId>/progress.json`、`playwright-result.json` 和 `api-failures.json`。
3. 修复选择器、等待或测试数据。
4. 单步通过后，去掉 `--grep` 跑完整 debug-fast。
5. 最后执行原有 golden 命令，让截图、对比、报告和基线逻辑回到正式链路。

```bash
npm run request-flow:golden -- --env=dev --profile=golden
npm run approval-flow:golden -- --env=dev --profile=golden
```

## 新流程建议

- 新流程先写 Intent YAML 或小 spec，只覆盖一个业务闭环，不把所有分支塞进首版。
- 页面导航、列表加载、筛选、详情打开等通用能力沉淀到 Page Object，避免每个流程重新生成选择器。
- 固定 `golden-seeds.json` 的单号和筛选关键字，避免现场读数导致每次结果不同。
- 固定登录态和账号 profile，登录问题先单独处理，不要混在业务流程里反复排障。
- 需要看视觉问题时再打开截图和录像；定位选择器或断言时先保持 debug-fast。
