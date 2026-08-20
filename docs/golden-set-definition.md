# Golden Set 定义

> 环境：`stage`（`https://stage.huilianyi.com`）  
> 范围：登录 → 工作台首页 → 我的审批列表  
> 断言预期由人确认；截图走项目 `visualTest` + `compare-screenshots`（非 Playwright 内置 snapshot）

---

## 1. 登录

| 项 | 内容 |
|---|---|
| 入口 URL | `/`（登录页在 iframe 内，非 `/login`） |
| 登录后落地 | `/main/home`（或等价工作台路由） |
| Spec | `tests/optimized/stage/golden-set/01-login.optimized.spec.ts` |
| storageState | **不复用**（空态走 UI 登录） |

### 交互步骤（≤8）

1. 打开 `/`
2. 切到「账号登录」Tab
3. 填写手机号/邮箱
4. 填写密码
5. 勾选用户协议
6. 点击「登 录」
7. 等待离开登录态

### 断言点

| 类型 | 断言 |
|---|---|
| 可见性 | 页面不再呈现登录特征（账号登录 / 用户协议等） |
| 内容 | URL 不含 login；**应用 iframe 内**顶栏 Tab「工作台」可见 |
| 截图 | 登录成功后首页全页（`visualTest` name=`home`） |

---

## 2. 工作台首页

| 项 | 内容 |
|---|---|
| 入口 URL | `/main/home` |
| Spec | `tests/optimized/stage/golden-set/02-dashboard.optimized.spec.ts` |
| storageState | **复用** setup 生成的登录态 |

### 交互步骤（≤8）

1. 打开 `/main/home`
2. 等待页面内容就绪（非登录页）
3. 确认顶栏/侧栏关键区域可见

### 断言点

| 类型 | 断言 |
|---|---|
| 可见性 | 应用 iframe 内 Tab「工作台」可见 |
| 内容 | iframe 侧栏 menuitem 含「我的审批」/「报销单」等入口之一 |
| 截图 | 首页布局全页（`visualTest` name=`dashboard`） |

---

## 3. 我的审批列表

| 项 | 内容 |
|---|---|
| 入口 URL | `/main/approve` |
| Spec | `tests/optimized/stage/golden-set/03-approval-list.optimized.spec.ts` |
| storageState | **复用** setup 生成的登录态 |

### 交互步骤（≤8）

1. 打开 `/main/approve`（或从工作台侧栏进入）
2. 等待列表区域就绪
3. 确认「我的审批」/「待审批」信号可见
4. 确认表格或空态区域可见

### 断言点

| 类型 | 断言 |
|---|---|
| 可见性 | 应用 iframe 内文案含「我的审批」/「待审批」；`.ant-table` / `tablist` 可见 |
| 内容 | 列表或空态区域可见 |
| 截图 | 列表页全页（`visualTest` name=`approval-list`）；动态区由通用 `maskSelectors` 屏蔽 |

---

## 截图与门禁约定

| 约定 | 说明 |
|---|---|
| 落盘路径 | `screenshots/stage/golden-set/<case>/run-*-optimized/<ts>/` |
| Golden | `screenshots-baseline/stage/golden-set/<case>/run-*-optimized/` |
| Mask | `config/ui-regression.json` 通用规则（角标/头像/时间/分页） |
| Gate | `gate.mode=style-only`；Golden Set 不进像素硬门禁（`pixelScriptPrefixes` 仅 `intent/`） |
| 已知噪声 | 工作台首页图表/运营位仍可能产生 ~0.5% warning（复审 `needs_human`），不阻断 gate |

---

## 验收命令

```bash
# Phase 1
npm run test:stage -- --project=optimized tests/optimized/stage/golden-set

# Phase 2
npm run test:ci
```
