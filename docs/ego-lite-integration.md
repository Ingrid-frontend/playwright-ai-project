# ego lite 集成

ego lite 是 Chromium 内核浏览器，Agent 在独立 task space 中操作，**默认继承当前用户的登录态**。
这一点正好补上本项目最贵的一环：验证一条定位链是否还成立，原本要先 `npm run login` 拿
storageState、再跑完 90s 的完整用例；现在几秒钟就能问出答案。

## 已接入：选择器体检

```bash
npm run ego:audit -- tests/optimized/stage/260814/studio-unsaved-draft.optimized.spec.ts
```

它做三件事：

1. 解析 optimized spec 中每个步骤的定位链（`getByText` / `getByRole` / `getByLabel` / `locator` 等）
2. 在 ego lite 已登录页面里逐 frame 复算每条链的匹配数
3. 按四种结论输出：健康、未匹配、多重匹配、存在但不可见

### 选项

| 选项 | 说明 |
| --- | --- |
| `--url=<path 或 url>` | 体检页面，默认取 spec 里的 `page.goto` 目标 |
| `--env=<env>` | 解析 baseURL 用的环境名，默认 `stage` |
| `--json=<file>` | 结果写入 JSON |
| `--settle=<sec>` | 页面加载后额外等待秒数，默认 3 |
| `--keep-tab` | 体检后保留 task space 与页面（便于手动登录或人工查看） |

### 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 无必经步骤断裂 |
| 1 | 有必经步骤定位失败 |
| 2 | ego lite 不可用（未安装 / 未启动 / 进程在沙箱内） |
| 3 | task space 被用户接管 |
| 4 | ego lite 中该环境尚未登录 |

### 结论怎么读

- **未匹配**：UI 漂移或前置状态没到位。输出里的「断在第 N 段」直接指出链条哪一环失效。
- **多重匹配**：`.first()` 正在承担顺序依赖 —— 今天点对了，明天列表顺序一变就点错，建议收窄定位。
- **存在但不可见**：元素在 DOM 里但不可见，通常是需要先展开面板、切页签，或遮罩未消失。

`role` / `text` 是**近似复算**（不完整复刻 Playwright 引擎），结论用于快速定位可疑步骤，
最终仍以 Playwright 实际运行为准。

## 前置条件

1. 安装并启动 ego lite，确保 `ego-browser` 在 PATH 中（默认 `~/.local/bin/ego-browser`）
2. 在 ego lite 里手动登录一次目标环境，登录态会被后续体检复用
3. 不要在沙箱内运行 —— 沙箱会阻断 `ego_cli` bootstrap

## 与 Midscene 的分工

| 维度 | ego lite | Midscene |
| --- | --- | --- |
| 定位方式 | 真实 DOM / CDP | 视觉模型 |
| 登录态 | 复用用户浏览器 | 依赖 storageState |
| 成本 | 无 API 费用 | 需视觉模型密钥 |
| 适合 | 跑之前的静态体检、探查页面结构 | 运行中定位失败的兜底 |

两者不冲突：ego lite 管「跑之前先问清楚」，Midscene 管「跑的时候救一把」。

## 离线校验

解析与合并逻辑有不依赖浏览器的校验，已挂进 CI：

```bash
node scripts/verify/verify-ego-selector-probe.cjs
```

## 后续可扩展方向

- **失败后自动体检**：`notify-failure` / `heal-spec` 里，失败步骤直接跑一次体检，把「断在第几段」写进飞书通报。
- **顺序 replay**：现在是在单一页面上复算所有步骤；对深层步骤可扩展为按 spec 顺序真实点击后再体检。
- **pipeline 质量门禁**：`pipeline-raw-to-optimized` 产出后立刻体检，多重匹配的定位在合入前就收窄。
- **登录态导出**：把 ego lite 会话导成 `storage/loginState/*.json`，省掉 `npm run login`（注意凭据落盘风险）。
