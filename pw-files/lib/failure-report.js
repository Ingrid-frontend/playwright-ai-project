const { logLine, errText } = require('./ws-safe');

function findLastFailedStep(steps) {
  if (!Array.isArray(steps)) return null;
  let hit = null;
  for (const s of steps) {
    if (s.error) hit = s;
    const inner = findLastFailedStep(s.steps);
    if (inner) hit = inner;
  }
  return hit;
}

/** 从 Playwright JSON 报告提取结构化失败列表（不写日志） */
function parsePlaywrightFailures(result, session, exitCode) {
  const failures = [];

  const pushFailure = (item) => {
    failures.push(item);
  };

  function walkSuites(suites, suitePath) {
    for (const suite of suites || []) {
      const pathLabel = suitePath
        ? `${suitePath} › ${suite.title || suite.file || ''}`
        : (suite.title || suite.file || '套件');
      for (const spec of suite.specs || []) {
        const specTitle = spec.title || '未命名用例';
        const loc = spec.file != null
          ? `${spec.file}${spec.line ? `:${spec.line}` : ''}`
          : (suite.file || session?.tmpDir || '');

        for (const test of spec.tests || []) {
          const testStatus = test.status;
          const results = test.results || [];
          const failedResults = results.filter((r) =>
            r.status === 'failed' || r.status === 'timedOut' || r.status === 'interrupted',
          );

          if (spec.ok !== false && testStatus !== 'unexpected' && failedResults.length === 0) continue;

          for (const r of failedResults.length ? failedResults : results.slice(-1)) {
            const msg = errText(r.error) || errText(r.errors?.[0]);
            if (!msg && spec.ok !== false) continue;

            const failedStep = findLastFailedStep(r.steps);
            const allSteps = [];
            const collectSteps = (steps, depth = 0) => {
              for (const s of steps || []) {
                allSteps.push(`${'  '.repeat(depth)}${s.title} (${s.duration || 0}ms)`);
                collectSteps(s.steps, depth + 1);
              }
            };
            collectSteps(r.steps);

            let hint = '';
            if (/locator\.\w+:\s*Timeout|waiting for locator/i.test(msg)) {
              hint = '单步操作超时：在限定时间内未找到/未点到目标元素。常见原因：iframe 未加载完、文案与录制时不一致（若未设 locale，页面可能是英文）。执行测试已默认 locale=zh-CN；仍失败可在点击前 waitFor iframe，或 export PW_ACTION_TIMEOUT=60000。';
            } else if (/Test timeout of/i.test(msg)) {
              hint = '整条用例总超时（默认 120s）。可 export PW_TEST_TIMEOUT=180000；并检查脚本是否含过多 waitForTimeout，可再点 AI 优化移除硬等待。';
            } else if (/timeout.*exceeded/i.test(msg)) {
              hint = '执行超时。请根据上方 Call log 查看卡在哪一步，并酌情调整 PW_TEST_TIMEOUT / PW_ACTION_TIMEOUT。';
            } else if (/net::|ERR_|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
              hint = '网络或目标 URL 无法访问，请检查录制脚本里的地址与本机网络。';
            } else if (/locator|selector|not found|strict mode/i.test(msg)) {
              hint = '元素定位失败，页面结构可能已变，建议重新录制或调整选择器。';
            }

            pushFailure({
              title: `${pathLabel} › ${specTitle}`,
              location: loc,
              status: r.status || testStatus,
              durationMs: r.duration,
              lastStep: failedStep?.title || (allSteps.length ? allSteps[allSteps.length - 1] : null),
              message: msg,
              snippet: r.error?.snippet || spec.tests?.[0]?.results?.[0]?.error?.snippet,
              hint,
            });
          }
        }
      }
      walkSuites(suite.suites, pathLabel);
    }
  }

  walkSuites(result.suites, '');

  if (Array.isArray(result.errors)) {
    for (const err of result.errors) {
      const msg = errText(err);
      if (!msg) continue;
      if (failures.some((f) => f.message === msg)) continue;
      pushFailure({
        title: '运行前错误（未执行到用例）',
        location: err.location?.file
          ? `${err.location.file}:${err.location.line || 1}`
          : '',
        status: 'error',
        message: msg,
        hint: /No tests found/i.test(msg)
          ? '未找到测试文件，请确认「优化脚本」或「录制脚本」为合法 Playwright 代码。'
          : '',
      });
    }
  }

  if (failures.length === 0 && exitCode !== 0) {
    pushFailure({
      title: '执行失败（未解析到详细项）',
      location: '',
      status: 'error',
      message: `进程退出码 ${exitCode}`,
      hint: '请展开控制台 Playwright 原始输出，或改用无头模式以生成 JSON 失败详情。',
    });
  }

  return failures;
}

/** 从 Playwright JSON 报告提取失败信息并写入控制台日志 */
function logPlaywrightFailureReport(ws, result, session, exitCode) {
  const failures = parsePlaywrightFailures(result, session, exitCode);
  let blockIndex = 0;

  const logFailure = (item) => {
    blockIndex += 1;
    logLine(ws, `──── 失败 ${blockIndex} ────`, 'err');
    if (item.title) logLine(ws, `用例: ${item.title}`, 'err');
    if (item.location) logLine(ws, `位置: ${item.location}`, 'err');
    if (item.status) logLine(ws, `状态: ${item.status}`, 'err');
    if (item.durationMs != null) logLine(ws, `耗时: ${(item.durationMs / 1000).toFixed(1)}s`, 'dim');
    if (item.lastStep) logLine(ws, `卡住步骤: ${item.lastStep}`, 'warn');
    if (item.message) {
      const lines = item.message.split('\n').slice(0, 12);
      lines.forEach((line) => {
        if (line.trim()) logLine(ws, line.trim(), 'err');
      });
    }
    if (item.snippet) {
      item.snippet.split('\n').slice(0, 8).forEach((line) => logLine(ws, `  ${line}`, 'dim'));
    }
    if (item.hint) logLine(ws, `提示: ${item.hint}`, 'warn');
  };

  for (const item of failures) logFailure(item);

  if (failures.length === 0 && exitCode !== 0) {
    logLine(ws, '未解析到详细失败项，请展开上方 Playwright 原始输出', 'warn');
    if (session?.tmpDir) {
      logLine(ws, `工作目录: ${session.tmpDir}`, 'dim');
      logLine(ws, `可本地调试: cd ${session.tmpDir} && npx playwright test --config playwright.config.cjs`, 'dim');
    }
  } else if (failures.length > 0) {
    logLine(ws, `共 ${failures.length} 条失败记录（见上方「失败 N」）`, 'warn');
  }

  if (session) session.lastRunFailures = failures;
  return failures;
}

function headedFailurePlaceholder(specRel) {
  return [
    {
      title: specRel || '用例执行',
      location: specRel || '',
      status: 'headed',
      message: '有界面模式未生成 JSON 结构化失败报告。',
      hint: '请在浏览器窗口查看失败步骤；如需复制结构化信息，请使用无头模式重新执行。',
    },
  ];
}

module.exports = {
  findLastFailedStep,
  parsePlaywrightFailures,
  logPlaywrightFailureReport,
  headedFailurePlaceholder,
};
