# Legacy：tests/ai-generated

此目录为历史 AI 生成用例，**新用例请使用**：

- 录制：`tests/raw-recordings/`（CLI `npm run record` 或 Studio）
- 优化：`npm run test:pipeline` / `npm run pipeline-raw-to-optimized`
- 执行：`tests/optimized/**/*.optimized.spec.ts`

`npm run test:ai` 仅当本目录存在 `*.spec.ts` 时才会执行。
