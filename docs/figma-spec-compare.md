# 设计稿规范对比（语义版）

旧的 Figma 对比是把设计稿 PNG 缩放到线上截图尺寸后做 pixelmatch，线上页面本身是 2880×1800 的 iframe 宽布局时，整图强比会大量误报。

现在默认改为**先梳理设计稿规范，再对线上页面做语义校验**：

1. 调用 Figma nodes API 拉取设计节点 JSON，抽取画布尺寸、布局骨架、关键文案、色彩令牌、字体令牌、间距和圆角。
2. 用 Playwright 采集线上页面的可见文本、计算样式、常用区块选择器和色板。
3. 按“设计稿区块 ↔ 线上对应区块”隔离后，对区块内的文案、字号、字重、颜色、间距逐项一一对比；不再做全局字体/色彩/间距令牌匹配。
4. 视口尺寸差异只做比例提示，不再把设计图强行拉伸成线上截图。

## 命令

```bash
# 只导出设计稿规范（JSON + Markdown）
FIGMA_TOKEN=xxx npm run figma:spec -- \
  --figma="https://www.figma.com/design/{fileKey}/{name}?node-id={nodeId}" \
  --out="results/figma-spec/demo"

# 规范对比（默认按语义校验）
FIGMA_TOKEN=xxx npm run figma:compare -- \
  --figma="https://www.figma.com/design/{fileKey}/{name}?node-id={nodeId}" \
  --url="https://stage.huilianyi.com/main/approve"
```

## Studio 入口

Studio 的「设计稿对比」页签已接入语义校验：点击「对比」运行，完成后点「打开报告」在新窗口查看 `report.html`；也可以直接点「打开最近结果」打开最近一次的规范对比报告。

常用参数：

- `--env=stage`：环境，默认 `stage`。
- `--profile=default`：登录态档案。
- `--refresh`：忽略 Figma 节点和 PNG 缓存。
- `--spec-only`：不访问线上页面，只输出设计稿规范。

## 产物

对比结果输出到 `results/figma-compare/<时间戳>-spec/`：

- `design-spec.json` / `design-spec.md`：从设计稿梳理出的规范。
- `live-spec.json`：线上页面语义采集结果。
- `checks.json`：逐项校验结果。
- `report.html` / `report.md`：可读报告。
- `design.png` / `live.png`：仅作人工对照参考，不参与判定。

## 配置

`config/figma-spec.json` 可调整：

- `regions`：设计稿区块名与线上选择器的映射。
- `textIgnore` / `textIgnorePatterns`：不需要校验的文案或动态数据模式。
- `requiredTextKinds`：核心文案类别（侧边栏、页签、表头等）。
- `paletteLimit` / `typographyLimit`：参与校验的色彩/字体令牌数量。
- `tolerance`：字号、字重、颜色、行高、布局的容忍度。

## 与旧版的关系

旧版整图 pixelmatch 保留在 `scripts/figma/figma-compare.ts`，可通过 `npm run figma:compare-legacy` 调用；正式流程使用 `figma:compare`（语义校验）。
