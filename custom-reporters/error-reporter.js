import fs from 'fs';
import path from 'path';
import { isFlakeError } from './flake-patterns.js';

class ErrorReporter {
  constructor() {
    this.errors = [];
    this.startTime = Date.now();
    this.testStartTimes = new Map();
    this.passed = 0;
    this.failed = 0;
  }

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
    const testDuration = Date.now() - (this.testStartTimes.get(test.title) || this.startTime);

    if (result.status === 'passed') {
      this.passed++;
      return;
    }

    if (result.status === 'failed' || result.status === 'timedOut') {
      this.failed++;
      const errorMessage = this.cleanErrorMessage(result.error?.message || 'Unknown error');
      const errorStack = this.cleanErrorMessage(result.error?.stack);
      const isFlake = isFlakeError(`${errorMessage}\n${errorStack}`);
      
      const errorLocation = this.extractErrorLocation(errorStack);
      
      const errorInfo = {
        testFile: test.location?.file || 'unknown',
        testName: test.title,
        error: errorMessage,
        stack: errorStack,
        isFlake,
        errorLine: errorLocation.line,
        errorColumn: errorLocation.column,
        errorFile: errorLocation.file,
        timestamp: new Date().toISOString(),
        duration: testDuration
      };

      this.errors.push(errorInfo);
      console.log(`${isFlake ? '⚡' : '❌'} 测试失败${isFlake ? '（flake）' : ''}: ${test.title}`);
      console.log(`   错误: ${errorMessage}`);
      console.log(`   文件: ${errorInfo.testFile}`);
      if (errorLocation.file) {
        console.log(`   错误位置: ${errorLocation.file}:${errorLocation.line}:${errorLocation.column}`);
      }
    }
  }

  onEnd() {
    const totalDuration = Date.now() - this.startTime;
    const flakeFailed = this.errors.filter((e) => e.isFlake).length;
    console.log(`\n📊 测试执行完成`);
    console.log(`   总耗时: ${Math.round(totalDuration / 1000)}s`);
    console.log(`   通过: ${this.passed} · 失败: ${this.failed}（flake ${flakeFailed}）`);

    this.saveTestHistory(totalDuration, flakeFailed);

    if (this.errors.length > 0) {
      this.saveErrors();
    } else {
      console.log(`✅ 所有测试通过，无错误需要记录`);
    }
  }

  saveTestHistory(totalDuration, flakeFailed) {
    const historyDir = path.join('results', 'history');
    if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });

    const day = new Date().toISOString().slice(0, 10);
    const historyFile = path.join(historyDir, `${day}.json`);
    let file = { schemaVersion: 1, entries: [] };
    if (fs.existsSync(historyFile)) {
      try {
        file = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
      } catch {
        file = { schemaVersion: 1, entries: [] };
      }
    }
    if (!Array.isArray(file.entries)) file.entries = [];

    let uiMetrics;
    const uiPath = path.join('results', 'ui-issues.json');
    if (fs.existsSync(uiPath)) {
      try {
        const ui = JSON.parse(fs.readFileSync(uiPath, 'utf-8'));
        uiMetrics = ui.summary
          ? { blocker: ui.summary.blocker, warning: ui.summary.warning, total: ui.summary.total }
          : undefined;
      } catch {
        /* ignore */
      }
    }

    const entry = {
      id: `${Date.now()}`,
      runAt: new Date().toISOString(),
      gitSha: process.env.GITHUB_SHA || process.env.GIT_COMMIT,
      env: process.env.PLAYWRIGHT_ENV || process.env.NODE_ENV || 'stage',
      passed: this.failed === 0,
      failed: this.failed,
      flakeFailed,
      durationMs: totalDuration,
      errors: this.errors.map((e) => ({
        testFile: e.testFile,
        testName: e.testName,
        error: e.error,
        isFlake: Boolean(e.isFlake),
      })),
      uiMetrics,
    };

    file.entries.push(entry);
    fs.writeFileSync(historyFile, JSON.stringify(file, null, 2), 'utf-8');
    console.log(`📈 测试历史已追加: ${historyFile}`);
  }

  cleanErrorMessage(message) {
    if (!message) return '';
    
    return message
      .replace(/\u001b\[[0-9;]*m/g, '')
      .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
      .trim();
  }

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

  saveErrors() {
    const errorDir = 'tests/deprecated/errors';
    
    if (!fs.existsSync(errorDir)) {
      fs.mkdirSync(errorDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const errorFile = path.join(errorDir, `test-errors-${timestamp}.json`);

    const uniqueErrors = this.removeDuplicateErrors();
    
    const report = {
      summary: {
        totalErrors: this.errors.length,
        uniqueErrors: uniqueErrors.length,
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      },
      errors: uniqueErrors
    };

    fs.writeFileSync(errorFile, JSON.stringify(report, null, 2), 'utf-8');
    
    console.log(`\n💾 错误已保存到: ${errorFile}`);
    console.log(`   总错误数: ${this.errors.length}`);
    console.log(`   唯一错误数: ${uniqueErrors.length}`);
    
    this.printErrorSummary(uniqueErrors);
  }

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

  printErrorSummary(errors) {
    console.log('\n📋 错误摘要:');
    console.log('═════════════════════════════════════');
    
    const errorGroups = this.groupErrors(errors);
    
    for (const [file, fileErrors] of Object.entries(errorGroups)) {
      console.log(`\n📄 文件: ${file}`);
      console.log('─'.repeat(50));
      
      const lineErrors = {};
      for (const error of fileErrors) {
        const errorType = error.error.split('\n')[0].trim();
        const lineKey = `${error.errorLine}:${error.errorColumn}`;
        
        if (!lineErrors[lineKey]) {
          lineErrors[lineKey] = {
            errorType,
            count: 0,
            testName: error.testName
          };
        }
        lineErrors[lineKey].count++;
      }
      
      for (const [lineKey, info] of Object.entries(lineErrors)) {
        console.log(`   ❌ 行 ${lineKey}: ${info.errorType.substring(0, 60)}${info.errorType.length > 60 ? '...' : ''}`);
        console.log(`      次数: ${info.count}`);
        console.log(`      测试: ${info.testName}`);
      }
    }
    
    console.log('\n═════════════════════════════════════');
  }

  groupErrors(errors) {
    const groups = {};
    
    for (const error of errors) {
      const fileName = path.basename(error.testFile);
      
      if (!groups[fileName]) {
        groups[fileName] = [];
      }
      
      groups[fileName].push(error);
    }
    
    return groups;
  }
}

export default ErrorReporter;
