import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { env, curConfig } from '../../playwright.config';
import {
  buildRecordingBaseSlug,
  extractSnippetFromPlaywrightSpec,
  getDateCategoryForCalendarDay,
  writeOriginalRecordingBackup,
} from './raw-recording-naming.js';

const dir = 'tests/raw-recordings';
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
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

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).some((a) => a === flag || a.startsWith(flag + '='));
}

// CI/CD 环境中跳过录制
const isCI =
  process.env.CI === 'true' ||
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

/**
 * Codegen 先写入固定前缀文件，结束后按 generate-raw-recording 相同规则重命名，并写入 original/。
 * - 与 generate-raw-recording 对齐的 CLI：--name / --description
 * - 兼容旧参数：--feature / --behavior / --action（映射到 name / description）
 * - 若无需智能命名与 original 备份：--no-infer-name
 */
const now = new Date();
const timestamp =
  now.getFullYear() +
  '-' +
  String(now.getMonth() + 1).padStart(2, '0') +
  '-' +
  String(now.getDate()).padStart(2, '0') +
  '_' +
  String(now.getHours()).padStart(2, '0') +
  '-' +
  String(now.getMinutes()).padStart(2, '0') +
  '-' +
  String(now.getSeconds()).padStart(2, '0');

const dateIso = timestamp.split('_')[0];
const dateCategory = getDateCategoryForCalendarDay(dateIso);
const outputDir = path.join(dir, dateCategory);

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const codegenOutputFile = path.join(outputDir, `recording-codegen_${timestamp}.spec.ts`);

const slugOpts = {
  name: getArgValue('--name') || getArgValue('--feature'),
  description: getArgValue('--description') || getArgValue('--behavior') || getArgValue('--action'),
};

const command = `npx playwright codegen ${curConfig.baseURL} --load-storage=${curConfig.storageState} -o ${codegenOutputFile}`;

console.log(`🚀 开始录制，Codegen 输出: ${codegenOutputFile}`);
console.log(`📌 环境: ${env}`);
console.log(`📌 基础URL: ${curConfig.baseURL}`);
if (!hasFlag('--no-infer-name')) {
  console.log(`📌 录制结束后将按脚本内容优化文件名（与 generate-raw-recording 一致），并保存 original/ 备份`);
}
execSync(command, { stdio: 'inherit' });

if (hasFlag('--no-infer-name')) {
  console.log(`✅ 已跳过智能命名（--no-infer-name），文件: ${codegenOutputFile}`);
  process.exit(0);
}

if (!fs.existsSync(codegenOutputFile)) {
  console.warn('⚠️  未找到录制输出文件，跳过智能命名');
  process.exit(0);
}

const recorded = fs.readFileSync(codegenOutputFile, 'utf-8');
if (!recorded.trim()) {
  console.warn('⚠️  录制文件为空，跳过智能命名');
  process.exit(0);
}

const slug = buildRecordingBaseSlug(recorded, slugOpts);
const finalBase = `${slug}_${timestamp}`;
const finalPath = path.join(outputDir, `${finalBase}.spec.ts`);

let finalSpecPath = codegenOutputFile;
if (path.basename(codegenOutputFile) !== `${finalBase}.spec.ts`) {
  if (fs.existsSync(finalPath) && path.resolve(finalPath) !== path.resolve(codegenOutputFile)) {
    console.warn(`⚠️  目标已存在，保留 Codegen 文件名: ${codegenOutputFile}`);
  } else {
    fs.renameSync(codegenOutputFile, finalPath);
    finalSpecPath = finalPath;
  }
}

const snippet = extractSnippetFromPlaywrightSpec(recorded);
writeOriginalRecordingBackup(snippet, finalSpecPath, dir);

console.log(`✅ 录制完成: ${finalSpecPath}`);
