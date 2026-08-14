const fs = require('fs');
const path = require('path');

function getRepoPlaywrightCli(repoRoot) {
  const p = path.join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js');
  return fs.existsSync(p) ? p : null;
}

function assertAllowedSavePath(repoRoot, relativePath) {
  const norm = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (norm.includes('..') || norm.split('/').some((s) => s === '..')) {
    throw new Error('路径非法：禁止 ..');
  }
  if (!norm.startsWith('tests/raw-recordings/original/')) {
    throw new Error('仅允许写入 tests/raw-recordings/original/ 下');
  }
  const abs = path.resolve(repoRoot, norm);
  const base = path.resolve(repoRoot, 'tests', 'raw-recordings', 'original');
  if (!abs.startsWith(base + path.sep) && abs !== base) {
    throw new Error('解析路径超出允许目录');
  }
  return abs;
}

function assertAllowedOptimizedSpec(repoRoot, relativePath) {
  const norm = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (norm.includes('..')) throw new Error('路径非法');
  if (!norm.startsWith('tests/optimized/')) {
    throw new Error('仅允许执行 tests/optimized/ 下的用例');
  }
  const abs = path.resolve(repoRoot, norm);
  const base = path.resolve(repoRoot, 'tests', 'optimized');
  if (!abs.startsWith(base + path.sep) && abs !== base) {
    throw new Error('解析路径超出 tests/optimized');
  }
  if (!abs.endsWith('.spec.ts')) throw new Error('须为 .spec.ts');
  return abs;
}

module.exports = {
  getRepoPlaywrightCli,
  assertAllowedSavePath,
  assertAllowedOptimizedSpec,
};
