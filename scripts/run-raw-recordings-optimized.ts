import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const optimizedDir = 'tests/optimized';

function findTestFiles(dir: string): string[] {
  const testFiles: string[] = [];
  
  function traverse(currentDir: string) {
    const items = fs.readdirSync(currentDir);
    
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        traverse(fullPath);
      } else if (item.endsWith('.optimized.spec.ts')) {
        testFiles.push(fullPath);
      }
    }
  }
  
  traverse(dir);
  return testFiles.sort();
}

function runOptimizedTests() {
  console.log('🚀 开始执行优化后的测试...');
  
  if (!fs.existsSync(optimizedDir)) {
    console.error('❌ 优化后的测试文件目录不存在');
    console.error('请先运行: npm run optimize-raw-recordings -- tests/raw-recordings/');
    process.exit(1);
  }
  
  const testFiles = findTestFiles(optimizedDir);
  
  if (testFiles.length === 0) {
    console.error('❌ 未找到优化后的测试文件');
    console.error('请先运行: npm run optimize-raw-recordings -- tests/raw-recordings/');
    process.exit(1);
  }
  
  console.log(`📊 找到 ${testFiles.length} 个优化后的测试文件`);
  
  testFiles.forEach((filePath, index) => {
    const relativePath = path.relative(process.cwd(), filePath);
    console.log(`\n🎯 执行测试 ${index + 1}/${testFiles.length}: ${relativePath}`);
    
    try {
      execSync(`npx playwright test ${filePath} --reporter=list`, { 
        stdio: 'inherit',
        shell: '/bin/bash'
      });
      console.log(`✅ 测试 ${relativePath} 执行成功`);
    } catch (error: any) {
      console.error(`❌ 测试 ${relativePath} 执行失败`);
      console.error(error.message);
    }
  });
  
  console.log('\n🎉 所有测试执行完成！');
}

runOptimizedTests();
