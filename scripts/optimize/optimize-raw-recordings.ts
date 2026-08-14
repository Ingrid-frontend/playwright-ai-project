import * as fs from 'fs';
import * as path from 'path';
import {
  parseEnvAndDateCategoryFromRawOrProcessed,
  isEnvSegmentEnabled,
} from '../../src/utils/test-env-path.js';
import { RawRecordingOptimizer, reloadGenWait } from './optimize-raw-optimizer.js';

/**
 * optimize-raw-recordings.ts
 * 
 * 将 tests/raw-recordings 下的原始录制脚本转换为优化的测试脚本
 * 
 * 使用方法:
 *   1. 不传参数: 处理 tests/raw-recordings 文件夹下的所有文件
 *      npm run optimize-raw-recordings
 *   
 *   2. 处理单个文件:
 *      npm run optimize-raw-recordings -- tests/raw-recordings/test.spec.ts
 *   
 *   3. 处理文件夹:
 *      npm run optimize-raw-recordings -- tests/raw-recordings/
 *   
 * 功能:
 *   - 提取并保留 test.use 设置（如 storageState）
 *   - 跳过登录相关的操作（账号登录、密码输入、协议同意等）
 *   - 按日期分类存放生成的优化脚本
 *   - 添加截图功能和增强的等待策略
 *   - 优化选择器，提高测试稳定性
 *   - 引入 Iframe 自动寻址机制
 *   - 实现智能动作函数，处理 AntD 加载遮罩
 *   - 多 pass 优化管道：
 *     - 移除 iframe 前缀
 *     - 移除噪声背景点击
 *     - 简化 uncheck+check 对
 *     - 去重连续相同的操作
 *     - 合并 click+fill 操作
 *     - 在 goto 后注入 waitForLoadState
 *     - 在关键点击前注入可见性断言
 *     - 注入超时配置
 */

const filePath = process.argv[2];

// 如果没有提供参数，默认处理 tests/raw-recordings 文件夹下的所有文件
const targetPath = filePath || 'tests/raw-recordings/';

const outputDir = 'tests/optimized';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function processFile(filePath: string): Promise<void> {
  console.log(`🔄 开始优化文件: ${filePath}`);
  const optimizer = new RawRecordingOptimizer(filePath);
  const fileName = path.basename(filePath, '.spec.ts');
  const dateStr = optimizer.extractDateFromFileName(fileName);
  optimizer.setOptimizedImportLayout(dateStr ? 'nested' : 'flat');

  const meta = parseEnvAndDateCategoryFromRawOrProcessed(filePath);
  const env = meta.env;
  let dateCategory = meta.dateCategory;
  if (dateStr && !dateCategory) {
    dateCategory = optimizer.getDateCategoryForDate(dateStr);
  }

  let finalOutputDir = outputDir;
  if (isEnvSegmentEnabled()) {
    finalOutputDir = dateCategory ? path.join(outputDir, env, dateCategory) : path.join(outputDir, env);
  } else if (dateCategory) {
    finalOutputDir = path.join(outputDir, dateCategory);
  }

  if (!fs.existsSync(finalOutputDir)) {
    fs.mkdirSync(finalOutputDir, { recursive: true });
  }

  const outputPath = path.join(finalOutputDir, `${fileName}.optimized.spec.ts`);
  const outputRel = path.relative(process.cwd(), outputPath).replace(/\\/g, '/');
  optimizer.setImportPathsFromOutputRel(outputRel);

  const result = optimizer.optimize();
  if (!result || result.trim().length === 0) {
    console.log(`❌ 优化失败（未生成内容），跳过写入: ${filePath}`);
    return;
  }

  fs.writeFileSync(outputPath, result, 'utf-8');
  console.log(`✅ 优化完成: ${outputPath}`);

  try {
    const { createRequire } = await import('module');
    const requireCjs = createRequire(import.meta.url);
    const specMeta = requireCjs('../../src/utils/spec-meta.cjs');
    const rawRel = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
    const rawOriginalRel = specMeta.mapProcessedToOriginalRel(rawRel) || rawRel;
    specMeta.copyRawMetaToOptimized(process.cwd(), rawOriginalRel, outputRel, {
      playwrightEnv: env,
      recordSource: 'pipeline',
    });
    const meta = specMeta.resolveOptimizedSpecMeta(process.cwd(), outputRel);
    const withHeader = specMeta.appendSpecMetaHeaderToCode(fs.readFileSync(outputPath, 'utf8'), meta);
    fs.writeFileSync(outputPath, withHeader, 'utf8');
  } catch (e) {
    console.warn(`⚠️ 元数据写入跳过: ${e instanceof Error ? e.message : e}`);
  }
}

// 递归查找所有 .spec.ts 文件
function findSpecFiles(dir: string): string[] {
  const files: string[] = [];
  
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    
    if (item.isDirectory()) {
      // raw-recordings 的 original 目录是备份原始文件，不参与 optimize
      if (item.name === 'original') continue;
      // 递归处理子目录
      files.push(...findSpecFiles(fullPath));
    } else if (item.isFile() && item.name.endsWith('.spec.ts')) {
      files.push(fullPath);
    }
  }
  
  return files.sort();
}

async function main() {
  reloadGenWait();
  const stats = fs.statSync(targetPath);
  
  if (stats.isDirectory()) {
    console.log(`📁 批量处理文件夹: ${targetPath}`);
    
    const files = findSpecFiles(targetPath);
    
    if (files.length === 0) {
      console.log('⚠️  未找到 .spec.ts 文件');
      return;
    }
    
    console.log(`📊 找到 ${files.length} 个测试文件`);
    
    for (const file of files) {
      await processFile(file);
    }
    
    console.log(`🎉 批量优化完成! 共处理 ${files.length} 个文件`);
  } else if (stats.isFile()) {
    if (!targetPath.endsWith('.spec.ts')) {
      console.error('❌ 文件必须以 .spec.ts 结尾');
      process.exit(1);
    }
    await processFile(targetPath);
  } else {
    console.error('❌ 路径不存在或不是文件/文件夹');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ 处理失败:', error);
  process.exit(1);
});
