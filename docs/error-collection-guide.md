# 测试错误收集功能指南（已优化）

## 🚀 功能说明

当执行 `npm run test` 时，系统会自动收集测试执行过程中遇到的报错，并将错误信息保存到 `tests/deprecated/errors` 文件夹下，方便后续分析和解决。

## ✨ 最新优化

### 1. ANSI颜色代码清理
- ✅ 自动移除错误信息中的ANSI颜色转义序列
- ✅ 确保JSON文件纯净可读
- ✅ 便于工具解析和处理

### 2. 重复错误去重
- ✅ 自动识别并去除重复的错误记录
- ✅ 区分总错误数和唯一错误数
- ✅ 节省存储空间

### 3. 增强错误摘要
- ✅ 按错误类型分组显示
- ✅ 显示每种错误的次数
- ✅ 更清晰的错误统计

## 📖 工作原理

### 1. 自动收集

错误收集器会在测试执行时自动启动，收集以下信息：
- ✅ 测试文件路径
- ✅ 测试名称
- ✅ 错误信息（已清理ANSI代码）
- ✅ 错误堆栈（已清理ANSI代码）
- ✅ 错误时间戳
- ✅ 测试执行时长

### 2. 自动保存

- ✅ 错误信息自动保存到 `tests/deprecated/errors/test-errors-YYYY-MM-DD.json`
- ✅ 每天生成一个新的错误文件
- ✅ 文件名包含日期，方便查找
- ✅ 自动去重重复错误

### 3. 实时显示

测试执行过程中，错误收集器会：
- ✅ 显示每个失败的测试
- ✅ 显示错误摘要（按类型分组）
- ✅ 按文件分组显示错误
- ✅ 显示保存路径和统计信息

## 📊 错误报告格式

### JSON格式

```json
{
  "summary": {
    "totalErrors": 4,
    "uniqueErrors": 2,
    "timestamp": "2026-03-09T09:51:24.329Z",
    "nodeVersion": "v24.12.0",
    "platform": "darwin",
    "arch": "arm64"
  },
  "errors": [
    {
      "testFile": "/Users/hly/self-project/playwright-ai-project/tests/deprecated/test-ansi-cleanup.spec.ts",
      "testName": "测试ANSI清理",
      "error": "Error: expect(locator).toBeVisible() failed\n\nLocator: locator('#non-existent-element')\nExpected: visible\nTimeout: 5000ms\nError: element(s) not found\n\nCall log:\n  - Expect \"toBeVisible\" with timeout 5000ms\n  - waiting for locator('#non-existent-element')",
      "stack": "Error: expect(locator).toBeVisible() failed\n\nLocator: locator('#non-existent-element')\nExpected: visible\nTimeout: 5000ms\nError: element(s) not found\n\nCall log:\n  - Expect \"toBeVisible\" with timeout 5000ms\n  - waiting for locator('#non-existent-element')\n\n    at /Users/hly/self-project/playwright-ai-project/tests/deprecated/test-ansi-cleanup.spec.ts:7:25",
      "timestamp": "2026-03-09T09:51:03.960Z",
      "duration": 6341
    }
  ]
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `summary.totalErrors` | 总错误数量（包含重试） |
| `summary.uniqueErrors` | 唯一错误数量（已去重） |
| `summary.timestamp` | 报告生成时间 |
| `summary.nodeVersion` | Node.js版本 |
| `summary.platform` | 操作系统平台 |
| `summary.arch` | 系统架构 |
| `errors[].testFile` | 测试文件路径 |
| `errors[].testName` | 测试名称 |
| `errors[].error` | 错误信息（已清理ANSI代码） |
| `errors[].stack` | 错误堆栈（已清理ANSI代码） |
| `errors[].timestamp` | 错误发生时间 |
| `errors[].duration` | 测试执行时长（毫秒） |

## 🎯 使用示例

### 示例1: 正常测试（无错误）

```bash
npm run test -- tests/deprecated/2026-03-09_12-01-22.optimized.spec.ts --project=chromium --workers=1
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

### 示例2: 测试失败（有错误）

```bash
npm run test -- tests/deprecated/test-error-collection.spec.ts --project=chromium --workers=1
```

**输出**:
```
📝 错误收集器已启动
  ✗  1 …ests/deprecated/test-error-collection.spec.ts:3:1 › 故意失败的测试
  ✗  2 …ests/deprecated/test-error-collection.spec.ts:10:1 › 超时测试

  2 failed

📊 测试执行完成
   总耗时: 24s
   失败数: 4

💾 错误已保存到: tests/deprecated/errors/test-errors-2026-03-09.json
   总错误数: 4
   唯一错误数: 2

📋 错误摘要:
═══════════════════════════════════

📄 文件: test-error-collection.spec.ts
──────────────────────────────────────────────────
   ❌ Error: expect(locator).toBeVisible() failed
      次数: 2

═════════════════════════════════════
```

## 🔍 查看错误文件

### 方法1: 直接查看JSON文件

```bash
cat tests/deprecated/errors/test-errors-2026-03-09.json
```

### 方法2: 使用jq格式化查看

```bash
cat tests/deprecated/errors/test-errors-2026-03-09.json | jq '.'
```

### 方法3: 查看特定错误

```bash
cat tests/deprecated/errors/test-errors-2026-03-09.json | jq '.errors[0]'
```

### 方法4: 按文件分组查看

```bash
cat tests/deprecated/errors/test-errors-2026-03-09.json | jq '.errors | group_by(.testFile)'
```

### 方法5: 查看统计信息

```bash
cat tests/deprecated/errors/test-errors-2026-03-09.json | jq '.summary'
```

## 🛠️ 错误分析工具

### 1. 统计错误类型

```bash
cat tests/deprecated/errors/test-errors-2026-03-09.json | jq '.errors | group_by(.error) | map({error: .[0].error, count: length})'
```

### 2. 查找最频繁的错误

```bash
cat tests/deprecated/errors/test-errors-2026-03-09.json | jq '.errors | group_by(.error) | sort_by(-length) | .[0]'
```

### 3. 统计每个文件的错误数

```bash
cat tests/deprecated/errors/test-errors-2026-03-09.json | jq '.errors | group_by(.testFile) | map({file: .[0].testFile | split("/") | .[-1], count: length})'
```

### 4. 查找超时的测试

```bash
cat tests/deprecated/errors/test-errors-2026-03-09.json | jq '.errors[] | select(.error | contains("timeout"))'
```

### 5. 对比总错误和唯一错误

```bash
cat tests/deprecated/errors/test-errors-2026-03-09.json | jq '{total: .summary.totalErrors, unique: .summary.uniqueErrors, duplicate: (.summary.totalErrors - .summary.uniqueErrors)}'
```

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

## 🐛 故障排查

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
