# 测试错误收集（速查）

目标：在跑 Playwright 测试时自动收集失败信息，并提供离线分析入口。

## 速查

```bash
# 运行测试（失败时会落地 errors JSON）
npm test

# 汇总分析 errors JSON（推荐）
npm run analyze-errors
```

## 产物

- 错误 JSON：`tests/deprecated/errors/test-errors-YYYY-MM-DD.json`
- Playwright HTML 报告：`playwright-report/`

## 位置

- Reporter：`custom-reporters/error-reporter.js`（已在 `playwright.config.ts` 中注册）
- 分析脚本：`scripts/analyze/analyze-errors.ts`

## JSON 字段（最小）

- `summary.totalErrors`：总错误数（可能包含重试）
- `errors[]`：错误数组（含 `testFile` / `testName` / `error` / `stack` / `timestamp` / `duration`）

详见：`docs/error-collection-guide.md`

（本文仅保留速查信息；实现细节与排错建议请参考上面的 guide。）

### 1. Playwright Reporter接口

```javascript
class ErrorReporter {
  onBegin() {
    console.log('📝 错误收集器已启动');
    this.startTime = Date.now();
    this.errors = [];
    this.testStartTimes.clear();
  }

  onTestBegin(test) {
    this.testStartTimes.set(test.title, Date.now());
  }

  onTestEnd(test, result) {
    if (result.status === 'failed' || result.status === 'timedOut') {
      const errorInfo = {
        testFile: test.location?.file || 'unknown',
        testName: test.title,
        error: result.error?.message || 'Unknown error',
        stack: result.error?.stack,
        timestamp: new Date().toISOString(),
        duration: testDuration
      };
      this.errors.push(errorInfo);
    }
  }

  onEnd() {
    if (this.errors.length > 0) {
      this.saveErrors();
    }
  }
}
```

### 2. 错误保存逻辑

```javascript
saveErrors() {
  const deprecatedDir = 'tests/deprecated';
  
  if (!fs.existsSync(deprecatedDir)) {
    fs.mkdirSync(deprecatedDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const errorFile = path.join(deprecatedDir, `test-errors-${timestamp}.json`);

  const report = {
    summary: {
      totalErrors: this.errors.length,
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    },
    errors: this.errors
  };

  fs.writeFileSync(errorFile, JSON.stringify(report, null, 2), 'utf-8');
}
```

### 3. 错误分析逻辑

```typescript
function analyzeErrors(): void {
  const errorFiles = fs.readdirSync(errorDir)
    .filter(file => file.startsWith('test-errors-') && file.endsWith('.json'))
    .sort()
    .reverse();

  for (const file of errorFiles) {
    const content: ErrorReport = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    const errorGroups: Record<string, number> = {};
    for (const error of content.errors) {
      const fileName = path.basename(error.testFile);
      errorGroups[fileName] = (errorGroups[fileName] || 0) + 1;
    }
  }

  const errorTypes: Record<string, number> = {};
  for (const error of allErrors) {
    const errorType = error.error.split('\n')[0].trim();
    errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
  }
}
```

## 优势（简版）

- 自动落地错误 JSON，便于归档
- 结构化字段，便于脚本分析
- 可按日期追踪趋势

## 🎯 最佳实践

### 1. 定期分析

```bash
# 每周分析一次错误
npm run analyze-errors
```

### 2. 清理旧文件

```bash
# 删除30天前的错误文件
find tests/deprecated/errors/test-errors-*.json -mtime +30 -delete
```

### 3. 集成到CI/CD

```yaml
- name: Check for errors
  run: |
    if [ -f tests/deprecated/errors/test-errors-$(date +%Y-%m-%d).json ]; then
      echo "⚠️ 发现测试错误"
      npm run analyze-errors
    fi
```

## 📚 相关文档

- [错误收集功能指南](error-collection-guide.md) - 详细使用指南
- [Playwright配置](../playwright.config.ts) - Playwright配置文件
- [README.md](../README.md) - 项目主文档

## 总结

（总结省略：按本文“速查”两条命令即可使用。）
