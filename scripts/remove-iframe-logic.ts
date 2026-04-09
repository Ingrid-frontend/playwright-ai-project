import fs from 'fs';
import path from 'path';

class IframeLogicRemover {
  private rawRecordingsDir = 'tests/raw-recordings';
  
  constructor() {
    this.ensureDirectoryExists();
  }
  
  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.rawRecordingsDir)) {
      console.error(`❌ 目录不存在: ${this.rawRecordingsDir}`);
      process.exit(1);
    }
  }
  
  private removeIframeLogic(content: string): string {
    // 转换包含 locator('iframe').contentFrame() 的代码行
    // 将 page.locator('iframe').contentFrame().something 转换为 page.something
    const lines = content.split('\n');
    const processedLines = lines.map(line => {
      // 检查是否包含 locator('iframe').contentFrame()
      const hasIframeContentFrame = line.includes("locator('iframe').contentFrame()") || 
                                   line.includes('locator("iframe").contentFrame()');
      
      if (!hasIframeContentFrame) {
        // 不包含iframe，直接返回原行
        return line;
      }
      
      // 转换代码行
      // 匹配 page.locator('iframe').contentFrame().something
      // 例如: await page.locator('iframe').contentFrame().getByRole('tab', { name: '账号登录' }).click();
      // 应该转换为: await page.getByRole('tab', { name: '账号登录' }).click();
      
      // 使用正则表达式匹配并转换
      let processedLine = line;
      
      // 处理单引号
      processedLine = processedLine.replace(
        /page\.locator\('iframe'\)\.contentFrame\(\)\./g,
        'page.'
      );
      
      // 处理双引号
      processedLine = processedLine.replace(
        /page\.locator\("iframe"\)\.contentFrame\(\)\./g,
        'page.'
      );
      
      return processedLine;
    });
    
    return processedLines.join('\n');
  }
  
  private processFile(filePath: string): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const processedContent = this.removeIframeLogic(content);
      
      // 检查是否有变化
      if (content === processedContent) {
        console.log(`⏭️  无需修改: ${filePath}`);
        return;
      }
      
      // 计算转换了多少行
      const originalLines = content.split('\n');
      const processedLines = processedContent.split('\n');
      let convertedLines = 0;
      
      for (let i = 0; i < originalLines.length; i++) {
        if (originalLines[i] !== processedLines[i]) {
          convertedLines++;
        }
      }
      
      // 写入文件
      fs.writeFileSync(filePath, processedContent, 'utf-8');
      console.log(`✅ 已处理: ${filePath} (转换了 ${convertedLines} 行)`);
      
    } catch (error) {
      console.error(`❌ 处理文件失败: ${filePath}`, error);
    }
  }
  
  private findSpecFiles(dir: string): string[] {
    const files: string[] = [];
    
    const items = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      
      if (item.isDirectory()) {
        // 递归处理子目录
        files.push(...this.findSpecFiles(fullPath));
      } else if (item.isFile() && item.name.endsWith('.spec.ts')) {
        files.push(fullPath);
      }
    }
    
    return files;
  }
  
  public processAllFiles(): void {
    console.log('🔍 开始处理 tests/raw-recordings 目录下的所有 .spec.ts 文件...');
    
    const specFiles = this.findSpecFiles(this.rawRecordingsDir);
    
    if (specFiles.length === 0) {
      console.log('📭 未找到任何 .spec.ts 文件');
      return;
    }
    
    console.log(`📊 找到 ${specFiles.length} 个文件需要处理`);
    console.log('='.repeat(50));
    
    let totalRemoved = 0;
    let processedCount = 0;
    
    for (const filePath of specFiles) {
      const relativePath = path.relative(process.cwd(), filePath);
      console.log(`📄 处理: ${relativePath}`);
      
      // 备份原始文件
      const backupPath = filePath + '.backup';
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(filePath, backupPath);
      }
      
      // 处理文件
      const originalContent = fs.readFileSync(filePath, 'utf-8');
      const processedContent = this.removeIframeLogic(originalContent);
      
      // 计算转换了多少行
      const originalLinesArray = originalContent.split('\n');
      const processedLinesArray = processedContent.split('\n');
      let convertedLines = 0;
      
      for (let i = 0; i < originalLinesArray.length; i++) {
        if (originalLinesArray[i] !== processedLinesArray[i]) {
          convertedLines++;
        }
      }
      
      if (convertedLines > 0) {
        fs.writeFileSync(filePath, processedContent, 'utf-8');
        console.log(`  ✅ 转换了 ${convertedLines} 行 iframe 逻辑`);
        totalRemoved += convertedLines;
        processedCount++;
      } else {
        console.log(`  ⏭️  无需修改`);
      }
    }
    
    console.log('='.repeat(50));
    console.log(`🎉 处理完成!`);
    console.log(`📊 统计:`);
    console.log(`  - 处理了 ${processedCount}/${specFiles.length} 个文件`);
    console.log(`  - 总共转换了 ${totalRemoved} 行 iframe 逻辑`);
    
    // 显示备份文件信息
    const backupFiles = this.findSpecFiles(this.rawRecordingsDir)
      .filter(file => file.endsWith('.backup'));
    
    if (backupFiles.length > 0) {
      console.log(`  - 创建了 ${backupFiles.length} 个备份文件 (*.spec.ts.backup)`);
      console.log(`  - 如需恢复，请手动删除 .spec.ts 文件并将 .backup 文件重命名`);
    }
  }
  
  public processSingleFile(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      console.error(`❌ 文件不存在: ${filePath}`);
      process.exit(1);
    }
    
    if (!filePath.endsWith('.spec.ts')) {
      console.error(`❌ 文件必须是 .spec.ts 格式: ${filePath}`);
      process.exit(1);
    }
    
    console.log(`🔍 处理单个文件: ${filePath}`);
    
    // 备份原始文件
    const backupPath = filePath + '.backup';
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(filePath, backupPath);
      console.log(`📋 已创建备份: ${backupPath}`);
    }
    
    // 处理文件
    const originalContent = fs.readFileSync(filePath, 'utf-8');
    const processedContent = this.removeIframeLogic(originalContent);
    
    // 计算转换了多少行
    const originalLinesArray = originalContent.split('\n');
    const processedLinesArray = processedContent.split('\n');
    let convertedLines = 0;
    
    for (let i = 0; i < originalLinesArray.length; i++) {
      if (originalLinesArray[i] !== processedLinesArray[i]) {
        convertedLines++;
      }
    }
    
    if (convertedLines > 0) {
      fs.writeFileSync(filePath, processedContent, 'utf-8');
      console.log(`✅ 处理完成!`);
      console.log(`📊 转换了 ${convertedLines} 行 iframe 逻辑`);
      
      // 显示预览
      console.log('='.repeat(50));
      console.log('📝 处理后的文件预览 (前20行):');
      console.log('='.repeat(50));
      const previewLines = processedContent.split('\n').slice(0, 20);
      previewLines.forEach((line, index) => {
        console.log(`${index + 1}: ${line}`);
      });
      const totalLines = processedContent.split('\n').length;
      if (totalLines > 20) {
        console.log(`... (还有 ${totalLines - 20} 行)`);
      }
    } else {
      console.log(`⏭️  文件无需修改，未包含 iframe 逻辑`);
    }
  }
}

// 命令行参数处理
const args = process.argv.slice(2);

const remover = new IframeLogicRemover();

if (args.length === 0) {
  // 批量处理所有文件
  remover.processAllFiles();
} else if (args[0] === '--file' && args[1]) {
  // 处理单个文件
  remover.processSingleFile(args[1]);
} else if (args[0] === '--help' || args[0] === '-h') {
  console.log('📖 使用方法:');
  console.log('  批量处理所有文件: npm run remove-iframe-logic');
  console.log('  处理单个文件: npm run remove-iframe-logic -- --file tests/raw-recordings/xxx.spec.ts');
  console.log('  显示帮助: npm run remove-iframe-logic -- --help');
} else {
  console.error('❌ 无效的参数');
  console.log('📖 使用方法:');
  console.log('  批量处理所有文件: npm run remove-iframe-logic');
  console.log('  处理单个文件: npm run remove-iframe-logic -- --file tests/raw-recordings/xxx.spec.ts');
  process.exit(1);
}