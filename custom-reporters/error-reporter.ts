import * as fs from 'fs';
import * as path from 'path';

interface TestError {
  testFile: string;
  testName: string;
  error: string;
  stack?: string;
  timestamp: string;
  duration: number;
}

class ErrorReporter {
  private errors: TestError[] = [];
  private startTime: number = Date.now();
  private testStartTimes: Map<string, number> = new Map();

  onBegin(): void {
    console.log('📝 错误收集器已启动');
    this.startTime = Date.now();
    this.errors = [];
    this.testStartTimes.clear();
  }

  onTestBegin(test: any): void {
    this.testStartTimes.set(test.title, Date.now());
  }

  onTestEnd(test: any, result: any): void {
    const testDuration = Date.now() - (this.testStartTimes.get(test.title) || this.startTime);

    if (result.status === 'failed' || result.status === 'timedOut') {
      const errorInfo: TestError = {
        testFile: test.location?.file || 'unknown',
        testName: test.title,
        error: result.error?.message || 'Unknown error',
        stack: result.error?.stack,
        timestamp: new Date().toISOString(),
        duration: testDuration
      };

      this.errors.push(errorInfo);
      console.log(`❌ 测试失败: ${test.title}`);
      console.log(`   错误: ${errorInfo.error}`);
      console.log(`   文件: ${errorInfo.testFile}`);
    }
  }

  onEnd(): void {
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

  private saveErrors(): void {
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
    
    console.log(`\n💾 错误已保存到: ${errorFile}`);
    console.log(`   失败测试数: ${this.errors.length}`);
    
    this.printErrorSummary();
  }

  private printErrorSummary(): void {
    console.log('\n📋 错误摘要:');
    console.log('═════════════════════════════════════');
    
    const errorGroups = this.groupErrors();
    
    for (const [file, errors] of Object.entries(errorGroups)) {
      console.log(`\n📄 文件: ${file}`);
      console.log('─'.repeat(50));
      
      for (const error of errors) {
        console.log(`\n❌ ${error.testName}`);
        console.log(`   错误: ${error.error.substring(0, 100)}${error.error.length > 100 ? '...' : ''}`);
        console.log(`   耗时: ${Math.round(error.duration / 1000)}s`);
      }
    }
    
    console.log('\n═════════════════════════════════════');
  }

  private groupErrors(): Record<string, TestError[]> {
    const groups: Record<string, TestError[]> = {};
    
    for (const error of this.errors) {
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
