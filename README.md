# Playwright AI 项目

汇联易 UI 质量平台：录制 → 执行 → 视觉回归 → 报告 / 飞书通知。

## 快速开始（三板斧）

```bash
# 1. 环境（~10 min）
npm install
cp .env.example .env   # 填 TEST_USERNAME / TEST_PASSWORD / 飞书 webhook
npm run setup
npm run login

# 2. 跑通 Golden（~15 min）
npm run request-flow:golden

# 3. 看报告（~5 min）
open results/flow-customer-report.html
```

Studio 可视化控制台：`npm run studio` → http://localhost:3001（详见 [pw-files/README.md](pw-files/README.md)）

## 测试放哪？决策树

```
新场景要测什么？
│
├─ 单页面 / 单功能巡检（灵活、录制快）
│   └─ tests/optimized/ 或 tests/definitions/（Intent YAML）
│
├─ 核心业务流程（列表 → 详情 → 操作，固定种子、客户报告）
│   └─ *-flow/golden-regression（request-flow / approval-flow）
│
└─ 写操作 / 探活（不污染 golden 基线）
    └─ *-flow/write + ui-audit
```

| 类型 | 目录 | 典型命令 |
|------|------|----------|
| Optimized 用例 | `tests/optimized/` | `npm run test:ci` |
| Intent YAML | `tests/definitions/` | `npm run intent:run -- --intent=...` |
| 流程 Golden | `request-flow/` `approval-flow/` | `npm run request-flow:golden` |
| 流程 Write | 同上 | `npm run request-flow:write` |
| 定时 Job | `config/test-jobs.json` | `npm run test-job -- run --id=...` |

## 新增业务流程（30 分钟路径）

详见 [docs/flow-kit-and-flow-new.md](docs/flow-kit-and-flow-new.md)。

```bash
# 0. 生成骨架
npm run flow:new -- --id=expense-flow --label=报销流程 --entry=/main/expense-parent-report/expense-report

# 1. 探活 + catalog
npx tsx scripts/index-frontend/probe-live-page.ts --env=dev --entry=/main/expense-parent-report/expense-report \
  --out=expense-flow/datasource/live-snapshot.json
npm run flow:gen-catalog -- --flow=expense-flow --force

# 2. 确认 catalog 里的 TODO(review)，再调试
npm run flow:debug-fast -- --flow=expense-flow --grep=列表加载

# 3. debug 通过后做 golden 验证（不 promote）
npm run flow:verify -- --flow=expense-flow --grep=列表加载
```

```bash
npm run flow:list    # 查看已注册流程
```

## 基线分层策略

配置见 [config/baseline-tiers.json](config/baseline-tiers.json)。

| 层级 | 范围 | 何时跑 | Job |
|------|------|--------|-----|
| L1 核心门禁 | dev + golden 账号 | PR / 工作日 | `request-flow-golden` `approval-flow-golden` |
| L2 周检 | catalog 漂移 | 每周一 | `catalog-drift-check` |
| L3 全环境 | stage / uat | 发版前手动 | `request-flow-golden-all-envs` |

## 交付物

| 受众 | 产出 | 路径 |
|------|------|------|
| 产品 / 业务 | 客户版 UI 衰退报告 | `results/flow-customer-report.html` |
| 测试负责人 | 飞书多维表看板 | `npm run feishu:bitable-setup` 后自动写入 |
| 前端 | 截图 diff | `results/flow-screenshot-comparison.html` |
| 管理层 | 周报 | `npm run feishu:flow-weekly-doc` |

Golden Job 已开启 `writeFeishuBitable`；需先配置 `feishu-config.json`（见 [docs/feishu-bitable-dashboard.md](docs/feishu-bitable-dashboard.md)）。

## 常用命令

```bash
npm run flow:debug-fast -- --flow=request-flow --grep=搜索   # 快速调试
npm run flow:verify -- --flow=request-flow --grep=搜索      # debug → golden 验证
npm run catalog:drift-check                                  # catalog 漂移检测
npm run report:dashboard                                     # flake 趋势
npm run test-job -- list                                     # 定时任务列表
```

## 文档索引

| 主题 | 文档 |
|------|------|
| 协作与目录约定 | [docs/COLLABORATION.md](docs/COLLABORATION.md) |
| flow-kit / flow:new | [docs/flow-kit-and-flow-new.md](docs/flow-kit-and-flow-new.md) |
| 定时 Job | [docs/test-jobs.md](docs/test-jobs.md) |
| AI 职责边界 | [docs/ai-test-boundaries.md](docs/ai-test-boundaries.md) |
| 飞书看板 | [docs/feishu-bitable-dashboard.md](docs/feishu-bitable-dashboard.md) |
| Studio 手册 | [pw-files/README.md](pw-files/README.md) |
| 路线图 | [docs/OPTIMIZATION-ROADMAP.md](docs/OPTIMIZATION-ROADMAP.md) |
