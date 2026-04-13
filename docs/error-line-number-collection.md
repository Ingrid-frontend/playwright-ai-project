# 错误行号收集（速查）

目标：在错误 JSON 中记录 `errorFile` / `errorLine` / `errorColumn`，便于快速定位与聚类修复。

## 产物

- 错误 JSON：`tests/deprecated/errors/test-errors-YYYY-MM-DD.json`
- 字段：`errors[].errorFile` / `errors[].errorLine` / `errors[].errorColumn`

## 如何使用

```bash
# 运行测试，触发失败后会写入行号信息
npm test

# 汇总分析（推荐）
npm run analyze-errors
```

## 相关位置

- Reporter：`custom-reporters/error-reporter.js`
- 分析脚本：`scripts/analyze/analyze-errors.ts`
  for (const error of this.errors) {
    const key = `${error.testFile}::${error.testName}::${error.error}::${error.errorLine}::${error.errorColumn}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      uniqueErrors.push(error);
    }
  }
  
  return uniqueErrors;
}
```

## 📊 使用示例

### 示例1: 查看错误行号

```bash
cat tests/deprecated/errors/test-errors-2026-03-09.json | jq '.errors[] | {testName, errorLine, errorColumn, error}'
```

输出：
```json
{
  "testName": "测试行号收集1",
  "errorLine": 7,
  "errorColumn": 25,
  "error": "Error: expect(locator).toBeVisible() failed\n\nLocator: locator('#non-existent-element-1')\nExpected: visible\nTimeout: 5000ms\nError: element(s) not found\n\nCall log:\n  - Expect \"toBeVisible\" with timeout 5000ms\n  - waiting for locator('#non-existent-element-1')"
}
```

### 示例2: 按行号统计

```bash
npm run analyze-errors
```

输出：
```
📍 按代码行号统计（最频繁的错误行）
──────────────────────────────────────────────────
   📍 test-line-number.spec.ts:7:25
   错误: Error: expect(locator).toBeVisible() failed
   次数: 1 (16.7%)
   测试: 测试行号收集1
```

### 示例3: 查找高频错误行

```bash
cat tests/deprecated/errors/test-errors-2026-03-09.json | jq '.errors | group_by(.errorLine) | map({line: .[0].errorLine, count: length}) | sort_by(-.count)'
```

### 示例4: 生成优化建议

```bash
npm run analyze-errors | grep "高频错误行"
```

输出：
```
   ⚠️  发现高频错误行: test-line-number.spec.ts:7:25 (3次)，建议优先优化
```

## 🎯 优化建议

基于错误行号统计，可以：

1. **优先优化高频错误行**
   - 修复出现次数最多的代码行
   - 提高测试稳定性

2. **批量修复相同错误**
   - 查找相同错误类型的代码行
   - 统一修复方案

3. **代码重构**
   - 识别重复的错误模式
   - 重构代码减少错误

## 📚 相关文档

- [错误收集功能指南](error-collection-guide.md) - 错误收集功能使用指南
- [错误收集器优化](error-reporter-optimization.md) - 错误收集器优化详情
- [脚本优化总结](scripts-optimization-summary.md) - 脚本优化总结

## 🎉 总结

错误行号收集功能已成功实现！

**支持的功能**:
- ✅ 自动提取错误行号和列号
- ✅ 实时显示错误位置
- ✅ JSON文件保存行号信息
- ✅ 按行号统计错误频率
- ✅ 识别高频错误行
- ✅ 提供优化建议

**使用效果**:
- 📊 快速定位错误代码位置
- 📊 识别需要优先优化的代码行
- 📊 批量修复相同错误
- 📊 提高测试稳定性

现在可以方便地收集脚本报错的行号信息，后续一起优化！🚀
