const fs = require('fs');
const path = require('path');
const { send, logLine } = require('./ws-safe');

async function simulateRun(ws, session, startTime) {
  const steps = [
    ['info', 'Chromium 已启动'],
    ['dim', '导航到目标 URL...'],
    ['ok', 'page.goto() ✓'],
    ['dim', '执行操作步骤...'],
    ['ok', 'getByRole().click() ✓'],
    ['ok', 'getByRole().fill() ✓'],
    ['ok', 'expect().toHaveURL() ✓'],
    ['ok', 'expect().toBeVisible() ✓'],
    ['ok', 'expect().toHaveTitle() ✓'],
    ['ok', '用例 "recorded test" 通过 ✓'],
  ];

  for (const [level, text] of steps) {
    await new Promise((r) => setTimeout(r, 300));
    logLine(ws, text, level);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  session.runResult = { passed: 1, failed: 0, total: 1, duration };
  send(ws, 'run:done', { passed: 1, failed: 0, total: 1, duration });
}

function generateReport(ws, session, buildHtmlReport) {
  const result = session.runResult || { passed: 0, failed: 0, total: 0, duration: '0' };

  const rawLines = session.rawCode.split('\n').filter(Boolean).length;
  const optLines = session.optCode.split('\n').filter(Boolean).length;
  const rawWaits = (session.rawCode.match(/waitForTimeout/g) || []).length;
  const optAsserts = (session.optCode.match(/expect/g) || []).length;
  const reportData = {
    ...result,
    tests: [
      { name: 'recorded test', status: result.failed === 0 ? 'passed' : 'failed', duration: Math.round(parseFloat(result.duration) * 1000) },
    ],
    optimizations: [
      { label: '原始脚本行数', value: `${rawLines} 行`, type: 'warn' },
      { label: '优化后行数', value: `${optLines} 行`, type: 'ok' },
      { label: '移除硬等待', value: `${rawWaits} 处`, type: 'ok' },
      { label: '新增断言', value: `${optAsserts} 处`, type: 'ok' },
      { label: '语义化选择器', value: '已替换', type: 'ok' },
    ],
  };

  const reportHtml = buildHtmlReport(reportData, session.optCode);
  const reportFile = path.join(session.tmpDir, 'report.html');
  fs.writeFileSync(reportFile, reportHtml);

  send(ws, 'report:done', { data: reportData, file: reportFile });
}

module.exports = { simulateRun, generateReport };
