# 文档索引

31 篇文档按**你要做什么**分组，不按文件名排。每篇标了「什么时候看」，
先扫这一列找到自己的场景，再点进去。

- 想快速上手 → 从「一、新人上路」的三篇开始
- 要新增一个业务流程 → 直接看「二、新增流程」
- 报告 / 回归相关 → 「四、UI 回归与报告」按四层结构挑
- 找不到 → 拉到文末「按关键词找」

---

## 一、新人上路（按顺序看）

| 文档 | 什么时候看 |
| --- | --- |
| [COLLABORATION.md](./COLLABORATION.md) | 第一天。本地环境、录制前提（codegen 需图形界面）、分支与 CI 流程、故障排查 |
| [test-env-paths.md](./test-env-paths.md) | 跑第一个用例前。用例/录制/截图按 `PLAYWRIGHT_ENV` 分区，**不看这篇容易在 stage 误跑 uat 用例** |
| [ai-test-boundaries.md](./ai-test-boundaries.md) | 想清楚「哪些交给 AI」之前。AI 负责生成/探索/自愈，框架负责断言/门禁，人负责定预期 |

```bash
npm run setup            # 初始化
npm run cli -- --help    # 129 条 scripts 的统一入口，先看这个
npm run login:force      # 刷新登录态（storageState）
npm test --env=dev       # 指定环境跑
```

## 二、新增流程（本项目当前主线）

按这个顺序做，不要跳。

| 文档 | 什么时候看 |
| --- | --- |
| [flow-kit-and-flow-new.md](./flow-kit-and-flow-new.md) | **新增流程的主文档**。`flow:new` 生成骨架 → `flow:gen-catalog` 生成 UI 契约 → 补用例。含 catalog 的 `TODO(review)` 清单与 6 个踩过的坑 |
| [flow-debug-acceleration.md](./flow-debug-acceleration.md) | 流程写完跑不通时。`flow:debug-fast` 关掉 video/trace/截图、压缩超时，只留失败定位所需 |
| [ui-contract-from-source.md](./ui-contract-from-source.md) | 想让选择器更稳时。用前端源码建索引生成 UI 契约（**索引，不是把源码灌给 AI**），含两个只有实机才能发现的坑 |
| [golden-set-definition.md](./golden-set-definition.md) | 定义「哪些页面算 golden」时。登录 / 工作台 / 审批列表三个基准页与门禁约定 |
| [page-catalog.md](./page-catalog.md) | 想自动发现全站页面 / 让 flow:new 不再手填入口时。`catalog:crawl` 产出全站页面清单（Smoke 巡检与用例生产的页面来源） |

```bash
npm run flow:list                                    # 看已注册的流程
npm run flow:new -- --id=x-flow --label=X流程 --entry=/main/x --domain=x
npm run flow:gen-catalog -- --flow=x-flow --force    # 探活快照 → catalog 草稿
npm run flow:gen-catalog -- --flow=x-flow --check    # 漂移检测（建议挂定时任务）
npm run flow:debug-fast -- --flow=x-flow --grep=列表加载
npm run <id>:golden                                  # 完整 golden
```

## 三、调试与排障

| 文档 | 什么时候看 |
| --- | --- |
| [error-collection-guide.md](./error-collection-guide.md) | 用例失败要看细节时。失败信息自动落盘的位置与 JSON 字段含义 |
| [error-reporter-optimization.md](./error-reporter-optimization.md) | 觉得「错误数虚高」时。重试导致的重复错误已去重，ANSI 控制字符已清理 |
| [ego-lite-integration.md](./ego-lite-integration.md) | 选择器体检 / 需要继承当前登录态探页面时 |
| 项目根 [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) | 环境级问题（装不上、跑不起来） |

```bash
npm run trace:show           # 打开最近一次失败的 trace
npm run analyze-errors       # 错误汇总分析
npm run heal:suggest         # 自愈补丁建议（--apply 前必须人审）
npm run selector-drift:suggest
```

## 四、UI 回归与报告（四层，别混）

这四层解决的是不同问题，看之前先确认自己在哪一层。

| 层 | 回答的问题 | 文档 |
| --- | --- | --- |
| 像素 diff | 这两张图变了没？（**需要基线**） | [ui-regression-workflow.md](./ui-regression-workflow.md) |
| 单图审计 | 这一张图本身有没有问题？（**不需要基线**） | [ai-ui-audit.md](./ai-ui-audit.md) |
| 样式守护 | CSS 属性有没有漂移？（Gate 默认只看这层 + 结构巡检） | [style-drift-workflow.md](./style-drift-workflow.md) |
| 人审闭环 | 差异要不要 Approve？ | [visual-review-lite.md](./visual-review-lite.md) |

对外交付相关：

| 文档 | 什么时候看 |
| --- | --- |
| [ui-regression-report-for-customer.md](./ui-regression-report-for-customer.md) | **要把报告发给客户前**。怎么读、分级口径（为什么「差异 1.23%」反而不用管）、刻意不放什么 |
| [customer-report-implementation.md](./customer-report-implementation.md) | 要改报告代码时（内部）。模块职责、判定口径「性质优先而非差异率优先」、已知维护陷阱 |
| [report-quality-review-2026-09-10.md](./report-quality-review-2026-09-10.md) | 要做报告质量整改时（内部）。首屏口径矛盾、AI 审计与像素报告结论冲突的完整问题清单 |
| [delivery-freeze-2026-09.md](./delivery-freeze-2026-09.md) | **本次发版收尾前**。Stage9084 交付 DoD、冻结范围、NOT-DOING 与 POST-DELIVERY |
| [page-change-detection-design.md](./page-change-detection-design.md) | 想扩展检测能力时。对标 PageWatch 的逆向分析 + 本项目缺口 + 不建议照搬的部分 |
| [visual-review-delivery.md](./visual-review-delivery.md) | 要按指定运行生成视觉复核报告并交付到飞书独立表时。生成预览 → 检查 → 明确批准后发布 |

```bash
npm run report:customer      # 客户版报告
npm run ui-audit:verify      # 单图审计
npm run style:run            # 样式守护
```

## 五、AI 能力

| 文档 | 什么时候看 |
| --- | --- |
| [studio-yaml-and-nl-workflow.md](./studio-yaml-and-nl-workflow.md) | 用 Studio 时。「YAML 用例」和「口语试跑」两个 Tab 定位不同，**不要混用** |
| [raw-to-optimized-pipeline.md](./raw-to-optimized-pipeline.md) | 有录制产物要转成可维护用例时 |
| [run-optimized-tests.md](./run-optimized-tests.md) | 批量跑 `tests/optimized/` 时 |

```bash
npm run studio               # 编辑器
npm run intent:run           # Intent 驱动
npm run mine:cases           # 用例挖掘
npm run trust:report         # Intent 可信度
```

## 六、CI / 通知 / 协作

| 文档 | 什么时候看 |
| --- | --- |
| [test-jobs.md](./test-jobs.md) | 要后台跑、失败即停、跑完发通知时。配置在 `config/test-jobs.json` |
| [github-actions-quickstart.md](./github-actions-quickstart.md) | 配 CI 时。Secrets、启用工作流、常见排错 |
| [feishu-bitable-dashboard.md](./feishu-bitable-dashboard.md) | 搭飞书多维表仪表盘时。**三层权限 / 两类操作不要混** |
| [feishu-customer-delivery.md](./feishu-customer-delivery.md) | 要把验收报告发给客户时。图片进多维表、正文进飞书文档，客户拿到的是链接 |
| [feishu-permissions-guide.md](./feishu-permissions-guide.md) | 飞书报权限错时。最小必要权限集合 |
| [feishu-webhook-setup.md](./feishu-webhook-setup.md) | 只想配通知（不用多维表）时 |

## 七、项目状态

| 文档 | 什么时候看 |
| --- | --- |
| [OPTIMIZATION-ROADMAP.md](./OPTIMIZATION-ROADMAP.md) | 想知道「某个能力做了没」。已落地清单 + 环境变量速查 |
| [scripts-map.md](./scripts-map.md) | 想知道「有哪些命令可用」。168 条 npm scripts 按域分组的唯一索引 + 6 个孤儿工具 CLI 纳管清单 |
| [improvement-plan.md](./improvement-plan.md) | 要做项目瓶颈改造时。六大瓶颈分析 + 四阶段实施计划 + 统一验收指标 |
| [project-discussion-log.md](./project-discussion-log.md) | 想追溯项目方向讨论与决策脉络时。每轮讨论概要、用户目标、已确认结论与待决事项 |

---

## 按关键词找

| 我想…… | 看这里 |
| --- | --- |
| 新增一个流程 | [flow-kit-and-flow-new.md](./flow-kit-and-flow-new.md) |
| 调试跑太慢 | [flow-debug-acceleration.md](./flow-debug-acceleration.md) |
| 选择器老是挂 | [ui-contract-from-source.md](./ui-contract-from-source.md) |
| catalog 里的 TODO(review) 怎么填 | [flow-kit-and-flow-new.md](./flow-kit-and-flow-new.md#todoreview唯一需要人工介入的环节) |
| 把报告发给客户 | [feishu-customer-delivery.md](./feishu-customer-delivery.md) · [ui-regression-report-for-customer.md](./ui-regression-report-for-customer.md) |
| 报告分级口径 / 为什么 1.23% 不用管 | [ui-regression-report-for-customer.md](./ui-regression-report-for-customer.md) |
| 改报告代码 | [customer-report-implementation.md](./customer-report-implementation.md) |
| 截图基线要不要更新 | [visual-review-lite.md](./visual-review-lite.md) |
| 没有基线也想查 UI 问题 | [ai-ui-audit.md](./ai-ui-audit.md) |
| 环境跑错了 / 路径约定 | [test-env-paths.md](./test-env-paths.md) |
| 定时任务 + 失败通知 | [test-jobs.md](./test-jobs.md) |
| 飞书权限报错 | [feishu-permissions-guide.md](./feishu-permissions-guide.md) |
| 看失败 trace | `npm run trace:show` |
| 忘了有哪些命令 | `npm run cli -- --help` · [scripts-map.md](./scripts-map.md) |

## 维护约定

加新文档后跑一次：

```bash
npm run docs:check
```

它检查三件事，有问题退出码 1：

1. `docs/` 下每篇都被本索引挂到（不许有孤岛 —— 整理前 26 篇里有 14 篇零引用）
2. 所有相对链接目标真实存在（曾有一条指向不存在的根 `README.md`）
3. 每篇子文档都有返回索引的链接（读者进得去也出得来）

### 自动化门禁

光靠「记得跑一下」撑不过半年，所以这三项检查挂了两道自动门禁。

**本地 pre-commit（需一次性启用）**

克隆仓库后跑一次，之后不用管：

```bash
npm run hooks:install   # 实际是 git config core.hooksPath .githooks
```

hook 是**条件触发**的：只有 `git diff --cached` 命中 `docs/` 时才跑 `docs:check`，
其余提交直接放行（实测 0.07 秒，不影响日常提交手感）。
被拦住时要么修完再提，要么 `git commit --no-verify` 临时跳过。

hook 脚本在 `.githooks/pre-commit`，纳入版本控制，不依赖 husky 之类的工具。
但 `core.hooksPath` 是本地 git 配置，**不会随仓库克隆自动生效** —— 这就是为什么需要跑一次 `hooks:install`。

**CI（`.github/workflows/docs-and-lint.yml`）**

两个 job，门禁强度刻意不同：

| job | 内容 | 是否阻塞 | 为什么 |
| --- | --- | --- | --- |
| `docs` | `npm run docs:check` | **阻塞** | 索引问题都是本次改动引入的，没有历史债，能一直保持绿灯 |
| `lint` | `npm run lint` 全仓 | 非阻塞（CI）/ **本地交付 DoD 阻塞** | 全仓已于 2026-09-10 清零至 0 error（124 warning 可接受）；CI 仍保留 `continue-on-error` 防回退观察期 |
| `lint` | `npx eslint flow-kit/ scripts/verify/check-docs-index.ts` | **阻塞** | 已清零的目录做防回退。某个目录清干净后，往这一步的路径列表里加 |

它独立于 `playwright.yml`：那条流水线要 90 分钟、要浏览器、要 secrets，
而文档和 lint 检查应该在几十秒内给出反馈。

> 顺带一提：如果 `npm run lint` 报出上万个问题，先看 `eslint.config.js` 的 `ignores`。
> `.cache/` 下的前端仓库克隆有 3 万多个文件，漏 ignore 会报出 12 万个问题，把真实问题彻底埋掉。

其他约定：

- 文档定位有重叠时，在对应小节写清「什么时候看这篇而不是那篇」，别放任读者猜。
- `visual-review-lite.md` 与 `raw-to-optimized-pipeline.md` 各自维护 Change Log，
  相关改动追加到本文，**不要**写进 `OPTIMIZATION-ROADMAP.md`。
