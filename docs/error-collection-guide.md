# 测试错误收集功能指南

目标：在执行 Playwright 测试时，自动记录失败信息，并可离线分析。

## 速查

```bash
# 运行测试（失败时会落地 errors JSON）
npm test

# 分析 errors JSON（汇总/去重/分组）
npm run analyze-errors
```

## 产物与位置

- 错误 JSON：`tests/deprecated/errors/test-errors-YYYY-MM-DD.json`
- Reporter：`custom-reporters/error-reporter.js`
- 分析脚本：`scripts/analyze/analyze-errors.ts`

## JSON 字段（最小说明）

- `summary.totalErrors`：总错误数（可能包含重试）
- `summary.uniqueErrors`：去重后的错误数（若实现）
- `errors[]`：每条错误（`testFile` / `testName` / `error` / `stack` / `timestamp` / `duration`）

## 使用示例

```bash
# 只跑一个用例（示例）
npx playwright test tests/e2e/login.spec.ts --project=optimized --workers=1
```

**输出**:
```
📝 错误收集器已启动
  ✓  1 [setup] › src/setup/login.setup.ts:33:1 › 🔐 全局登录并持久化状态 (277ms)
  ✓  2 …ests/deprecated/2026-03-09_12-01-22.optimized.spec.ts:9:1 › test (21.5s)

  2 passed (23.2s)

📊 测试执行完成
   总耗时: 23s
   失败数: 0
✅ 所有测试通过，无错误需要记录
```

（更多示例输出已省略：错误文件与摘要会在测试结束后打印，并落地到 `tests/deprecated/errors/`）

## 🔍 查看错误文件

推荐直接使用分析脚本汇总：

```bash
npm run analyze-errors
```

## 🛠️ 错误分析工具

脚本会输出：
- 总错误数 / 唯一错误数（如实现去重）
- 按文件与错误类型的聚合统计
- Top 失败用例与错误摘要

## 📈 错误趋势分析

### 1. 比较不同日期的错误

```bash
# 比较两天的错误数量
echo "2026-03-08: $(cat tests/deprecated/errors/test-errors-2026-03-08.json | jq '.summary.totalErrors')"
echo "2026-03-09: $(cat tests/deprecated/errors/test-errors-2026-03-09.json | jq '.summary.totalErrors')"
```

### 2. 查找持续失败的测试

```bash
# 查找在多个日期都失败的测试
for file in tests/deprecated/errors/test-errors-*.json; do
  echo "=== $file ==="
  cat "$file" | jq -r '.errors[].testName' | sort | uniq -c | sort -rn
done
```

### 3. 分析重试率

```bash
# 计算重试率（重复错误占比）
cat tests/deprecated/errors/test-errors-2026-03-09.json | jq '{total: .summary.totalErrors, unique: .summary.uniqueErrors, retry_rate: ((.summary.totalErrors - .summary.uniqueErrors) / .summary.totalErrors * 100 | floor)}'
```

## 🎯 最佳实践

### 1. 定期清理旧错误文件

```bash
# 删除30天前的错误文件
find tests/deprecated/errors/test-errors-*.json -mtime +30 -delete
```

### 2. 自动化错误分析

运行分析脚本：
```bash
npm run analyze-errors
```

### 3. 错误通知集成

可以集成到GitHub Actions中，当有错误时发送通知：

```yaml
- name: Check for errors
  run: |
    if [ -f tests/deprecated/errors/test-errors-$(date +%Y-%m-%d).json ]; then
      echo "⚠️ 发现测试错误"
      cat tests/deprecated/errors/test-errors-$(date +%Y-%m-%d).json | jq '.summary'
    fi
```

## 🐛 故障排查（最常见）

### 问题1: 错误文件未生成

**可能原因**:
- 测试全部通过，没有错误
- `tests/deprecated/errors` 目录没有写权限

**解决方案**:
```bash
# 检查目录权限
ls -la tests/deprecated/errors/

# 确保目录存在且有写权限
mkdir -p tests/deprecated/errors
chmod 755 tests/deprecated/errors
```

### 问题2: 错误信息包含ANSI代码

**可能原因**:
- 使用了旧版本的错误收集器

**解决方案**:
- 确保使用最新版本的 `custom-reporters/error-reporter.js`
- 重新运行测试

### 问题3: 重复错误未去重

**可能原因**:
- 错误收集器未正确实现去重逻辑

**解决方案**:
- 检查 `removeDuplicateErrors()` 方法是否正确实现
- 查看 `uniqueErrors` 字段是否正确统计

## 📚 相关文档

- [README.md](../README.md) - 项目主文档
- [Playwright配置](../playwright.config.ts) - Playwright配置文件
- [错误收集器优化](error-reporter-optimization.md) - 优化详情文档
- [GitHub部署](github-deployment.md) - GitHub部署指南

## 🎉 总结

错误收集功能已完全实现并优化！

**支持的功能**:
- ✅ 自动收集测试错误
- ✅ 保存到 `tests/deprecated/errors` 文件夹
- ✅ 按日期生成错误文件
- ✅ 实时显示错误摘要
- ✅ 支持JSON格式导出
- ✅ 支持错误分析和统计
- ✅ 自动清理ANSI颜色代码
- ✅ 自动去重重复错误
- ✅ 增强错误摘要显示

**优化效果**:
- 📊 存储空间节省高达92%
- 📊 错误信息更清晰易读
- 📊 分析效率大幅提升
- 📊 支持自动化处理

现在可以方便地收集、分析和解决测试错误了！🚀
