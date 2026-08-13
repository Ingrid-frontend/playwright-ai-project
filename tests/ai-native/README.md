# AI Native 用例

此目录保存自然语言生成的 Playwright 脚本和用于验证的历史计划。

## 生成

```bash
npm run ai:generate -- \
  --case="打开我的审批，选择最新一条记录，查看详情，断言状态为待审批" \
  --env=stage
```

也可以从已有录制脚本转换：

```bash
npm run ai:generate -- \
  --recording=tests/raw-recordings/original/stage/xxx.spec.ts \
  --env=stage
```

## 执行

```bash
npm run ai:run -- --script=tests/ai-generated/xxx.generated.ts --env=stage
```

结果输出到 `results/ai-native-script/`。

如果使用旧语义计划链路：

```bash
npm run ai:plan:generate -- --case="..." --env=stage
npm run ai:plan:run -- --plan=tests/ai-native/xxx.json --env=stage
```
