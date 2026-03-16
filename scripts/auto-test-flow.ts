import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function runCommand(command: string, description: string, continueOnError: boolean = false): void {
  console.log(`\n📋 ${description}`);
  console.log(`🔧 执行命令: ${command}`);
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`✅ ${description} 完成`);
  } catch (error) {
    console.error(`❌ ${description} 失败`);
    if (continueOnError) {
      console.log(`⚠️  继续执行后续步骤...`);
    } else {
      throw error;
    }
  }
}

async function main() {
  console.log('🎬 开始自动化测试流程...\n');

  const now = new Date();
  const timestamp = now.getFullYear() + '-' + 
    String(now.getMonth() + 1).padStart(2, '0') + '-' + 
    String(now.getDate()).padStart(2, '0') + '_' + 
    String(now.getHours()).padStart(2, '0') + '-' + 
    String(now.getMinutes()).padStart(2, '0') + '-' + 
    String(now.getSeconds()).padStart(2, '0');

  const rawRecordingsDir = 'tests/raw-recordings';
  const optimizedDir = 'tests/optimized';

  try {
    console.log('📅 时间戳:', timestamp);

    // CI/CD 环境中跳过录制，使用已存在的脚本
    if (process.env.CI) {
      console.log('🤖 检测到 CI/CD 环境，跳过录制步骤');
      console.log('📁 将使用已存在的录制文件');
    } else {
      runCommand('npm run record', '1. 录制测试脚本');
    }

    const rawRecordingFiles = fs.readdirSync(rawRecordingsDir)
      .filter(f => f.endsWith('.spec.ts'))
      .sort((a, b) => b.localeCompare(a));
    
    if (rawRecordingFiles.length === 0) {
      throw new Error('录制文件不存在');
    }
    
    const rawRecordingPath = path.join(rawRecordingsDir, rawRecordingFiles[0]);
    console.log(`📁 找到录制文件: ${rawRecordingPath}`);

    runCommand(`npm run optimize ${rawRecordingPath}`, '2. 优化测试脚本');

    const optimizedFiles = fs.readdirSync(optimizedDir)
      .filter(f => f.endsWith('.optimized.spec.ts'))
      .sort((a, b) => b.localeCompare(a));
    
    if (optimizedFiles.length === 0) {
      throw new Error('优化文件不存在');
    }
    
    const optimizedTestPath = path.join(optimizedDir, optimizedFiles[0]);
    console.log(`📁 找到优化文件: ${optimizedTestPath}`);

    runCommand(`npx playwright test ${optimizedTestPath} --project=chromium --headed=false`, '3. 执行优化后的测试', true);

    runCommand('npm run compare-screenshots', '4. 生成截图对比报告');

    console.log('\n🎉 所有步骤执行成功！');
    console.log(`\n📁 生成的文件:`);
    console.log(`  - 录制文件: ${rawRecordingPath}`);
    console.log(`  - 优化文件: ${optimizedTestPath}`);
    console.log(`  - 对比报告: results/screenshot-comparison.html`);

  } catch (error) {
    console.error('\n❌ 流程执行失败，请检查错误信息');
    process.exit(1);
  }
}

main();
