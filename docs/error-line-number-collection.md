# 错误行号收集功能说明

## 🎯 功能概述

错误收集器现在会自动提取并保存脚本报错的行号信息，方便后续一起优化。

## ✨ 新增功能

### 1. 错误位置提取

错误收集器会从错误堆栈中提取：
- **错误文件路径**: 报错的测试文件路径
- **错误行号**: 报错的代码行号
- **错误列号**: 报错的代码列号

### 2. 实时显示

测试执行过程中，会实时显示错误位置：

```
❌ 测试失败: 测试行号收集1
   错误: Error: expect(locator).toBeVisible() failed
   文件: /Users/hly/self-project/playwright-ai-project/tests/deprecated/test-line-number.spec.ts
   错误位置: /Users/hly/self-project/playwright-ai-project/tests/deprecated/test-line-number.spec.ts:7:25
```

### 3. JSON文件保存

错误信息会保存到 `tests/deprecated/errors/test-errors-YYYY-MM-DD.json`，包含：

```json
{
  "summary": {
    "totalErrors": 6,
    "uniqueErrors": 3,
    "timestamp": "2026-03-09T10:27:51.820Z",
    "nodeVersion": "v24.12.0",
    "platform": "darwin",
    "arch": "arm64"
  },
  "errors": [
    {
      "testFile": "/Users/hly/self-project/playwright-ai-project/tests/deprecated/test-line-number.spec.ts",
      "testName": "测试行号收集1",
      "error": "Error: expect(locator).toBeVisible() failed\n\nLocator: locator('#non-existent-element-1')\nExpected: visible\nTimeout: 5000ms\nError: element(s) not found\n\nCall log:\n  - Expect \"toBeVisible\" with timeout 5000ms\n  - waiting for locator('#non-existent-element-1')",
      "stack": "Error: expect(locator).toBeVisible() failed\n\nLocator: locator('#non-existent-element-1')\nExpected: visible\nTimeout: 5000ms\nError: element(s) not found\n\nCall log:\n  - Expect \"toBeVisible\" with timeout 5000ms\n  - waiting for locator('#non-existent-element-1')\n\n    at /Users/hly/self-project/playwright-ai-project/tests/deprecated/test-line-number.spec.ts:7:25",
      "errorLine": 7,
      "errorColumn": 25,
      "errorFile": "/Users/hly/self-project/playwright-ai-project/tests/deprecated/test-line-number.spec.ts",
      "timestamp": "2026-03-09T10:27:18.055Z",
      "duration": 6328
    }
  ]
}
```

### 4. 按行号统计

错误分析脚本会按代码行号统计错误频率：

```
📍 按代码行号统计（最频繁的错误行）
──────────────────────────────────────────────────
   📍 test-line-number.spec.ts:7:25
   错误: Error: expect(locator).toBeVisible() failed
   次数: 1 (16.7%)
   测试: 测试行号收集1

   📍 test-line-number.spec.ts:14:25
   错误: Error: expect(locator).toBeVisible() failed
   次数: 1 (16.7%)
   测试: 测试行号收集2

   📍 test-line-number.spec.ts:21:25
   错误: Error: expect(locator).toBeVisible() failed
   次数: 1 (16.7%)
   测试: 测试行号收集3
```

## 🔧 实现原理

### 1. 错误位置提取

```javascript
extractErrorLocation(stack) {
  const location = {
    file: null,
    line: null,
    column: null
  };

  if (!stack) return location;

  const lines = stack.split('\n');
  
  for (const line of lines) {
    const match = line.match(/at\s+.*?\s+\((.+?):(\d+):(\d+)\)/) ||
                 line.match(/at\s+(.+?):(\d+):(\d+)/);
    
    if (match) {
      const filePath = match[1];
      
      if (filePath.includes('.spec.ts') || filePath.includes('.spec.js')) {
        location.file = filePath;
        location.line = parseInt(match[2], 10);
        location.column = parseInt(match[3], 10);
        break;
      }
    }
  }

  return location;
}
```

### 2. 错误信息保存

```javascript
const errorLocation = this.extractErrorLocation(errorStack);

const errorInfo = {
  testFile: test.location?.file || 'unknown',
  testName: test.title,
  error: errorMessage,
  stack: errorStack,
  errorLine: errorLocation.line,
  errorColumn: errorLocation.column,
  errorFile: errorLocation.file,
  timestamp: new Date().toISOString(),
  duration: testDuration
};
```

### 3. 重复错误去重

```javascript
removeDuplicateErrors() {
  const seen = new Set();
  const uniqueErrors = [];
  
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
