# AI Native 用例

此目录保存自然语言生成的语义测试计划 JSON。

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
npm run ai:run -- --plan=tests/ai-native/xxx.json --env=stage
```

失败时尝试单步自愈：

```bash
npm run ai:run -- --plan=tests/ai-native/xxx.json --env=stage --heal
```

结果输出到 `results/ai-native/<时间>-<用例名>/`。
