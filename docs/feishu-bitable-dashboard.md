# 飞书多维表内置仪表盘搭建指南

> 索引：[docs/README.md](./README.md)

## 流程总览

飞书多维表涉及 **三层权限 / 两类操作**，不要混在一起：

| 层级 | 在哪配置 | 做几次 | 干什么 |
|------|----------|--------|--------|
| 开放平台应用权限 | [开发者后台](https://open.feishu.cn/app) | **一次** | 让应用能用 API 读写多维表 |
| 文档协作者权限 | 项目脚本 `feishu:grant-bitable-editor` | **每个要编辑 UI 的人一次** | 让你在飞书里建仪表盘（所有者是 @自动化测试 时必需） |
| 日常数据写入 | `npm run feishu:bitable` / test-job | **每次跑测试** | 写入执行记录、问题明细、日汇总 |
| UI 反馈写入 | `npm run feishu:feedback-write` / 客户报告标注 | **每次登记** | 写入 UI 采集反馈表（手动） |

```
┌─────────────────────────────────────────────────────────┐
│  一次性 Setup（管理员 / 首次接入的人）                      │
│  ① 开发者后台开权限 → ② .env 配表 ID → ③ grant 编辑权   │
│  → ④ UI 建仪表盘 → ⑤ 配 FEISHU_BITABLE_DASHBOARD_URL   │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│  日常流程（CI / test-job / 手动跑测试）                    │
│  compare-screenshots → feishu:bitable 自动写入           │
│  手动登记 → feedback:submit → feishu:feedback-write      │
│  feedback:import → 规则入库 → 下次 Golden 自动验证        │
│  （不需要再跑 grant，不需要再改开发者后台）                 │
└─────────────────────────────────────────────────────────┘
```

**结论：开发者后台开权限 ≠ 你在 UI 里能编辑。** API 写入和 UI 编辑是两套权限；grant 脚本只用于 onboarding，**不接入 CI / test-job**。

---

## 一、一次性 Setup

### 1. 开发者后台（应用权限）

在 **开发配置 → 权限管理** 开通并 **发布版本**：

| 权限代码 | 必需场景 |
|----------|----------|
| `bitable:app` | 多维表格读写（**通常已开**，建表/写记录就靠它） |
| `docs:permission.member:create` | **添加云文档协作者**（`grant-bitable-editor` 推荐开这个） |
| `contact:user.id:readonly` | 用手机号/邮箱查 open_id（grant 时用） |

> **注意**：文档旧版写的 `drive:permission` 在现行飞书后台**已搜不到**，不必找。给个人开编辑权用上面第二项即可。

`.env` 最小配置：

```bash
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_BITABLE_APP_TOKEN=
FEISHU_BITABLE_RUN_TABLE_ID=
FEISHU_BITABLE_ISSUE_TABLE_ID=
FEISHU_BITABLE_DAILY_SUMMARY_TABLE_ID=
FEISHU_BITABLE_FEEDBACK_TABLE_ID=   # UI 采集反馈表（手动登记，见第三节）
FEISHU_BITABLE_DASHBOARD_URL=    # 第 4 步建完仪表盘后再填
```

校验表字段是否齐全：

```bash
npm run feishu:bitable-setup
npm run feishu:bitable-setup -- --fix-fields   # 缺字段时自动补
```

### 2. 给自己 UI 编辑权限（Base 所有者是 @自动化测试 时）

应用创建的 Base，组织链接默认「可阅读」。**不需要去开 `drive:permission`**（后台已无此项），按下面做即可。

**方式 A（推荐）：跑 grant 脚本**

```bash
# 仅查 open_id
npm run feishu:grant-bitable-editor -- --mobile=13800138000 --lookup
npm run feishu:grant-bitable-editor -- --email=you@company.com --lookup

# 查 open_id 并授权「可编辑」
npm run feishu:grant-bitable-editor -- --mobile=13800138000
npm run feishu:grant-bitable-editor -- --email=you@company.com
npm run feishu:grant-bitable-editor -- --open-id=ou_xxxxxxxx
```

脚本依赖的应用权限（开发者后台 → 权限管理 → 搜索）：

| 在后台搜这些词 | 权限代码 |
|----------------|----------|
| **添加云文档协作者** | `docs:permission.member:create` |
| 查看、评论、编辑和管理多维表格 | `bitable:app`（多半已有） |
| 以应用身份访问通讯录 | `contact:user.id:readonly`（用手机号查人时需要） |

开通后记得 **创建版本并发布**。

**方式 B（不开新权限）：请管理员在飞书里手动加你**

若你有同事能管理该 Base：右上角 **分享** → 添加你为 **可编辑** 协作者。  
所有者是机器人时，在 UI 里点「申请编辑」无效，只能由有管理权的人分享。

授权后刷新 Base，左下角应能 **「+ → 仪表盘」**。  
**每个需要建/改仪表盘的人跑一次即可**；日常测试不必重复执行。

### 3. UI 创建仪表盘

飞书暂不支持 Open API **从零创建**仪表盘，需在客户端手动新建：

1. 打开多维表格 Base
2. 左下角 **「+ → 新建仪表盘」**，命名 **UI 质量看板**
3. 按下方 [推荐图表](#推荐图表-8-个) 添加组件
4. 复制 URL（含 `block=blk...`）写入 `FEISHU_BITABLE_DASHBOARD_URL`

获取已有仪表盘 URL：

```bash
npm run feishu:bitable-setup   # 会列出 block_id 和建议 URL
```

---

## 二、日常流程（每次测试）

以下步骤随 test-job / CI **自动执行**，无需人工干预：

| 步骤 | 命令 / 触发点 | 说明 |
|------|---------------|------|
| 截图对比 | `compare-screenshots` | 生成 `results/ui-issues.json` |
| 写入多维表 | `writeFeishuBitable: true` 或 `npm run feishu:bitable` | upsert 执行记录 / 问题明细 / 日汇总 |
| 生成 AI 分析文档 | `compare-screenshots` 自动 | `results/ui-feedback-docs/latest.md`（compact，默认） |
| 手动登记反馈 | 客户报告「标注问题」或 `npm run feedback:submit` | 本地 `results/manual-feedback.json` |
| 同步反馈到飞书 | `npm run feishu:feedback-write` | upsert UI 采集反馈表 |
| 导入为回归规则 | `npm run feedback:import` | 写入 `ui-audit-rules` + `structureChecks` |
| 通知 | 飞书卡片 | 含报告链接、质量看板链接（若已配 URL） |
| HTML 仪表盘 | `npm run report:dashboard` | 本地/CI 静态页，不依赖飞书 UI 权限 |

手动补写一次：

```bash
npm run feishu:bitable
```

```bash
npm run feishu:bitable
npm run feishu:feedback-write   # 仅当有新的手动登记时
npm run feedback:import         # 将待处理反馈导入回归规则（按需）
```

**日常流程不需要：** 再跑 grant、再改开发者后台、再在 UI 里建表。

---

## 三、UI 采集反馈表 Setup（手动登记）

中控页面 **Cmd+B / Ctrl+B** 登记的 UI 问题，以及客户报告里的 **「标注问题」**，最终可落到同一张「UI 细节例外」反馈表，并与自动回归闭环。

### 1. 建表

在飞书多维表 Base 中新建数据表，建议命名 **UI采集反馈**（或与 Wiki「UI细节例外收集与管理」对齐）。

复制表 ID 写入：

```bash
FEISHU_BITABLE_FEEDBACK_TABLE_ID=tblxxxxxxxx
```

或 `feishu-config.json`：

```json
"bitable": {
  "feedbackTableId": "tblxxxxxxxx"
}
```

### 2. 自动补字段

```bash
npm run feishu:feedback-table-setup    # 在 Base 内新建「UI采集反馈」表并写 .env
npm run feishu:bitable-setup -- --fix-fields
```

`setup` 会校验 **执行记录 / 问题明细 / 日汇总 / UI采集反馈** 四张表。反馈表字段如下：

| 字段名 | 类型 | 用途 |
|--------|------|------|
| feedback_id | 文本 | 唯一键（如 `mf-1788244766437-txd766`） |
| reporter | 文本 | 登记人姓名 |
| description | 文本 | 问题描述（支持 `@负责人`） |
| env | 单选 | dev / uat / stage9084 / stage |
| page_url | 超链接 | 页面地址 |
| route | 文本 | 路由或 URL 文本 |
| element_selector | 文本 | 目标元素选择器 |
| element_xpath | 文本 | XPath 兜底 |
| element_bbox | 文本 | 框选区域 `x,y,w,h` |
| screenshot_url | 超链接 | 截图路径或外链 |
| ai_doc_url | 超链接 | AI 分析文档（`latest.md#<id>` 或单条 `.md`） |
| assignees | 文本 | 从描述解析的 `@` 负责人 |
| status | 单选 | 待处理 / 处理中 / 已修复 / 忽略 |
| created_at | 日期 | 登记时间 |

若你方飞书表字段名不同，改 `config/feedback-import.json` 的 `fields` 映射后再跑 `feedback:import`。

### 3. 登记入口

| 入口 | 说明 |
|------|------|
| 中控 Cmd+B | 产品/测试在页面内框选 + 填描述（Wiki 流程） |
| 客户报告「登记问题」 | 需 `npm run studio`；点按钮即登记对比问题（登记人默认「机器人」，描述自动取自对比结论） |
| CLI | `npm run feedback:submit -- --json='{"reporter":"张三","description":"@李四 按钮未对齐"}'` |

登记后本地产出：

- `results/manual-feedback.json` — 结构化列表
- `results/ui-feedback-docs/latest.md` — 汇总 AI 分析文档（每条以 `## <id>` 分段；`aiDocPath` 为 `latest.md#<id>`）

**存储模式：** 默认 compact（单文件 `latest.json` + `latest.md`），避免每条 issue 单独占一个 `.md`。若需恢复旧行为（每条单独文件），设环境变量 `UI_FEEDBACK_DOC_SPLIT=1`。按需导出单条：

```bash
npm run feedback:docs -- --export=mf-xxx --out=tmp.md
```

### 4. 写入飞书

```bash
npm run feishu:feedback-write
npm run feishu:feedback-write -- --entry=mf-xxx   # 指定单条
```

`feedback:submit` 默认会尝试同步飞书（`syncFeishu: false` 可跳过）。

### 5. 导入为自动回归规则

```bash
npm run feedback:import              # 飞书反馈表 + 本地 manual-feedback
npm run feedback:import -- --local-only
npm run feedback:import -- --feishu-only
npm run feedback:import -- --dry-run
```

导入结果：

| 写入位置 | 内容 |
|----------|------|
| `config/ui-audit-rules.json` | `expect` 业务白名单（含 `@负责人` 描述） |
| `config/ui-regression.json` → `structureChecks.items` | 有 `selector` 时新增监测项 |
| `results/feedback-import-log.json` | 导入日志 |

下次跑 Golden / `compare-flow-screenshots` 时会自动验证该问题是否仍存在。

### 6. 与自动回归问题明细的关系

| 维度 | 问题明细（issue） | UI 采集反馈（feedback） |
|------|-------------------|-------------------------|
| 来源 | `automated`（默认） | `manual` |
| 触发 | compare / ui-audit | 人登记 |
| 表 | `FEISHU_BITABLE_ISSUE_TABLE_ID` | `FEISHU_BITABLE_FEEDBACK_TABLE_ID` |
| AI 文档 | `ai_doc_path` / `ai_doc_url` | 同上 |
| 闭环 | 直接参与 gate | 经 `feedback:import` 进入规则后再参与回归 |

问题明细表在原有字段基础上已扩展（`feishu:bitable-setup --fix-fields` 可补）：

| 字段名 | 类型 | 用途 |
|--------|------|------|
| source | 单选 | automated / manual |
| reporter | 文本 | 登记人（手动时有值） |
| description | 文本 | 问题描述 |
| element_xpath | 文本 | 元素 XPath |
| element_selector | 文本 | CSS 选择器 |
| ai_doc_path | 文本 | 分析文档相对路径 |
| ai_doc_url | 超链接 | 分析文档外链（配了 `PUBLIC_REPORT_URL` 时） |

---

## 四、按需工具（排障 / 新人 onboarding）

| 命令 | 何时用 |
|------|--------|
| `npm run feishu:bitable-setup` | 检查字段、列出仪表盘 URL |
| `npm run feishu:grant-bitable-editor` | 新人要编辑 Base / 建仪表盘 |
| `npm run feishu:feedback-write` | 手动反馈写入飞书反馈表 |
| `npm run feedback:submit` | CLI 登记一条 UI 反馈 |
| `npm run feedback:import` | 反馈 → 回归规则 |
| `npm run feedback:docs` | 从 `ui-issues.json` 补生成 AI 分析文档 |
| `npm run report:dashboard` | 飞书 UI 暂时没权限时的替代看板 |

---

## 表结构

### 执行记录（run）

| 字段名 | 类型 | 用途 |
|--------|------|------|
| execution_id | 文本 | 唯一键 |
| executed_at | 日期 | 执行时间 |
| status | 单选 | success / failed / aborted / skipped |
| blocker_count | 数字 | Blocker 数 |
| warning_count | 数字 | Warning 数 |
| golden_count | 数字 | golden 对比计数 |
| cross_browser_count | 数字 | 跨浏览器计数 |
| run_drift_count | 数字 | run-drift 计数 |
| report_url | 超链接 | HTML 报告 |
| feishu_doc_url | 超链接 | 飞书文档 |

### 问题明细（issue）

| 字段名 | 类型 | 用途 |
|--------|------|------|
| severity | 单选 | blocker / warning / noise / info |
| script_key | 文本 | 脚本 |
| compare_kind | 单选 | golden / cross-browser / run-drift / structure / style-drift |
| difference_percent | 数字 | 差异百分比 |
| route | 文本 | 路由 |
| browser | 单选 | chrome / webkit |
| source | 单选 | automated / manual |
| reporter | 文本 | 登记人 |
| description | 文本 | 问题描述 |
| element_selector | 文本 | 目标选择器 |
| element_xpath | 文本 | XPath |
| ai_doc_path | 文本 | AI 分析文档路径 |
| ai_doc_url | 超链接 | AI 分析文档链接 |

> **噪声口径**：`noise` 级问题**默认不写入**问题明细表（严重度分布/图表不被噪声淹没），
> run 表「噪声问题」列仍记录运行事实；日汇总不受影响（统计来自本地报告，不读表）。
> 需要恢复旧行为时设 `FEISHU_BITABLE_WRITE_NOISE=1`。存量噪声行清理：
> `npm run feishu:bitable-maintain -- --prune-issue-noise-only`（dry-run 预览，加 `--apply` 执行）。

### 执行记录（run）——关于「重复记录」

CLI 直跑（`compare-screenshots` → `feishu:bitable`）时 `execution_id` 含生成时间戳，每跑一次生成一条新记录——这是**真实多次执行**的语义，不是重复噪声；test-job 场景 `runId` 稳定、重试会 upsert 同一条。日汇总已按 `countedExecutions` 去重，KPI 不受影响。看「最近执行」时建议按「任务」分组、执行时间降序。

### 日汇总（daily）

| 字段名 | 类型 | 用途 |
|--------|------|------|
| date | 日期 | 汇总日期 |
| env | 单选 | 环境 |
| blocker_count | 数字 | 当日 Blocker |
| warning_count | 数字 | 当日 Warning |
| pass_rate | 数字 | 通过率 |
| blocker_delta | 数字 | 较上日变化 |
| warning_delta | 数字 | 较上日变化 |

### UI 采集反馈（feedback）

见 [第三节](#三ui-采集反馈表-setup手动登记)。

### UI 验收明细（delivery）/ UI 验收汇总（delivery-summary）

交付链路两张表：明细一行一个检测项（单选判定/浏览器/迭代带语义色、差异% 数值列可排序聚合），
汇总一行一个交付批次（通过率%/覆盖率%/问题数，跨迭代对比）。字段全表与迁移 runbook见
[feishu-customer-delivery.md §6](./feishu-customer-delivery.md#6-多维表字段)。

---

## 推荐图表（9 个）

### ① 日趋势 · Blocker / Warning

| 项 | 值 |
|----|-----|
| 数据源 | 日汇总 |
| 图表 | 折线图 |
| 横轴 | date（按天） |
| 纵轴 | blocker_count、warning_count |
| 筛选 | env = stage（按需） |

### ② 日趋势 · 通过率

| 项 | 值 |
|----|-----|
| 数据源 | 日汇总 |
| 图表 | 折线图 |
| 横轴 | date |
| 纵轴 | pass_rate |

### ③ 最近执行

| 项 | 值 |
|----|-----|
| 数据源 | 执行记录 |
| 图表 | 表格 |
| 列 | executed_at、status、blocker_count、warning_count、report_url |
| 排序 | executed_at 降序 |
| 条数 | 10 |

### ④ 严重度分布

| 项 | 值 |
|----|-----|
| 数据源 | 问题明细 |
| 图表 | 饼图 |
| 维度 | severity |
| 指标 | 记录数 |

### ⑤ Blocker TOP 脚本

| 项 | 值 |
|----|-----|
| 数据源 | 问题明细 |
| 图表 | 柱状图 |
| 维度 | script_key |
| 指标 | 记录数 |
| 筛选 | severity = blocker |
| 条数 | 10 |

### ⑥ 对比类型分布

| 项 | 值 |
|----|-----|
| 数据源 | 问题明细 |
| 图表 | 柱状图 |
| 维度 | compare_kind |
| 指标 | 记录数 |

### ⑦ 对比类型趋势

| 项 | 值 |
|----|-----|
| 数据源 | 执行记录 |
| 图表 | 堆叠柱状图 |
| 横轴 | executed_at（按天） |
| 纵轴 | golden_count、cross_browser_count、run_drift_count |

### ⑧ KPI · 最新 Blocker

| 项 | 值 |
|----|-----|
| 数据源 | 日汇总 |
| 图表 | 数字卡 |
| 指标 | blocker_count |
| 聚合 | 最新值 / 最大值 |

### ⑨ 待处理 UI 反馈（可选）

| 项 | 值 |
|----|-----|
| 数据源 | UI采集反馈 |
| 图表 | 表格 |
| 列 | created_at、reporter、description、status、ai_doc_url |
| 筛选 | status = 待处理 |
| 排序 | created_at 降序 |

---

## 配置仪表盘 URL

```
https://xxx.feishu.cn/base/{appToken}?block={blockId}
```

写入 `.env` 的 `FEISHU_BITABLE_DASHBOARD_URL` 或 `feishu-config.json` 的 `bitable.dashboardUrl`。

配置后：`feishu:bitable` 日志、飞书卡片「质量看板」按钮、HTML 质量仪表盘均会链到该 URL。

---

## 布局建议

```
┌─────────────────────────────────────────────────────┐
│  [KPI Blocker]  [KPI Warning]  [KPI 通过率]        │
├──────────────────────────┬──────────────────────────┤
│  日趋势 Blocker/Warning   │  严重度饼图               │
├──────────────────────────┼──────────────────────────┤
│  Blocker TOP 脚本         │  对比类型分布             │
├──────────────────────────┴──────────────────────────┤
│  最近执行记录（表格，含 report_url 链接）              │
└─────────────────────────────────────────────────────┘
```

---

## 常见问题

**Q: 开发者后台权限开了，为什么 UI 还是不能编辑？**  
应用权限只管 API；UI 编辑需要文档协作者「可编辑」。所有者是 @自动化测试 时，跑 `feishu:grant-bitable-editor`。

**Q: grant 要每次测试都跑吗？**  
不用。每人授权一次即可；日常只跑 `feishu:bitable`。

**Q: 图表无数据？**  
先跑 `npm run feishu:bitable`，确认三张表有记录。

**Q: report_url 不是链接？**  
重新写入执行记录（URL 字段格式 `{ link, text }`）。

**Q: 能否 API 自动建仪表盘？**  
不能从零创建；用 UI 建完后把 URL 配到 `FEISHU_BITABLE_DASHBOARD_URL`。

**Q: 手机号查不到 open_id？**  
确认已开 `contact:user.id:readonly`、应用可见范围包含该用户、手机号在企业通讯录。海外号码带 `+区号`。

**Q: 申请编辑权限没反应？**  
所有者是机器人，不会处理。用 `feishu:grant-bitable-editor` 代替。

**Q: 客户报告「标注问题」失败？**  
需先 `npm run studio`（默认 `http://localhost:3001`）。本地 `file://` 打开报告时会回连该地址。

**Q: feedback:import 读不到飞书表？**  
确认 `FEISHU_BITABLE_FEEDBACK_TABLE_ID` 与 `config/feedback-import.json` 字段名一致；`--local-only` 可仅导入本地 `manual-feedback.json`。

**Q: AI 分析文档在哪？**  
默认 `results/ui-feedback-docs/latest.md`（compact）；`latest.json` 存结构化索引。设 `UI_FEEDBACK_DOC_SPLIT=1` 可恢复每条单独 `.md`。compare / submit 后自动生成；单条导出：`npm run feedback:docs -- --export=<id> --out=tmp.md`。

---

## 关联脚本

| 脚本 | 类型 |
|------|------|
| `scripts/feishu/write-bitable-report.ts` | 日常写入（执行记录 / 问题明细 / 日汇总；noise 默认过滤） |
| `scripts/feishu/write-feedback-bitable.ts` | 手动反馈写入飞书 |
| `scripts/feishu/setup-bitable-dashboard.ts` | 一次性 / 排障（含 UI 验收汇总表校验） |
| `scripts/feishu/grant-bitable-editor.ts` | 一次性 / 按人 onboarding |
| `scripts/feishu/migrate-delivery-bitable.ts` | 一次性迁移：明细列中文化/类型规范化/历史回填/汇总重建（`feishu:delivery-migrate`） |
| `scripts/feedback/import-feedback.ts` | 反馈 → 回归规则 |
| `scripts/feedback/submit-manual-feedback.ts` | CLI 登记反馈 |
| `scripts/report/ui-feedback-doc.ts` | AI 分析文档生成 |
| `scripts/report/generate-feedback-docs.ts` | 从 ui-issues 补生成文档 |
| `config/feedback-import.json` | 飞书反馈表字段映射 |
| `scripts/report/generate-quality-dashboard.ts` | 日常 / 离线替代看板 |
