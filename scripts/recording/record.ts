import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env, curConfig } from '../playwright.config';

interface DateCategoryConfig {
  dateCategories: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dir = 'tests/raw-recordings';
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadDateCategoryConfig(): DateCategoryConfig | null {
  const configPath = path.join(process.cwd(), 'config', 'date-categories.json');

  if (!fs.existsSync(configPath)) {
    console.warn(`⚠️  日期分类配置不存在，将使用默认目录: ${configPath}`);
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as DateCategoryConfig;
  } catch (error) {
    console.warn(`⚠️  读取日期分类配置失败，将使用默认目录: ${error}`);
    return null;
  }
}

function parseCategoryDate(dateStr: string): Date {
  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(4, 6), 10) - 1;
  const day = parseInt(dateStr.substring(6, 8), 10);
  return new Date(year, month, day);
}

function getDateCategoryForDate(dateStr: string): string {
  const config = loadDateCategoryConfig();
  if (!config?.dateCategories?.length) {
    return 'default';
  }

  const fileDate = parseCategoryDate(dateStr);

  for (const category of config.dateCategories) {
    const categoryDate = parseCategoryDate(category);
    if (fileDate <= categoryDate) {
      return category;
    }
  }

  return config.dateCategories[config.dateCategories.length - 1];
}

// CI/CD 环境中跳过录制
const isCI = process.env.CI === 'true' || 
             process.env.CI === '1' || 
             process.env.GITHUB_ACTIONS === 'true' ||
             process.env.GITHUB_ACTIONS === '1';

if (isCI) {
  console.log('🤖 检测到 CI/CD 环境，跳过录制步骤');
  console.log('📁 将使用已存在的录制文件');
  process.exit(0);
}

const storagePath = curConfig.storageState;
if (!fs.existsSync(storagePath) || fs.statSync(storagePath).size <= 10) {
  console.log('🔐 登录状态文件不存在或无效，正在执行登录...');
  execSync('npx playwright test src/setup/login.setup.ts', { stdio: 'inherit' });
}

function sanitizeSegment(input: string): string {
  return input
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 24) || 'recording';
}

function getArgValue(flag: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const cur = args[i];
    if (cur === flag && i + 1 < args.length) return args[i + 1];
    if (cur.startsWith(flag + '=')) return cur.slice(flag.length + 1);
  }
  return undefined;
}

/**
 * Raw recordings 命名规范：<feature>-<behavior>_<timestamp>.spec.ts
 * - feature/behavior 可通过 CLI 传入，便于自动化与后续脚本解析
 * - timestamp 固定为 YYYY-MM-DD_HH-mm-ss（便于排序与 grep）
 */
const feature = sanitizeSegment(getArgValue('--feature') || 'recording');
const behavior = sanitizeSegment(getArgValue('--behavior') || getArgValue('--action') || 'codegen');

const now = new Date();
const timestamp = now.getFullYear() + '-' + 
  String(now.getMonth() + 1).padStart(2, '0') + '-' + 
  String(now.getDate()).padStart(2, '0') + '_' + 
  String(now.getHours()).padStart(2, '0') + '-' + 
  String(now.getMinutes()).padStart(2, '0') + '-' + 
  String(now.getSeconds()).padStart(2, '0');
const dateStr = timestamp.split('_')[0].replaceAll('-', '');
const dateCategory = getDateCategoryForDate(dateStr);
const outputDir = path.join(dir, dateCategory);

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const outputFile = path.join(outputDir, `${feature}-${behavior}_${timestamp}.spec.ts`);

const command = `npx playwright codegen ${curConfig.baseURL} --load-storage=${curConfig.storageState} -o ${outputFile}`;

console.log(`🚀 开始录制，完成后将保存至: ${outputFile}`);
console.log(`📌 环境: ${env}`);
console.log(`📌 基础URL: ${curConfig.baseURL}`);
execSync(command, { stdio: 'inherit' });
