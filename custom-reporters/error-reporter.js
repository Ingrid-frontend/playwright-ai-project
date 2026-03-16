import fs from 'fs';
import path from 'path';

class ErrorReporter {
  constructor() {
    this.errors = [];
    this.startTime = Date.now();
    this.testStartTimes = new Map();
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

    if (result.status === 'failed' || result.status === 'timedOut') {
      const errorMessage = this.cleanErrorMessage(result.error?.message || 'Unknown error');
      const errorStack = this.cleanErrorMessage(result.error?.stack);
      
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

      this.errors.push(errorInfo);
      console.log(`❌ 测试失败: ${test.title}`);
      console.log(`   错误: ${errorMessage}`);
      console.log(`   文件: ${errorInfo.testFile}`);
      if (errorLocation.file) {
        console.log(`   错误位置: ${errorLocation.file}:${errorLocation.line}:${errorLocation.column}`);
      }
    }
  }

  onEnd() {
    const totalDuration = Date.now() - this.startTime;
    console.log(`\n📊 测试执行完成`);
    console.log(`   总耗时: ${Math.round(totalDuration / 1000)}s`);
    console.log(`   失败数: ${this.errors.length}`);

    if (this.errors.length > 0) {
      this.saveErrors();
    } else {
      console.log(`✅ 所有测试通过，无错误需要记录`);
    }
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
