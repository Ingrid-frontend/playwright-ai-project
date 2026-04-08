import fs from 'fs';
import path from 'path';

class HtmlImagePathFixer {
  private htmlFilePath = 'results/screenshot-comparison.html';
  
  public fixImagePaths(): void {
    console.log('🔧 开始修复HTML文件中的图片路径');
    console.log('='.repeat(50));
    
    if (!fs.existsSync(this.htmlFilePath)) {
      console.error(`❌ HTML文件不存在: ${this.htmlFilePath}`);
      return;
    }
    
    const htmlContent = fs.readFileSync(this.htmlFilePath, 'utf-8');
    console.log(`📄 读取HTML文件: ${this.htmlFilePath} (${htmlContent.length} 字符)`);
    
    const fixedContent = this.replaceImagePaths(htmlContent);
    
    const backupPath = `${this.htmlFilePath}.backup`;
    fs.writeFileSync(backupPath, htmlContent, 'utf-8');
    console.log(`📁 创建备份文件: ${backupPath}`);
    
    fs.writeFileSync(this.htmlFilePath, fixedContent, 'utf-8');
    console.log(`✅ 已修复HTML文件: ${this.htmlFilePath}`);
    
    this.verifyChanges(htmlContent, fixedContent);
  }
  
  private replaceImagePaths(htmlContent: string): string {
    console.log('\n🔄 替换图片路径...');
    
    let fixedContent = htmlContent;
    
    const pathReplacements = [
      // 修复相对路径 - 添加 ../ 前缀
      {
        old: 'src="screenshots/',
        new: 'src="../screenshots/'
      },
      {
        old: "src='screenshots/",
        new: "src='../screenshots/"
      },
      {
        old: 'onclick="openModal(\'screenshots/',
        new: 'onclick="openModal(\'../screenshots/'
      }
    ];
    
    let totalReplacements = 0;
    
    for (const replacement of pathReplacements) {
      const regex = new RegExp(replacement.old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const matches = htmlContent.match(regex);
      const count = matches ? matches.length : 0;
      
      if (count > 0) {
        fixedContent = fixedContent.replace(regex, replacement.new);
        console.log(`📊 替换 "${replacement.old}" → "${replacement.new}": ${count} 处`);
        totalReplacements += count;
      }
    }
    
    console.log(`📈 总共替换了 ${totalReplacements} 处路径`);
    
    return fixedContent;
  }
  
  private verifyChanges(originalContent: string, fixedContent: string): void {
    console.log('\n🔍 验证更改...');
    
    const originalLines = originalContent.split('\n');
    const fixedLines = fixedContent.split('\n');
    
    let changedLines = 0;
    
    for (let i = 0; i < Math.min(originalLines.length, fixedLines.length); i++) {
      if (originalLines[i] !== fixedLines[i]) {
        changedLines++;
        
        if (changedLines <= 5) {
          console.log(`\n📝 第 ${i + 1} 行有更改:`);
          console.log(`   原: ${originalLines[i].substring(0, 100)}...`);
          console.log(`   新: ${fixedLines[i].substring(0, 100)}...`);
        }
      }
    }
    
    console.log(`\n📊 总共 ${changedLines} 行有更改`);
    
    const testPaths = [
      'screenshots/Recording 2026_3_18 at 14_48_15/',
      'screenshots/Recording 2026_3_18 at 18_24_03/',
      'screenshots/2026-03-16_14-17-46/',
      'screenshots/2026-03-17_18-03-44/',
      'screenshots/2026-03-17_18-10-57/',
      'screenshots/2026-03-18_19-39-07/'
    ];
    
    console.log('\n🔎 检查修复后的路径:');
    for (const testPath of testPaths) {
      const oldCount = (originalContent.match(new RegExp(testPath, 'g')) || []).length;
      const newCount = (fixedContent.match(new RegExp(`../screenshots/20260410/${testPath}`, 'g')) || []).length;
      
      if (oldCount > 0) {
        console.log(`  ${testPath}: ${oldCount} → ${newCount} (${oldCount === newCount ? '✅' : '❌'})`);
      }
    }
    
    console.log('\n🔎 检查相对路径前缀:');
    const srcPatterns = [
      'src="../screenshots/',
      "src='../screenshots/",
      'openModal\\(\'../screenshots/'
    ];
    
    for (const pattern of srcPatterns) {
      const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const count = (fixedContent.match(new RegExp(escapedPattern, 'g')) || []).length;
      console.log(`  "${pattern}": ${count} 处`);
    }
  }
  
  public dryRun(): void {
    console.log('🔍 模拟运行 - 不实际修改文件');
    console.log('='.repeat(50));
    
    if (!fs.existsSync(this.htmlFilePath)) {
      console.error(`❌ HTML文件不存在: ${this.htmlFilePath}`);
      return;
    }
    
    const htmlContent = fs.readFileSync(this.htmlFilePath, 'utf-8');
    
    const pathReplacements = [
      {
        old: 'src="screenshots/',
        new: 'src="../screenshots/'
      },
      {
        old: "src='screenshots/",
        new: "src='../screenshots/"
      },
      {
        old: 'onclick="openModal(\'screenshots/',
        new: 'onclick="openModal(\'../screenshots/'
      }
    ];
    
    console.log('\n📋 需要进行的替换:');
    for (const replacement of pathReplacements) {
      const regex = new RegExp(replacement.old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const matches = htmlContent.match(regex);
      const count = matches ? matches.length : 0;
      
      console.log(`  "${replacement.old}" → "${replacement.new}": ${count} 处`);
    }
    
    console.log('\n🔍 示例匹配 (前5个):');
    const sampleRegex = /src="([^"]*screenshots\/[^"]*\.png)"/g;
    let match;
    let sampleCount = 0;
    
    while ((match = sampleRegex.exec(htmlContent)) !== null && sampleCount < 5) {
      const oldPath = match[1];
      const newPath = '../' + oldPath;
      
      console.log(`  ${oldPath} → ${newPath}`);
      sampleCount++;
    }
    
    console.log('\n🔍 模拟运行完成!');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  const fixer = new HtmlImagePathFixer();
  
  if (dryRun) {
    fixer.dryRun();
  } else {
    fixer.fixImagePaths();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { HtmlImagePathFixer };