# Headless 执行与报告分享

录制需要图形界面；**执行、查看结果**可在 CI / 服务器 headless 完成，通过网页链接分享给团队。

## 推荐链路

```
本地/Studio 录制 → 提交 Git → CI headless 跑用例
  → HTML Report + UI 对比报告 +（失败时）trace/视频
  → Artifact 或 GitHub Pages → 团队浏览器查看
```

## 本地 / CI 命令

| 命令 | 说明 |
|------|------|
| `npm run test:ci` | Headless 跑 optimized + webkit（与 CI 一致） |
| `npm run report` | 本地打开 `playwright-report/` |
| `npm run report:bundle` | 打包 `public-reports/` 静态目录 |
| `npm run trace:show` | 打开最新 `test-results/**/trace.zip` |
| `npm run screenshot-report` | UI 截图对比 HTML |

## Playwright 配置（已启用）

`playwright.config.ts`：

- `screenshot: 'only-on-failure'`
- `video: 'retain-on-failure'`
- CI：`trace: 'retain-on-failure'`（失败可进 HTML 报告 / trace viewer）
- 本地：`trace: 'on-first-retry'`

强制全程 trace（调试）：`PLAYWRIGHT_TRACE=on npm run test:ci`

## CI 产物（GitHub Actions）

`playwright.yml` 每次运行上传：

| Artifact | 内容 |
|----------|------|
| `full-report-<run_id>` | 合并产物：public-reports + screenshots + diffs + ui-issues（失败含 test-results） |

Actions 页 → Run → **Artifacts** → 解压 `ci-artifacts/public-reports/index.html`。

## 发布到 GitHub Pages（可选）

1. 仓库 Settings → Pages → Source 选 **GitHub Actions**
2. Actions → **Playwright Tests** → **Run workflow**
3. 勾选 **Publish reports to GitHub Pages**
4. 完成后访问：`https://<user>.github.io/<repo>/`

也可设置 `PUBLIC_REPORT_URL` 后配合飞书 `ENABLE_GITHUB=1` 在通知里带链接。

## Trace 在线查看

- 本地：`npm run trace:show`
- 官方托管：将 `trace.zip` 拖到 [trace.playwright.dev](https://trace.playwright.dev)（**勿上传含账号/敏感数据的 trace**）

## 与 Studio 的分工

| 环节 | 是否需要 GUI |
|------|----------------|
| 录制 / AI 优化 | 需要（`npm run studio`） |
| 执行回归 | 不需要（CI / `test:ci`） |
| 查看报告 | 不需要（浏览器打开 HTML / Pages） |
