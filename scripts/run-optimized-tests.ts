import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface TestFile {
  name: string;
  path: string;
}

interface TestResult {
  testFile: TestFile;
  success: boolean;
  screenshotDir?: string;
}

function getOptimizedTestFiles(targetFile?: string): TestFile[] {
  const optimizedDir = 'tests/optimized';
  
  if (!fs.existsSync(optimizedDir)) {
    console.log(`❌ 目录不存在: ${optimizedDir}`);
    return [];
  }
  
  if (targetFile) {
    const targetPath = path.join(optimizedDir, targetFile);
    if (!fs.existsSync(targetPath)) {
      console.log(`❌ 文件不存在: ${targetPath}`);
      return [];
    }
    return [{
      name: targetFile,
      path: targetPath
    }];
  }
  
  const files = fs.readdirSync(optimizedDir)
    .filter(f => f.endsWith('.spec.ts'))
    .map(f => ({
      name: f,
      path: path.join(optimizedDir, f)
    }))
    .sort();
  
  return files;
}

function cleanFailedTestScreenshots(results: TestResult[]): void {
  console.log('\n🧹 清理失败测试的截图...');
  
  const failedTests = results.filter(r => !r.success && r.screenshotDir);
  
  if (failedTests.length === 0) {
    console.log('✅ 没有失败的测试，无需清理');
    return;
  }
  
  console.log(`📋 失败的测试: ${failedTests.length} 个`);
  
  failedTests.forEach(result => {
    if (!result.screenshotDir) return;
    
    if (!fs.existsSync(result.screenshotDir)) {
      console.log(`⚠️  截图目录不存在: ${result.screenshotDir}`);
      return;
    }
    
    console.log(`   删除: ${result.screenshotDir}`);
    fs.rmSync(result.screenshotDir, { recursive: true, force: true });
  });
  
  console.log('✅ 失败测试的截图清理完成');
}

function runTest(testFile: TestFile, verbose: boolean = false): TestResult {
  console.log(`\n🚀 执行测试: ${testFile.name}`);
  console.log('='.repeat(60));
  
  const match = testFile.name.match(/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/);
  const screenshotDir = match ? `screenshots/${match[1]}` : undefined;
  
  try {
    execSync(`npx playwright test --project=chromium --workers=1 ${testFile.path}`, {
      stdio: verbose ? 'inherit' : 'pipe',
      cwd: process.cwd(),
      timeout: 120000
    });
    console.log(`✅ 测试完成: ${testFile.name}`);
    return { testFile, success: true, screenshotDir };
  } catch (error: any) {
    console.log(`⚠️  测试执行遇到问题: ${testFile.name}`);
    console.log(`   错误: ${error.message || '未知错误'}`);
    console.log(`   继续执行下一个测试...`);
    return { testFile, success: false, screenshotDir };
  }
}

function generateComparisonReport(verbose: boolean = false): boolean {
  console.log('\n📊 生成截图对比报告');
  console.log('='.repeat(60));
  
  try {
    execSync('npm run compare-screenshots', {
      stdio: verbose ? 'inherit' : 'pipe',
      cwd: process.cwd(),
      timeout: 60000
    });
    console.log('✅ 截图对比报告生成完成');
    return true;
  } catch (error: any) {
    console.log(`⚠️  对比报告生成遇到问题: ${error.message || '未知错误'}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const stopOnError = args.includes('--stop') || args.includes('-s');
  const cleanScreenshots = args.includes('--clean');
  
  const targetFileIndex = args.findIndex(arg => !arg.startsWith('--') && !arg.startsWith('-'));
  const targetFile = targetFileIndex !== -1 ? args[targetFileIndex] : undefined;
  
  console.log('🎯 开始执行优化测试套件');
  console.log('='.repeat(60));
  
  const testFiles = getOptimizedTestFiles(targetFile);
  
  if (testFiles.length === 0) {
    console.log('⚠️  没有找到测试文件');
    return;
  }
  
  console.log(`📋 找到 ${testFiles.length} 个测试文件:`);
  testFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${file.name}`);
  });
  
  if (verbose) {
    console.log('\n🔧 配置:');
    console.log(`  详细输出: ${verbose ? '开启' : '关闭'}`);
    console.log(`  遇到错误停止: ${stopOnError ? '是' : '否'}`);
    console.log(`  清理失败测试截图: ${cleanScreenshots ? '是' : '否'}`);
    if (targetFile) {
      console.log(`  目标文件: ${targetFile}`);
    }
  }
  
  const results = {
    total: testFiles.length,
    passed: 0,
    failed: 0
  };
  
  const testResults: TestResult[] = [];
  
  for (const testFile of testFiles) {
    const result = runTest(testFile, verbose);
    testResults.push(result);
    
    if (result.success) {
      results.passed++;
    } else {
      results.failed++;
      if (stopOnError) {
        console.log('\n⚠️  遇到错误，停止执行');
        console.log('💡 提示: 默认遇到错误继续执行，使用 --stop 参数在遇到错误时停止');
        break;
      }
    }
  }
  
  if (cleanScreenshots) {
    cleanFailedTestScreenshots(testResults);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 测试执行汇总:');
  console.log(`  总计: ${results.total}`);
  console.log(`  成功: ${results.passed}`);
  console.log(`  失败: ${results.failed}`);
  
  if (results.passed > 0 || results.failed > 0) {
    const reportSuccess = generateComparisonReport(verbose);
    
    if (reportSuccess) {
      console.log('\n🎉 全部完成！');
      console.log('📄 对比报告: results/screenshot-comparison.html');
    } else {
      console.log('\n⚠️  对比报告生成失败，但测试已完成');
    }
  } else {
    console.log('\n⚠️  没有执行任何测试');
  }
}

main().catch(error => {
  console.error('❌ 执行失败:', error);
  process.exit(1);
});