#!/usr/bin/env tsx
/** 首次初始化：Node / 浏览器 / 账号配置检查 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = process.cwd();

function ok(msg: string): void {
  console.log(`✅ ${msg}`);
}

function warn(msg: string): void {
  console.log(`⚠️  ${msg}`);
}

function fail(msg: string): void {
  console.log(`❌ ${msg}`);
}

function main(): void {
  console.log('🔧 Playwright AI 项目初始化检查\n');

  const nodeMajor = Number(process.version.slice(1).split('.')[0]);
  if (nodeMajor >= 18) ok(`Node ${process.version}`);
  else fail(`需要 Node 18+，当前 ${process.version}`);

  if (fs.existsSync(path.join(root, 'node_modules'))) ok('依赖已安装 (node_modules)');
  else {
    warn('未安装依赖，请执行: npm install');
  }

  const accountsExample = path.join(root, 'datasource/accounts.json.example');
  const accounts = path.join(root, 'datasource/accounts.json');
  if (fs.existsSync(accounts)) ok('datasource/accounts.json 已存在');
  else if (fs.existsSync(accountsExample)) {
    warn('未找到 accounts.json，可复制: cp datasource/accounts.json.example datasource/accounts.json');
  } else warn('缺少账号配置模板');

  if (process.env.TEST_USERNAME && process.env.TEST_PASSWORD) {
    ok('环境变量 TEST_USERNAME / TEST_PASSWORD 已配置');
  }

  const envExample = path.join(root, '.env.example');
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) ok('.env 已存在');
  else if (fs.existsSync(envExample)) warn('可选: cp .env.example .env');

  try {
    execSync('npx playwright --version', { stdio: 'pipe', cwd: root });
    ok('Playwright CLI 可用');
  } catch {
    warn('Playwright 未就绪，请执行: npx playwright install');
  }

  console.log('\n📋 常用命令（也可 npm run cli -- --help）');
  console.log('  npm run studio          Studio 录制/运行');
  console.log('  npm run record          CLI Codegen 录制');
  console.log('  npm run test:pipeline   预处理 + 优化');
  console.log('  npm run test:ci         Headless 回归 + 截图 gate');
  console.log('  npm run screenshot-report  UI 对比报告');
}

main();
