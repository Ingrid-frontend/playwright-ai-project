import fs from 'fs';
import path from 'path';

interface ErrorInfo {
  testFile: string;
  testName: string;
  error: string;
  stack?: string;
  errorLine?: number;
  errorColumn?: number;
  errorFile?: string;
  timestamp: string;
  duration: number;
}

interface ErrorReport {
  summary: {
    totalErrors: number;
    uniqueErrors?: number;
    timestamp: string;
    nodeVersion: string;
    platform: string;
    arch: string;
  };
  errors: ErrorInfo[];
}

function analyzeErrors(): void {
  const errorDir = 'tests/deprecated/errors';
  
  if (!fs.existsSync(errorDir)) {
    console.log('❌ 错误目录不存在:', errorDir);
    return;
  }

  const errorFiles = fs.readdirSync(errorDir)
    .filter(file => file.startsWith('test-errors-') && file.endsWith('.json'))
    .sort()
    .reverse();

  if (errorFiles.length === 0) {
    console.log('✅ 没有找到错误文件');
    return;
  }

  console.log('📊 错误分析报告');
  console.log('═════════════════════════════════════\n');

  let totalErrors = 0;
  let totalUniqueErrors = 0;
  const allErrors: ErrorInfo[] = [];
  const fileStats: Record<string, { total: number; unique: number }> = {};
  const lineStats: Record<string, { count: number; errors: ErrorInfo[] }> = {};

  for (const file of errorFiles) {
    const filePath = path.join(errorDir, file);
    const content: ErrorReport = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    const uniqueErrors = content.summary.uniqueErrors || content.summary.totalErrors;
    
    console.log(`📄 ${file}`);
    console.log(`   总错误数: ${content.summary.totalErrors}`);
    if (content.summary.uniqueErrors !== undefined) {
      console.log(`   唯一错误数: ${content.summary.uniqueErrors}`);
      console.log(`   重复错误数: ${content.summary.totalErrors - content.summary.uniqueErrors}`);
    }
    console.log(`   生成时间: ${content.summary.timestamp}`);
    console.log(`   Node版本: ${content.summary.nodeVersion}`);
    console.log(`   平台: ${content.summary.platform} (${content.summary.arch})`);
    
    const errorGroups: Record<string, number> = {};
    for (const error of content.errors) {
      const fileName = path.basename(error.testFile);
      if (!errorGroups[fileName]) {
        errorGroups[fileName] = 0;
      }
      errorGroups[fileName]++;
      allErrors.push(error);
      
      if (error.errorLine !== undefined && error.errorColumn !== undefined) {
        const lineKey = `${fileName}:${error.errorLine}:${error.errorColumn}`;
        if (!lineStats[lineKey]) {
          lineStats[lineKey] = { count: 0, errors: [] };
        }
        lineStats[lineKey].count++;
        lineStats[lineKey].errors.push(error);
      }
    }
    
    console.log('   按文件统计:');
    for (const [fileName, count] of Object.entries(errorGroups)) {
      console.log(`     ${fileName}: ${count}个错误`);
      
      if (!fileStats[fileName]) {
        fileStats[fileName] = { total: 0, unique: 0 };
      }
      fileStats[fileName].total += count;
      fileStats[fileName].unique += count;
    }
    console.log();
    
    totalErrors += content.summary.totalErrors;
    totalUniqueErrors += uniqueErrors;
  }

  console.log('═════════════════════════════════════');
  console.log(`📈 总体统计`);
  console.log(`   总错误数: ${totalErrors}`);
  console.log(`   唯一错误数: ${totalUniqueErrors}`);
  if (totalErrors > totalUniqueErrors) {
    console.log(`   重复错误数: ${totalErrors - totalUniqueErrors}`);
    console.log(`   重复率: ${((totalErrors - totalUniqueErrors) / totalErrors * 100).toFixed(1)}%`);
  }
  console.log(`   错误文件数: ${errorFiles.length}`);
  console.log();

  if (allErrors.length > 0) {
    console.log('📁 按文件统计（累计）');
    console.log('──────────────────────────────────────────────────');
    
    const sortedFileStats = Object.entries(fileStats)
      .sort((a, b) => b[1].total - a[1].total);
    
    for (const [fileName, stats] of sortedFileStats) {
      const percentage = ((stats.total / totalErrors) * 100).toFixed(1);
      console.log(`   ${fileName}`);
      console.log(`   错误数: ${stats.total} (${percentage}%)`);
      console.log();
    }

    if (Object.keys(lineStats).length > 0) {
      console.log('📍 按代码行号统计（最频繁的错误行）');
      console.log('──────────────────────────────────────────────────');
      
      const sortedLineStats = Object.entries(lineStats)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10);
      
      for (const [lineKey, stats] of sortedLineStats) {
        const percentage = ((stats.count / totalErrors) * 100).toFixed(1);
        const errorInfo = stats.errors[0];
        const errorType = errorInfo.error.split('\n')[0].trim();
        
        console.log(`   📍 ${lineKey}`);
        console.log(`   错误: ${errorType.substring(0, 70)}${errorType.length > 70 ? '...' : ''}`);
        console.log(`   次数: ${stats.count} (${percentage}%)`);
        console.log(`   测试: ${errorInfo.testName}`);
        console.log();
      }
    }

    console.log('🔍 错误类型分析');
    console.log('──────────────────────────────────────────────────');
    
    const errorTypes: Record<string, number> = {};
    for (const error of allErrors) {
      const errorType = error.error.split('\n')[0].trim();
      if (!errorTypes[errorType]) {
        errorTypes[errorType] = 0;
      }
      errorTypes[errorType]++;
    }
    
    const sortedErrorTypes = Object.entries(errorTypes)
      .sort((a, b) => b[1] - a[1]);
    
    for (const [errorType, count] of sortedErrorTypes) {
      const percentage = ((count / allErrors.length) * 100).toFixed(1);
      console.log(`   ${errorType.substring(0, 60)}${errorType.length > 60 ? '...' : ''}`);
      console.log(`   次数: ${count} (${percentage}%)`);
      console.log();
    }

    console.log('🎯 最频繁的测试错误');
    console.log('──────────────────────────────────────────────────');
    
    const testErrors: Record<string, number> = {};
    for (const error of allErrors) {
      const testKey = `${path.basename(error.testFile)}::${error.testName}`;
      if (!testErrors[testKey]) {
        testErrors[testKey] = 0;
      }
      testErrors[testKey]++;
    }
    
    const sortedTestErrors = Object.entries(testErrors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    for (const [testKey, count] of sortedTestErrors) {
      const percentage = ((count / allErrors.length) * 100).toFixed(1);
      console.log(`   ${testKey}`);
      console.log(`   次数: ${count} (${percentage}%)`);
      console.log();
    }

    console.log('⏱️ 测试执行时长分析');
    console.log('──────────────────────────────────────────────────');
    
    const durations = allErrors.map(e => e.duration);
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const maxDuration = Math.max(...durations);
    const minDuration = Math.min(...durations);
    
    console.log(`   平均时长: ${(avgDuration / 1000).toFixed(2)}s`);
    console.log(`   最长时长: ${(maxDuration / 1000).toFixed(2)}s`);
    console.log(`   最短时长: ${(minDuration / 1000).toFixed(2)}s`);
    console.log();

    console.log('📅 错误时间分布');
    console.log('──────────────────────────────────────────────────');
    
    const timeDistribution: Record<string, number> = {};
    for (const error of allErrors) {
      const hour = new Date(error.timestamp).getHours();
      const timeRange = `${hour}:00-${hour + 1}:00`;
      if (!timeDistribution[timeRange]) {
        timeDistribution[timeRange] = 0;
      }
      timeDistribution[timeRange]++;
    }
    
    const sortedTimeDistribution = Object.entries(timeDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    for (const [timeRange, count] of sortedTimeDistribution) {
      const percentage = ((count / allErrors.length) * 100).toFixed(1);
      console.log(`   ${timeRange}: ${count}个错误 (${percentage}%)`);
    }
    console.log();
  }

  console.log('═════════════════════════════════════');
  console.log('💡 建议');
  console.log('──────────────────────────────────────────────────');
  
  if (totalErrors > totalUniqueErrors) {
    console.log('   ⚠️  发现重复错误，建议检查测试重试机制');
  }
  
  const avgDuration = allErrors.length > 0 
    ? allErrors.map(e => e.duration).reduce((a, b) => a + b, 0) / allErrors.length 
    : 0;
  
  if (avgDuration > 20000) {
    console.log('   ⚠️  测试平均执行时长较长，建议优化测试性能');
  }
  
  const errorTypes = new Set(allErrors.map(e => e.error.split('\n')[0].trim()));
  if (errorTypes.size > 5) {
    console.log('   ⚠️  错误类型较多，建议分类处理');
  }
  
  if (Object.keys(lineStats).length > 0) {
    const topLine = Object.entries(lineStats)
      .sort((a, b) => b[1].count - a[1].count)[0];
    
    if (topLine[1].count > 2) {
      console.log(`   ⚠️  发现高频错误行: ${topLine[0]} (${topLine[1].count}次)，建议优先优化`);
    }
  }
  
  console.log('═════════════════════════════════════');
}

analyzeErrors();
