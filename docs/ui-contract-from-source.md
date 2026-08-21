# 用前端源码生成 UI 契约，提升 PW 脚本稳定性

## 1. 目标

回答一个具体问题：**给 AI 前端仓库的读取权限，能不能生成更稳的 Playwright 脚本？**

结论是能，但前提是「怎么用源码」这件事做对。本文记录方案、实测数据，以及两个只能靠实机才能发现的坑。

---

## 2. 核心原则：索引，不是灌源码

把源码整段塞进 prompt 有两个问题：token 爆炸，而且模型会照着源码**发明运行时不存在的选择器**。

所以走「离线索引 → 按路由切片注入」：

| 阶段 | 做什么 |
|------|--------|
| 离线索引 | 扫全仓，产出 `datasource/ui-contract.json`（719 条路由） |
| 生成时注入 | 只取命中路由的那一片（约 3.2K 字符 / 900 token） |
| 硬约束 | 「只能用契约里的文案，不得编造 testid」 |
| 运行时兜底 | 契约文案找不到时允许回退到语义等价文案 |

源码是**高置信提示，不是唯一真相**。

---

## 3. 契约里放什么

都是「靠经验猜必然猜错」的事实：

| 事实 | 为什么关键 |
|------|-----------|
| 该路由是否在 iframe 内 | `/main/**` 实测 iframe 数为 0，登录页才有 iframe。猜错会写出无用的双路径 fallback |
| antd 版本与组件清单 | v3 的 Table 不输出 `role="row"`，`getByRole('row')` 必挂 |
| 表格是否虚拟滚动 | 只渲染视口内行，「第 N 行必在 DOM」的假设不成立 |
| 列表主数据源接口 | 用来替代 `waitForLoadState('networkidle')` |
| i18n key → 文案 | 全仓仅 3 个 `data-testid`，但 `messages("key")` 出现约 5800 次 |

表格封装有 5 层（`AdvancedTable → table → resize-table → antd Table`，第 5 层还有 `VirtualTable`），
只看直接 import 会漏判，索引器需追到 depth 6。

---

## 4. 两个实机才能发现的坑

静态索引会产生「看着对、跑起来错」的内容，必须实机核对。

**坑一：运行时拼接文案**

源码里页签是 `messages("request-4.key2561")` → `待审批-全部`，
但渲染逻辑是 `{item.label} ({count})`，实际 DOM 是 `待审批-全部 (1)`。
契约若标注「可 exact 匹配」，模型就会写 `exact: true` 并稳定失败。
现已改为默认子串匹配，tab / column 角色显式标注禁止 exact。

**坑二：命名近似、语义相反的接口**

| 路径 | 真实语义 |
|------|---------|
| `/api/approvals/pending` | 单据**暂挂**（`handleEntityHangUp`） |
| `/api/approvals/pendingApproval` | 待审批**列表**（`getPendingApproveList`） |

纯看 URL 会挑中前者，等它必然超时。判据不能是路径，而是
**所属 service 函数名 + 该函数是否在页面容器里被真正调用**。
此外列表接口大量写成 `const url = ...` 再调用，只匹配 `.post(` 会整条漏掉。

---

## 5. 实测数据

同一条自然语言用例，`--entry=/main/approve --env=stage`，真实 LLM 生成 + 真实浏览器执行：

| 版本 | 通过率 | 平均耗时 | 失败原因 |
|------|--------|---------|---------|
| 无契约 | 6/8、4/5 | 约 8.4s | 未等接口就点行，列表未渲染 |
| 有契约（接口/文案修正前） | 0/5 | 约 25.6s | 等错接口 + `exact` 匹配失败 |
| 有契约（修正后） | **5/5、8/8** | 约 8.0s | 无 |

中间那行是本方案的教训：**契约错比没契约更糟**，因为模型会完全信任它。

---

## 6. npm 脚本

| 脚本 | 作用 |
|------|------|
| `npm run index:frontend -- --repo=<前端仓库路径>` | 重建全量 `datasource/ui-contract.json`（本地生成，不入库） |
| `npm run index:frontend:probe -- --env=stage --entry=/main/approve` | 实机核对：打印页签 / 表头 / 表格类名 / 实际接口 |
| `npm run index:frontend:ab -- --file=<脚本> --env=stage --entry=<路由> --runs=8` | 重复执行统计通过率 |

生成脚本默认注入契约，`--no-contract` 可关闭用于 A/B。

加载顺序：本地全量 `datasource/ui-contract.json`（gitignore）→ 仓库内 `datasource/ui-contract.seed.json`（golden 相关少量路由）。

**前端仓库变更后需重建索引**，否则契约会过期而模型仍然全盘信任它。

---

## 7. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-21 | 首版：索引器 + 契约注入 + A/B 实测；修正接口语义判定与文案匹配策略；修正 `03-approval-list` 的 iframe 误判 |
