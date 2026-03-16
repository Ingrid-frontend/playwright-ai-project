import fs from 'fs';
import path from 'path';

function renameFiles(dir: string): void {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      renameFiles(filePath);
      
      const oldName = file;
      let newName = oldName;
      
      if (oldName.includes('T')) {
        newName = oldName.replace(/T/, '_');
      }
      
      if (oldName !== newName) {
        const oldPath = path.join(dir, oldName);
        const newPath = path.join(dir, newName);
        
        try {
          fs.renameSync(oldPath, newPath);
          console.log(`✅ 重命名目录: ${oldName} -> ${newName}`);
        } catch (error) {
          console.error(`❌ 重命名目录失败: ${oldName} -> ${newName}`);
          console.error(`   错误: ${error}`);
        }
      }
    } else if (file.endsWith('.spec.ts') || file.endsWith('.analysis.json')) {
      const oldName = file;
      
      let newName = oldName;
      
      if (newName.includes('T')) {
        newName = newName.replace(/T/, '_');
      }
      
      if (newName.includes(':')) {
        newName = newName.replace(/:/g, '-');
      }
      
      if (oldName !== newName) {
        const oldPath = path.join(dir, oldName);
        const newPath = path.join(dir, newName);
        
        try {
          fs.renameSync(oldPath, newPath);
          console.log(`✅ 重命名: ${oldName} -> ${newName}`);
        } catch (error) {
          console.error(`❌ 重命名失败: ${oldName} -> ${newName}`);
          console.error(`   错误: ${error}`);
        }
      }
    }
  });
}

function main() {
  const directories = [
    'tests/raw-recordings',
    'tests/optimized',
    'screenshots'
  ];
  
  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      console.error(`❌ 目录不存在: ${dir}`);
      return;
    }
    
    console.log(`🔧 正在优化 ${dir} 目录下的文件名...`);
    console.log(`📁 目标格式: YYYY-MM-DD_HH-MM-SS.spec.ts\n`);
    
    renameFiles(dir);
    
    console.log('');
  });
  
  console.log('✨ 文件名优化完成！');
}

main();
