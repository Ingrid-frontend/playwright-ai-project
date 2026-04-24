import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

function printHelp(): void {
  console.log(`用法: tsx scripts/report/run-raw-recordings-optimized.ts [选项]

批量执行 tests/optimized 下所有 *.optimized.spec.ts（逐个文件调用 playwright test）。

选项:
  --playwright-project=<name>  与 npx playwright test --project 一致（默认 optimized）
  --project=<name>             同上简写
  -h, --help                   显示帮助
`);
}

function parseCli(argv: string[]): { playwrightProject: string } {
  let playwrightProject = 'optimized';

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith('--playwright-project=')) {
      playwrightProject = arg.slice('--playwright-project='.length).trim() || 'optimized';
      continue;
    }
    if (arg.startsWith('--project=')) {
      playwrightProject = arg.slice('--project='.length).trim() || 'optimized';
      continue;
    }
  }

  return { playwrightProject };
}

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
  const { playwrightProject } = parseCli(process.argv.slice(2));

  console.log('🚀 开始执行优化后的测试...');
  console.log(`⚙️  playwright project: ${playwrightProject}\n`);

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

  let anyFailed = false;

  testFiles.forEach((filePath, index) => {
    const relativePath = path.relative(process.cwd(), filePath);
    console.log(`\n🎯 执行测试 ${index + 1}/${testFiles.length}: ${relativePath}`);

    try {
      execSync(
        `npx playwright test "${relativePath}" --project=${playwrightProject} --reporter=list`,
        {
          stdio: 'inherit',
          shell: '/bin/bash',
        },
      );
      console.log(`✅ 测试 ${relativePath} 执行成功`);
    } catch (error: unknown) {
      anyFailed = true;
      console.error(`❌ 测试 ${relativePath} 执行失败`);
      const msg = error instanceof Error ? error.message : String(error);
      console.error(msg);
    }
  });

  if (anyFailed) {
    console.error('\n⚠️ 部分或全部测试失败，请查看上方日志');
    process.exit(1);
  }

  console.log('\n🎉 所有测试执行成功！');
}

runOptimizedTests();
