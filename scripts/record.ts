import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env, curConfig } from '../playwright.config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dir = 'tests/raw-recordings';
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const storagePath = curConfig.storageState;
if (!fs.existsSync(storagePath) || fs.statSync(storagePath).size <= 10) {
  console.log('🔐 登录状态文件不存在或无效，正在执行登录...');
  execSync('npx playwright test src/setup/login.setup.ts', { stdio: 'inherit' });
}

const now = new Date();
const timestamp = now.getFullYear() + '-' + 
  String(now.getMonth() + 1).padStart(2, '0') + '-' + 
  String(now.getDate()).padStart(2, '0') + '_' + 
  String(now.getHours()).padStart(2, '0') + '-' + 
  String(now.getMinutes()).padStart(2, '0') + '-' + 
  String(now.getSeconds()).padStart(2, '0');
const outputFile = path.join(dir, `${timestamp}.spec.ts`);

const command = `npx playwright codegen ${curConfig.baseURL} --load-storage=${curConfig.storageState} -o ${outputFile}`;

console.log(`🚀 开始录制，完成后将保存至: ${outputFile}`);
console.log(`📌 环境: ${env}`);
console.log(`📌 基础URL: ${curConfig.baseURL}`);
execSync(command, { stdio: 'inherit' });
