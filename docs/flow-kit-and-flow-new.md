# flow-kit 与 flow:new — 新增流程从「两天」到「半小时」

> 索引：[docs/README.md](./README.md)

本文说明四项提速改造的成果与用法。目标读者：要新增一个业务流程测试的人。

- ① `flow-kit` 共享脚手架 + catalog 驱动的通用列表模型
- ② `probe-live-page` → `flow:gen-catalog` 自动生成 catalog
- ③ `flow:new` 一键生成流程骨架并自动注册
- ④ `flow:debug-fast` 缩短单次「跑→挂→改」循环（详见 `docs/flow-debug-acceleration.md`）

## 新增一个流程：完整路径

改造前需要手写 10 个文件、在 ~10 个触点登记流程信息、手工探选择器。现在只剩两件真正需要人判断的事。

### 0. 生成骨架（自动）

```bash
npm run flow:new -- --id=expense-flow --label=报销流程 --entry=/main/expense-parent-report/expense-report --domain=expense
# 先看不落盘的计划：加 --dry-run
```

生成 10 个文件（playwright.config / tsconfig / env / golden-seed / catalog / list.page /
fixtures / golden-regression.spec / golden-seeds.json.example / run-<id>-golden.ts），
并自动注册两处：`scripts/flow/flow-registry.ts` 与 `package.json` 的 scripts。

### 1. 实机探活 + 生成 catalog（半自动）

```bash
# 前提：该环境已有登录态（storageState）。没有先跑登录。
npx tsx scripts/index-frontend/probe-live-page.ts --env=dev --entry=/main/expense-parent-report/expense-report \
  --out=expense-flow/datasource/live-snapshot.json

npm run flow:gen-catalog -- --flow=expense-flow --force
```

产物里所有推断不确定的字段都带 `// TODO(review)`，stdout 会列出「需人工确认 N 项」。
**逐条确认这些 TODO 是唯一必须人工介入的环节。**

### 2. 跑通骨架，再按业务补用例

```bash
npm run flow:debug-fast -- --flow=expense-flow --grep=列表加载
```

骨架自带三条只读用例，同一页串行：打开列表 → 按首行单号搜索 → 打开详情。不在中途重开页面，也不在搜索后重置。跑通后再按页签 / 筛选项补业务用例。

### Studio 配置模式：先解析入口，再探活

在 Studio「配置」页新建流程时，只需填**流程名称**（如「报销流程」）。一键配置会：

1. 从 `datasource/menu_items.json` + `menu_routes.json` 解析列表路由
2. 实机探活（`probe-live-page`）
3. 生成 catalog 草稿

页面入口可留空；也可手填 `/main/...` 路由，或填菜单名如「报销单」。解析逻辑见 `scripts/flow/resolve-flow-entry.ts`。

## 中央注册表：scripts/flow/flow-registry.ts

改造前，「新增一个流程要登记什么」散落在约 10 个地方（package.json scripts、
debug 入口、job 计数、runner 映射表……），漏一个就是一次调试事故。

现在收敛成单一数据源。`FlowDescriptor` 字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 流程目录名，如 `approval-flow` |
| `label` | 中文名，用于日志与报告 |
| `domain` | 业务域，决定 spec 子目录与类名前缀 |
| `entry` | 入口路由，如 `/main/approve` |
| `configRel` / `goldenSpec` / `fullFlowSpec` | Playwright 配置与 spec 路径 |
| `reportDir` | 报告输出目录 |
| `goldenRunner` / `writeRunner` | runner 脚本名，无写流程填 `null` |
| `docNoEnv` / `keywordEnv` / `writeEnvVar` | 环境变量名 |
| `seedsRel` | golden 档案路径 |
| `tabbed` | 列表是否有页签 |

下游全部从它派生，**新增流程不用再改这些文件**：

- `flow:debug-fast` / `flow:run` — 按 `--flow` 查 config 与 spec
- `scripts/jobs/flow-runner-registry.ts` — `buildRunnerScripts()` / `buildRunnerLabels()`
- `flow:gen-catalog` — 按 flow 查 entry 与 snapshot 路径
- `flow:new` — 生成后往 `RAW` 数组追加一条

```bash
npm run flow:list   # 看当前注册了哪些流程
```

## flow-kit：共享脚手架

改造前 `request-flow` 与 `approval-flow` 各有一份 utils / pages / fixtures，
同一份逻辑抄两遍并已开始分叉腐化（approval 侧的 `app-frame.ts` 丢失了
「iframe 里必须看到业务内容」这道校验，导致偶发拿到空白 iframe 才报错）。

现在共享层在 `flow-kit/`：

```
flow-kit/
  index.ts                        统一出口
  list/generic-list-page.ts       通用列表模型（核心）
  pages/login.page.ts             登录页
  pages/home.page.ts              首页
  fixtures/create-flow-fixtures.ts  fixtures 工厂
  utils/app-frame.ts              iframe 作用域解析（已合并两套分叉实现）
  utils/env.ts                    createBaseEnv() + baseEnv
  utils/api-guard.ts              接口等待与失败断言
  utils/golden-seed.ts            golden 档案读取
  utils/catalog-check.cjs         catalog 结构校验
  utils/{request-fields,random,clear-expired-storage,feishu-api-failure}.ts
```

**迁移策略：转发 shim。** 原路径（如 `request-flow/utils/app-frame.ts`）保留
`export * from '../../flow-kit/utils/app-frame'`，所以全程没有大规模改 import。
新代码请直接从 `flow-kit` 引入。

### app-frame 的兼容开关

合并两套实现时保留了向后兼容路径：`requireBiz` 默认开启（iframe 内必须能看到业务内容），
需要退回旧行为时设 `FLOW_APP_FRAME_REQUIRE_BIZ=0`。

### env：createBaseEnv

各 flow 只声明差异字段：

```ts
// <flow>/utils/env.ts
import { createBaseEnv } from '../../flow-kit/utils/env';

export const env = {
  ...createBaseEnv({ writeEnvVar: 'EXPENSE_ENABLE_WRITE' }),
  docNo: process.env.EXPENSE_DOC_NO ?? '',
};
```

`flow-kit` 内部（登录页）用的是 `baseEnv` 常量。**业务 flow 不要直接依赖它的写开关**——
它的 `writeEnvVar` 是空串，写操作会被判定为关闭。

## catalog + GenericListPage

核心思路：**把「这个页面跟别的页面不一样的地方」收敛成一个描述对象，通用逻辑由基类实现。**

改造前两个列表 POM 合计 1593 行，大量重复。现在合计约 1095 行，通用能力集中在
`flow-kit/list/generic-list-page.ts` 一处。

### ListCatalog：一份 UI 契约

```ts
// <flow>/utils/<domain>-catalog.ts
export const EXPENSE_CATALOG: ListCatalog = {
  flowId: 'expense-flow',
  entry: '/main/expense-parent-report/expense-report',
  urlPattern: /main\/expense/,
  listApi: /\/api\/expense\/list/,        // 用于 waitForResponse 与接口侧兜底
  tableSelector: '.ant-table-tbody',
  tabs: ['待提交', '已提交'],              // 无页签填 []
  docNoColumn: '报销单号',
  docNoRegex: /\b[A-Z]{2,6}\d{11,}\b/,
  searchPlaceholder: '请输入报销单号',
  rowActions: { detail: '详情' },
};
```

### GenericListPage 提供的通用能力

| 方法 | 说明 |
| --- | --- |
| `goto()` | 导航到 entry 并等 URL |
| `expectLoaded()` | 等列表接口 + 等 loading 消失 |
| `readHeaders()` | 读表头文本 |
| `pickFirstRowCell(header)` | 取首行指定列 |
| `pickFirstDocNo()` | 取首行单号（按 docNoColumn + docNoRegex） |
| `readDocNoFromListApi()` | 列表为空时从接口侧兜底取单号 |
| `rowByText(text)` | 行定位 |
| `search(keyword)` | 填值 → 点搜索/Enter → 等刷新（子类可 `override`） |
| `restoreDefaultList()` | 清筛选回默认态 |
| `expectRowsGreaterThan(n)` | 行数断言 |
| `expectRowContains(text)` | 任意行包含断言 |
| `expectFirstRowCellContains(header, kw)` | 首行命中 → 任意行命中 → 抛带实际值的错误（三级降级） |
| `columnContains(header, kw)` | 某列是否存在包含值 |

子类只写特有动作。例如 `ApprovalListPage` 保留：页签切换、业务类型下拉、
外露筛选填值（公司弹窗 / 日期日历）、通过 / 驳回、意见弹窗、详情断言。

**每个用例结束都调 `restoreDefaultList()`**，否则筛选状态会在用例间串。

## 自动生成 catalog

### probe-live-page：列表接口自动发现

改造前 `isListApi()` 硬编码了两个流程的接口正则，加第三个流程时探不到任何接口。
现在三层判定：

1. `--list-api=<正则>` 显式覆盖
2. `KNOWN_LIST_API_RE` 已知接口
3. `looksLikeListBody()` 形状自动发现 —— 按「POST + 响应体含数组 + 有分页总数」识别

未命中已知接口但形状像列表的会记进 `listApiCandidates`，stdout 给出提示：

```
[probe] 未命中已知列表接口，但发现 2 个候选：
  POST /api/expense/queryPage  (rows=12, total=137)
  确认后可用 --list-api=<正则> 重探，或直接填进 catalog 的 LIST_API。
```

落在登录页时会明确警告先跑登录生成 storageState。

### gen-catalog-from-probe：快照 → catalog 草稿

```bash
npm run flow:gen-catalog -- --flow=expense-flow --force
npm run flow:gen-catalog -- --flow=expense-flow --check   # 漂移检测，不写文件
```

推断项与手段：

| 字段 | 推断方式 |
| --- | --- |
| 业务 DOM 层 | 在主文档与 childFrames 中按「业务内容评分」挑最高的那层 |
| `tabs` | 去掉运行时计数：`待提交 (3)` → `待提交` |
| `docNoColumn` | 按列名关键词打分 |
| `docNoRegex` | 从实际值反推，如 `BX2026090200457` → `/\b[A-Z]{2,6}\d{11,}\b/` |
| `searchPlaceholder` | 按关键词打分 |
| `tableSelector` / `listApi` | 从快照直接取 |

**`--check` 漂移检测**把实机探到的表头 / 接口 / placeholder 与现有 catalog 逐项比对，
适合放进定时任务，前端改了列名能第一时间发现，而不是等 golden 挂。

### TODO(review)：唯一需要人工介入的环节

生成物是**草稿**。所有「探不到 / 靠猜 / 项目约定」的字段都在**行尾**打 `// TODO(review)`，
同时 stdout 汇总「需人工确认 N 项」。文件位置：`<flow>/utils/<domain>-catalog.ts`。

标记分两类：

**A. 条件触发（探到了就不标）**

| 字段 | 触发条件 | 处理 |
| --- | --- | --- |
| `LIST_API` | 靠形状推断而非已知接口命中 | 从 Network 面板确认真实接口路径 |
| `SEARCH_PLACEHOLDER` | 退化成默认值 `'请输入'` | 抄页面上搜索框的实际 placeholder |
| `COLUMNS` | 未探到任何表头 | 按实机表头顺序补全 |
| `DOC_NO_COLUMN` | 无表头依据（退化成 `'单号'`） | 填实际单号列名 |
| `DOC_NO_RE` | 未从首行文本取到单号样本 | 按实际单号收紧，别留 `[A-Za-z0-9]{8,}` |
| `TABS` | 注册表声明 `tabbed: true` 但没探到 | 确认是页面真没页签，还是 DOM 层挑错了 |
| `ROW_ACTIONS` | 未探到行内按钮（列表为空） | 有数据时重探，或手填 |

**B. 恒定标记（快照里探不到，只能人工填）**

| 字段 | 说明 |
| --- | --- |
| `SEARCH_ACTION_SEARCH` / `SEARCH_ACTION_CLEAR` | 搜索/清空按钮类名，模板给的是项目约定值 `.search-action-*` |
| `EXPOSED_FILTER_FIELDS` | 外露筛选项。模板拿前 3 个表头凑数，**几乎一定要改** |
| `DETAIL` | 详情容器。候选：`.full-screen` / `.approve-entrance` / `.ant-modal` / `.slide-frame` |
| `LOADED_TEXT_RE` | 已加载判据。模板用流程名去「流程」二字，换成页面上稳定出现的文案 |

**登录页快照的特征**：如果 7 项全报、且第一条是「快照其实是登录页」，说明探活时没有有效
storageState。别去逐条填 —— 先跑登录生成 storageState 再重探，否则填的全是登录页的东西。

确认完删掉 `// TODO(review)` 注释即可。`catalog-check.cjs` 只校验结构，**不会**因为
残留 TODO 报错，所以别指望它兜底。

## 踩过的坑（改代码前先看这节）

### 1. probe 会把 iframe 里的登录页当业务页

`probe` 的 `loginRedirect` 只看 URL 与主文档。iframe 内渲染登录页时会漏判 ——
实测某快照 `loginRedirect = false`，但 `childFrames[0].tabs = ["二维码登录","账号登录"]`，
生成器差点把「账号登录」当业务页签写进 catalog。

现在 `looksLikeLoginSnapshot()` 按页签 / 正文文案兜第二层，判定为登录页时强制清空 `tabs`。
**别删这个函数。**

### 2. 模板里不要推正则转义层数

`/a\/b/` 与 `new RegExp('a\\/b')` 的转义层数不同。曾在模板字符串里现推，
生成出 `toHaveURL(/main\\/expense/)` 这种坏码（`TS1109: Expression expected`）。

现在在 `Ctx` 里预计算 `urlReLiteral`（由 `urlRegexBody()` 生成），模板统一用
`/${c.urlReLiteral}/`。**要加新的正则字段就往 Ctx 里加，不要在模板里算。**

### 3. golden runner 派生要换四类内容，不止常量

`tplGoldenRunner` 从 `run-approval-flow-golden.ts` 派生。必须换掉：

1. 流程常量（`FLOW_ID` / `FLOW_LABEL` / `CONFIG_REL` / `SPEC`）
2. 环境变量前缀（`APPROVAL_DOC_NO` → `EXPENSE_DOC_NO`）
3. seed 模块与字段名（`resolveApprovalGoldenSeed` / `approvalDocNo`）
4. **字符串里的流程名** —— 日志前缀 `[approval-flow:golden]`、报告目录
   `approval-flow/playwright-report`

第 4 类最容易漏：它不在常量里，散落十几处模板字符串中，漏了就会往 approval 的
报告目录写、打 approval 的日志。曾有 15 处残留。

现在 `assertNoDonorLeak()` 在生成后自检，有残留直接抛错并列出行号。
**改 donor 后如果 flow:new 报「残留 N 处」，去补 `deriveGoldenRunner` 的替换规则，
不要把自检关掉。**

### 4. golden-seeds.json 的结构

正确结构是 `{ "<envId>": { "<roleSlug>": { "<domain>DocNo": "..." } } }`，
`roleSlug` 找不到时依次回退 `"*"` → `"default"`。

生成器早期版本产出 `{ profiles: [...] }`，与 `resolveFlowGoldenSeed` 读的结构对不上，
golden 永远拿不到单号且不报错。**已修，别改回去。**

seed 解析已收敛到 `pw-files/lib/flow-golden-seed.js`（按 flow id 参数化），
`approval-golden-seed.js` 与 `golden-seed.js` 现在只是保留原导出名的薄封装。

### 5. 区分「既有债」与「新引入错误」

改动面大时 typecheck 报错难判归属。用 worktree 在 HEAD 状态跑一遍对比：

```bash
git worktree add -q --detach /tmp/pw-head HEAD
ln -s "$PWD/node_modules" /tmp/pw-head/node_modules
(cd /tmp/pw-head && npx tsc --noEmit -p tsconfig.json) 2>&1 | ... > /tmp/head-errs.txt
comm -23 /tmp/cur-errs.txt /tmp/head-errs.txt   # 只在当前出现的 = 你引入的
git worktree remove /tmp/pw-head --force
```

### 6. Grep 工具偶发在生成文件上返回空

对刚写入的 `run-<id>-golden.ts` 用 `Grep` 可能返回空结果，`grep -c` 却报有匹配，
一度误判「替换完全没生效」。**核验生成物时用 python 逐行 `re.search` 更可靠。**

## 分层验证清单

```bash
# 1. typecheck（最轻，先跑）
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p <flow>/tsconfig.json

# 2. 结构校验
npm run flow:list
npm run flow:debug-fast -- --list
node <flow>/utils/catalog-check.cjs

# 3. smoke
npm run flow:debug-fast -- --flow=<id> --grep=列表加载

# 4. 完整 golden
npm run <id>:golden
```

相关文档：`docs/flow-debug-acceleration.md`（调试提速）、
`docs/ui-contract-from-source.md`（从源码提 UI 契约）、`docs/golden-set-definition.md`。
