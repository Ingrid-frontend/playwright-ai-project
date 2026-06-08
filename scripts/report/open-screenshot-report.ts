import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const reportRel = path.join('results', 'screenshot-comparison.html');
const screenshotsDir = path.join(repoRoot, 'screenshots');

function hasScreenshotPng(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isFile() && /\.png$/i.test(ent.name)) return true;
    if (ent.isDirectory() && !ent.name.startsWith('.') && hasScreenshotPng(full)) return true;
  }
  return false;
}

function openReportFile(absReport: string): void {
  const q = (p: string) => `"${p.replace(/"/g, '\\"')}"`;
  if (process.platform === 'darwin') {
    execSync(`open ${q(absReport)}`, { stdio: 'inherit' });
  } else if (process.platform === 'win32') {
    execSync(`start "" ${q(absReport)}`, { stdio: 'inherit', shell: true });
  } else {
    execSync(`xdg-open ${q(absReport)}`, { stdio: 'inherit' });
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const openOnly = args.includes('--open-only');
  const absReport = path.join(repoRoot, reportRel);

  if (!openOnly || !fs.existsSync(absReport)) {
    if (!hasScreenshotPng(screenshotsDir)) {
      console.error('❌ screenshots/ 下未找到 PNG，无法生成对比报告。');
      console.error('   可先执行用例生成截图，或将历史截图放入 screenshots/ 后重试。');
      process.exit(1);
    }
    console.log('📸 正在根据 screenshots/ 生成对比报告…');
    const r = spawnSync('npm', ['run', 'compare-screenshots', '--'], {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (r.status !== 0) {
      process.exit(r.status ?? 1);
    }
  }

  if (!fs.existsSync(absReport)) {
    console.error(`❌ 未找到报告: ${reportRel}`);
    process.exit(1);
  }

  console.log(`✅ 报告: ${reportRel}`);
  console.log('   通过 Studio 查看时路径: /repo-report/results/screenshot-comparison.html');
  try {
    openReportFile(absReport);
  } catch (e) {
    console.warn('⚠️  无法用系统默认程序打开，请手动打开上述 HTML 文件。', e);
  }
}

main();
