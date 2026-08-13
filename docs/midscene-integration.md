# Midscene 集成

项目已接入 [`@midscene/web`](https://midscenejs.com/integrate-with-playwright.html)，用视觉模型补充普通 Playwright 定位之外的能力。

## 已接入能力

### 1. 定位失败时的 AI 兜底（默认关闭）

`tests/utils/optimized-actions.ts` 的 `smartClick` / `smartFill` 在三级重试失败后，会尝试 Midscene：

- 点击失败 → `aiTap(步骤名)`
- 输入失败 → `aiInput(描述, { value })`

启用方式：

```bash
MIDSCENE_FALLBACK=1
```

同时配置模型：

```bash
MIDSCENE_MODEL_NAME=qwen-vl-max
MIDSCENE_MODEL_FAMILY=qwen
MIDSCENE_MODEL_API_KEY=your-key
MIDSCENE_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

### 2. Midscene 调试/生成入口

```bash
npm run midscene:run -- \
  --url="https://stage.huilianyi.com/main/approve" \
  --task="点击「我的审批」并确认列表加载"

npm run midscene:run -- \
  --url="https://stage.huilianyi.com/main/approve" \
  --assert="页面包含待审批列表"

npm run midscene:run -- \
  --url="https://stage.huilianyi.com/main/approve" \
  --query='{"title":"当前页签","count":0}，提取当前页签名称'
```

## 后续可扩展方向

- 录制脚本生成时，用 `aiQuery` 把脆弱的 CSS 选择器替换为语义描述。
- 在关键步骤后插入 `aiAssert` 视觉断言，减少依赖截图基线的波动。
- 将 Midscene 与设计稿规范对比结合：用 `aiLocate` 在线上定位设计稿中的区块，再对区块做逐项校验。
- 在 Studio 增加“Midscene 修复用例”入口，失败后自动用 AI 尝试重新定位。

## 说明

- Midscene 需要视觉模型 API 密钥，未配置或未开启时不影响现有测试。
- AI 兜底只会在普通定位失败后触发，默认关闭以避免额外耗时与费用。
