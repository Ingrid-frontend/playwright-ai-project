import fs from 'fs';
import path from 'path';

class ScreenshotsFixer {
  private screenshotsDir = 'screenshots';
  
  public fixStructure(): void {
    console.log('🔧 开始修复screenshots目录结构');
    console.log('='.repeat(50));
    
    this.createMissingCategoryFolders();
    this.moveFilesFromWrongLocation();
    this.cleanupEmptyFolders();
    
    console.log('\n✅ screenshots目录结构修复完成!');
  }
  
  private createMissingCategoryFolders(): void {
    const categories = ['20260313', '20260410', '20260515'];
    
    for (const category of categories) {
      const categoryDir = path.join(this.screenshotsDir, category);
      if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
        console.log(`📁 创建缺失的分类目录: ${categoryDir}`);
      }
    }
  }
  
  private moveFilesFromWrongLocation(): void {
    const wrongLocation = path.join(this.screenshotsDir, '20260515', '20260410');
    
    if (fs.existsSync(wrongLocation)) {
      console.log(`📂 发现错误位置的文件: ${wrongLocation}`);
      this.moveItems(wrongLocation, path.join(this.screenshotsDir, '20260410'));
    }
    
    this.moveRootDateFoldersTo20260410();
  }
  
  private moveItems(srcDir: string, targetDir: string): void {
    const items = fs.readdirSync(srcDir);
    let movedCount = 0;
    
    for (const item of items) {
      const srcPath = path.join(srcDir, item);
      const destPath = path.join(targetDir, item);
      
      try {
        if (fs.existsSync(destPath)) {
          console.warn(`⚠️  目标已存在，跳过: ${item}`);
          continue;
        }
        
        fs.renameSync(srcPath, destPath);
        console.log(`📄 移动文件/目录: ${item} → ${path.relative(this.screenshotsDir, targetDir)}/`);
        movedCount++;
      } catch (error) {
        console.error(`❌ 移动失败: ${item}`, error);
      }
    }
    
    console.log(`📊 共移动了 ${movedCount} 个项目`);
  }
  
  private moveRootDateFoldersTo20260410(): void {
    console.log('\n📂 处理根目录下的文件夹');
    
    const targetDir = path.join(this.screenshotsDir, '20260410');
    const items = fs.readdirSync(this.screenshotsDir);
    let deletedCount = 0;
    let movedCount = 0;
    
    const datePattern = /^\d{4}-\d{2}-\d{2}/;
    const recordingPattern = /^Recording/;
    
    for (const item of items) {
      if (item === '20260313' || item === '20260410' || item === '20260515') {
        continue;
      }
      
      const srcPath = path.join(this.screenshotsDir, item);
      
      try {
        const stat = fs.statSync(srcPath);
        if (!stat.isDirectory()) {
          continue;
        }
        
        const destPath = path.join(targetDir, item);
        
        if (fs.existsSync(destPath)) {
          console.warn(`⚠️  目标已存在，删除重复的根目录文件夹: ${item}`);
          this.deleteDirectoryRecursive(srcPath);
          deletedCount++;
        } else if (datePattern.test(item) || recordingPattern.test(item)) {
          fs.renameSync(srcPath, destPath);
          console.log(`📄 移动目录: ${item} → 20260410/`);
          movedCount++;
        }
      } catch (error) {
        console.error(`❌ 处理失败: ${item}`, error);
      }
    }
    
    if (deletedCount > 0) {
      console.log(`📊 共删除了 ${deletedCount} 个重复的文件夹`);
    }
    if (movedCount > 0) {
      console.log(`📊 共移动了 ${movedCount} 个文件夹到 20260410/`);
    }
  }
  
  private deleteDirectoryRecursive(dirPath: string): void {
    if (fs.existsSync(dirPath)) {
      const items = fs.readdirSync(dirPath);
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory()) {
          this.deleteDirectoryRecursive(itemPath);
        } else {
          fs.unlinkSync(itemPath);
        }
      }
      
      fs.rmdirSync(dirPath);
    }
  }
  
  private cleanupEmptyFolders(): void {
    const emptyFolders = [
      path.join(this.screenshotsDir, '20260515', '20260410'),
      path.join(this.screenshotsDir, '20260515')
    ];
    
    for (const folder of emptyFolders) {
      if (fs.existsSync(folder)) {
        try {
          const items = fs.readdirSync(folder);
          if (items.length === 0) {
            fs.rmdirSync(folder);
            console.log(`🗑️  删除空目录: ${path.relative(this.screenshotsDir, folder)}`);
          } else {
            console.warn(`⚠️  目录非空，保留: ${path.relative(this.screenshotsDir, folder)}`);
          }
        } catch (error) {
          console.error(`❌ 检查目录失败: ${folder}`, error);
        }
      }
    }
  }
  
  public dryRun(): void {
    console.log('🔍 模拟运行 - 不实际修改文件');
    console.log('='.repeat(50));
    
    const categories = ['20260313', '20260410', '20260515'];
    
    console.log('\n📁 需要创建的分类目录:');
    for (const category of categories) {
      const categoryDir = path.join(this.screenshotsDir, category);
      if (!fs.existsSync(categoryDir)) {
        console.log(`  ${categoryDir}`);
      }
    }
    
    const wrongLocation = path.join(this.screenshotsDir, '20260515', '20260410');
    
    if (fs.existsSync(wrongLocation)) {
      console.log(`\n📂 发现错误位置的文件: ${wrongLocation}`);
      
      const items = fs.readdirSync(wrongLocation);
      console.log(`📊 需要移动 ${items.length} 个项目到 20260410/`);
      
      console.log('📋 需要移动的项目 (前10个):');
      for (let i = 0; i < Math.min(10, items.length); i++) {
        console.log(`  ${items[i]}`);
      }
      
      if (items.length > 10) {
        console.log(`  ... 还有 ${items.length - 10} 个项目`);
      }
    } else {
      console.log('\nℹ️  没有找到错误位置的文件');
    }
    
    console.log('\n🔍 模拟运行完成!');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  const fixer = new ScreenshotsFixer();
  
  if (dryRun) {
    fixer.dryRun();
  } else {
    fixer.fixStructure();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { ScreenshotsFixer };