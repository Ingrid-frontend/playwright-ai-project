import fs from 'fs';
import path from 'path';
import {
  parseDateCategoryToDate,
  toShortDateCategoryCode,
  normalizeDateCategoryList,
} from '../../src/utils/date-category.cjs';

interface DateCategoryConfig {
  dateCategories: string[];
  description: string;
  example: {
    fileDate: string;
    category: string;
    reason: string;
  };
  note: string;
}

class SimpleFileOrganizer {
  private config: DateCategoryConfig;
  private dateCategories: Date[];
  
  constructor() {
    this.config = this.loadConfig();
    this.config.dateCategories = normalizeDateCategoryList(this.config.dateCategories);
    this.dateCategories = this.parseDateCategories();
  }
  
  private loadConfig(): DateCategoryConfig {
    const configPath = path.join(process.cwd(), 'config', 'date-categories.json');
    
    if (!fs.existsSync(configPath)) {
      console.error(`❌ 配置文件不存在: ${configPath}`);
      console.log('请先创建 config/date-categories.json 文件');
      process.exit(1);
    }
    
    const configContent = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(configContent);
  }
  
  private parseDateCategories(): Date[] {
    return this.config.dateCategories.map((dateStr) => parseDateCategoryToDate(dateStr));
  }
  
  private extractDateFromFileName(fileName: string): string | null {
    const patterns = [
      // 格式: YYYY-MM-DD_HH-MM-SS
      /(\d{4}-\d{2}-\d{2})_\d{2}-\d{2}-\d{2}/,
      // 格式: YYYY-MM-DD
      /(\d{4}-\d{2}-\d{2})/,
    ];
    
    for (const pattern of patterns) {
      const match = fileName.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    return null;
  }
  
  private parseDate(dateStr: string): Date {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1;
      const day = parseInt(parts[2]);
      return new Date(year, month, day);
    }
    
    throw new Error(`无法解析日期: ${dateStr}`);
  }
  
  private findDateCategory(fileDate: Date): string {
    for (let i = 0; i < this.dateCategories.length; i++) {
      if (fileDate <= this.dateCategories[i]) {
        return toShortDateCategoryCode(this.config.dateCategories[i]);
      }
    }

    return toShortDateCategoryCode(
      this.config.dateCategories[this.config.dateCategories.length - 1],
    );
  }
  
  private organizeDirectory(dirPath: string): void {
    console.log(`\n📂 处理目录: ${dirPath}`);
    
    if (!fs.existsSync(dirPath)) {
      console.warn(`⚠️  目录不存在: ${dirPath}`);
      return;
    }
    
    const items = fs.readdirSync(dirPath);
    const filesToMove: Array<{src: string, dest: string}> = [];
    
    for (const item of items) {
      if (item === '.gitkeep') {
        continue;
      }
      
      const itemPath = path.join(dirPath, item);
      const stat = fs.statSync(itemPath);
      
      if (!stat.isFile()) {
        continue;
      }
      
      const extractedDate = this.extractDateFromFileName(item);
      
      if (!extractedDate) {
        console.warn(`⚠️  无法从文件名提取日期: ${item}`);
        continue;
      }
      
      try {
        const fileDate = this.parseDate(extractedDate);
        const dateCategory = this.findDateCategory(fileDate);
        
        const categoryDir = path.join(dirPath, dateCategory);
        if (!fs.existsSync(categoryDir)) {
          fs.mkdirSync(categoryDir, { recursive: true });
          console.log(`📁 创建分类目录: ${categoryDir}`);
        }
        
        filesToMove.push({
          src: itemPath,
          dest: path.join(categoryDir, item)
        });
        
      } catch (error) {
        console.error(`❌ 处理文件失败: ${item}`, error);
      }
    }
    
    if (filesToMove.length === 0) {
      console.log('ℹ️  没有找到需要处理的文件');
      return;
    }
    
    console.log(`📊 找到 ${filesToMove.length} 个文件需要处理`);
    
    const categoryCounts: Record<string, number> = {};
    for (const file of filesToMove) {
      const category = path.basename(path.dirname(file.dest));
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    }
    
    console.log('📈 分类统计:');
    for (const [category, count] of Object.entries(categoryCounts)) {
      console.log(`  ${category}: ${count} 个文件`);
    }
    
    console.log('\n🚀 开始移动文件...');
    let movedCount = 0;
    
    for (const file of filesToMove) {
      try {
        fs.renameSync(file.src, file.dest);
        console.log(`📄 移动文件: ${path.basename(file.src)} → ${path.relative(dirPath, file.dest)}`);
        movedCount++;
      } catch (error) {
        console.error(`❌ 移动文件失败: ${path.basename(file.src)}`, error);
      }
    }
    
    console.log(`\n✅ 完成! 共移动了 ${movedCount} 个文件`);
  }
  
  public organizeAll(): void {
    console.log('📅 开始按日期分类整理文件');
    console.log('='.repeat(50));
    
    const directories = [
      'tests/optimized',
      'tests/raw-recordings'
    ];
    
    for (const dir of directories) {
      this.organizeDirectory(dir);
    }
    
    console.log('\n🎉 文件整理完成!');
    console.log('\n📝 注意: screenshots目录已有按日期组织的结构，未进行处理');
  }
  
  public dryRun(): void {
    console.log('🔍 模拟运行 - 不实际移动文件');
    console.log('='.repeat(50));
    
    const directories = [
      'tests/optimized',
      'tests/raw-recordings'
    ];
    
    for (const dir of directories) {
      console.log(`\n📂 模拟处理目录: ${dir}`);
      
      if (!fs.existsSync(dir)) {
        console.warn(`⚠️  目录不存在: ${dir}`);
        continue;
      }
      
      const items = fs.readdirSync(dir);
      const filesToMove: Array<{src: string, dest: string}> = [];
      
      for (const item of items) {
        if (item === '.gitkeep') {
          continue;
        }
        
        const itemPath = path.join(dir, item);
        const stat = fs.statSync(itemPath);
        
        if (!stat.isFile()) {
          continue;
        }
        
        const extractedDate = this.extractDateFromFileName(item);
        
        if (!extractedDate) {
          console.warn(`⚠️  无法从文件名提取日期: ${item}`);
          continue;
        }
        
        try {
          const fileDate = this.parseDate(extractedDate);
          const dateCategory = this.findDateCategory(fileDate);
          
          filesToMove.push({
            src: itemPath,
            dest: path.join(dir, dateCategory, item)
          });
          
        } catch (error) {
          console.error(`❌ 处理文件失败: ${item}`, error);
        }
      }
      
      if (filesToMove.length === 0) {
        console.log('ℹ️  没有找到需要处理的文件');
        continue;
      }
      
      console.log(`📊 找到 ${filesToMove.length} 个文件需要处理`);
      
      const categoryCounts: Record<string, number> = {};
      for (const file of filesToMove) {
        const category = path.basename(path.dirname(file.dest));
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      }
      
      console.log('📈 分类统计:');
      for (const [category, count] of Object.entries(categoryCounts)) {
        console.log(`  ${category}: ${count} 个文件`);
      }
      
      console.log('\n📋 文件移动计划 (前5个):');
      for (let i = 0; i < Math.min(5, filesToMove.length); i++) {
        const file = filesToMove[i];
        console.log(`  ${path.basename(file.src)} → ${path.relative(dir, file.dest)}`);
      }
      
      if (filesToMove.length > 5) {
        console.log(`  ... 还有 ${filesToMove.length - 5} 个文件`);
      }
    }
    
    console.log('\n🔍 模拟运行完成!');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  const organizer = new SimpleFileOrganizer();
  
  if (dryRun) {
    organizer.dryRun();
  } else {
    organizer.organizeAll();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { SimpleFileOrganizer };