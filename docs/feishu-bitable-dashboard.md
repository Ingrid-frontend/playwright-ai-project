# 飞书多维表内置仪表盘搭建指南

## 流程总览

飞书多维表涉及 **三层权限 / 两类操作**，不要混在一起：

| 层级 | 在哪配置 | 做几次 | 干什么 |
|------|----------|--------|--------|
| 开放平台应用权限 | [开发者后台](https://open.feishu.cn/app) | **一次** | 让应用能用 API 读写多维表 |
| 文档协作者权限 | 项目脚本 `feishu:grant-bitable-editor` | **每个要编辑 UI 的人一次** | 让你在飞书里建仪表盘（所有者是 @自动化测试 时必需） |
| 日常数据写入 | `npm run feishu:bitable` / test-job | **每次跑测试** | 写入执行记录、问题明细、日汇总 |

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
| `bitable:app` | API 读写多维表（**必开**） |
| `drive:permission` | 用脚本给人加「可编辑」协作者 |
| `contact:user.id:readonly` | 用邮箱/手机号查 open_id（grant 时用） |

`.env` 最小配置：

```bash
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_BITABLE_APP_TOKEN=
FEISHU_BITABLE_RUN_TABLE_ID=
FEISHU_BITABLE_ISSUE_TABLE_ID=
FEISHU_BITABLE_DAILY_SUMMARY_TABLE_ID=
FEISHU_BITABLE_DASHBOARD_URL=    # 第 4 步建完仪表盘后再填
```

校验表字段是否齐全：

```bash
npm run feishu:bitable-setup
npm run feishu:bitable-setup -- --fix-fields   # 缺字段时自动补
```

### 2. 给自己 UI 编辑权限（Base 所有者是 @自动化测试 时）

应用创建的 Base，组织链接默认「可阅读」，需用应用身份授权：

```bash
# 仅查 open_id
npm run feishu:grant-bitable-editor -- --mobile=13800138000 --lookup
npm run feishu:grant-bitable-editor -- --email=you@company.com --lookup

# 查 open_id 并授权「可编辑」
npm run feishu:grant-bitable-editor -- --mobile=13800138000
npm run feishu:grant-bitable-editor -- --email=you@company.com
npm run feishu:grant-bitable-editor -- --open-id=ou_xxxxxxxx
```

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
| 写入多维表 | `writeFeishuBitable: true` 或 `npm run feishu:bitable` | upsert 三张表 |
| 通知 | 飞书卡片 | 含报告链接、质量看板链接（若已配 URL） |
| HTML 仪表盘 | `npm run report:dashboard` | 本地/CI 静态页，不依赖飞书 UI 权限 |

手动补写一次：

```bash
npm run feishu:bitable
```

**日常流程不需要：** 再跑 grant、再改开发者后台、再在 UI 里建表。

---

## 三、按需工具（排障 / 新人 onboarding）

| 命令 | 何时用 |
|------|--------|
| `npm run feishu:bitable-setup` | 检查字段、列出仪表盘 URL |
| `npm run feishu:grant-bitable-editor` | 新人要编辑 Base / 建仪表盘 |
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
| severity | 单选 | blocker / warning / noise |
| script_key | 文本 | 脚本 |
| compare_kind | 单选 | golden / cross-browser / run-drift |
| difference_percent | 数字 | 差异百分比 |
| route | 文本 | 路由 |
| browser | 单选 | chrome / webkit |

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

---

## 推荐图表（8 个）

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

---

## 关联脚本

| 脚本 | 类型 |
|------|------|
| `scripts/feishu/write-bitable-report.ts` | 日常写入 |
| `scripts/feishu/setup-bitable-dashboard.ts` | 一次性 / 排障 |
| `scripts/feishu/grant-bitable-editor.ts` | 一次性 / 按人 onboarding |
| `scripts/report/generate-quality-dashboard.ts` | 日常 / 离线替代看板 |
