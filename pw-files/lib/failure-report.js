const { logLine, errText, stripAnsi } = require('./ws-safe');

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

function parsePlaywrightResultJson(stdout) {
  const text = stripAnsi(stdout).trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error('Playwright JSON 输出解析失败');
  }
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

function braceDelta(text) {
  let n = 0;
  for (const ch of text) {
    if (ch === '{') n += 1;
    else if (ch === '}') n -= 1;
  }
  return n;
}

function isJsonReportStart(line) {
  const t = String(line || '').trim();
  return (
    t === '{' ||
    (t.startsWith('{') && (t.includes('"config"') || t.includes('"suites"')))
  );
}

const JSON_KEY_LINE =
  /^"(config|suites|stats|errors|id|file|line|column|duration|expected|skipped|unexpected|flaky|startTime|title|status|results|specs|stdout|stderr|attachments|location|message|outcome|retry|workerIndex|parallelIndex|projectName|projects|metadata|version|rootDir|globalSetup|globalTeardown)"\s*:/;

/** 过滤 Playwright 原始报错堆栈 / JSON 报告，避免 Job/Studio 日志刷屏 */
function filterPlaywrightLogLine(line) {
  const t = String(line || '').trim();
  if (!t) return true;
  if (/^\[\d+[ABK]$/.test(t)) return true;
  if (/^Retry #\d+/i.test(t)) return true;
  if (/^attachment #\d+/i.test(t)) return true;
  if (/^Error Context:/i.test(t)) return true;
  if (/^Usage:/i.test(t)) return true;
  if (/^npx playwright show-trace/i.test(t)) return true;
  if (/^─+$/.test(t)) return true;
  if (/^Call log:/i.test(t)) return true;
  if (/^Expected:/i.test(t)) return true;
  if (/^Timeout:/i.test(t)) return true;
  if (/^Locator:/i.test(t)) return true;
  if (/^Error:/i.test(t)) return true;
  if (/^expect\(locator\)/i.test(t)) return true;
  if (/^\d+\)\s*\[/.test(t)) return true;
  if (/^\[(chromium|firefox|webkit)\]/i.test(t)) return true;
  if (/›/.test(t) && /\.spec\.(?:ts|js)/.test(t)) return true;
  if (/^\d+\s*(passed|failed|skipped|flaky)\b/i.test(t)) return true;
  if (/^\d+\s*\|/.test(t)) return true;
  if (/^at .+\(.+:\d+/.test(t)) return true;
  if (/^at async /.test(t)) return true;
  if (/^>\s*\d+\s*\|/.test(t)) return true;
  if (/^\|\s*\^/.test(t)) return true;
  if (JSON_KEY_LINE.test(t)) return true;
  if (/^[\]},\[]+[,]?\s*$/.test(t)) return true;
  if (/^(true|false|null|\d+(\.\d+)?),?\s*$/.test(t)) return true;
  if (t.startsWith('{') || t.startsWith('}') || t.startsWith('[')) return true;
  return false;
}

function filterPlaywrightLogText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !filterPlaywrightLogLine(line));
}

function logConcisePlaywrightFailures(prefix, failures, opts = {}) {
  const limit = opts.limit ?? 3;
  const ws = opts.ws ?? null;
  const emit = (text, level) => {
    if (ws) logLine(ws, text, level);
    else if (level === 'err') console.error(text);
    else if (level === 'warn') console.warn(text);
    else console.log(text);
  };
  if (!failures?.length) return;
  for (const [i, item] of failures.entries()) {
    if (i >= limit) break;
    const msg = String(item.message || '').split('\n').find((l) => l.trim()) || '未知错误';
    const title = item.title || '用例失败';
    emit(`${prefix}${title} — ${msg.trim()}`, 'err');
  }
  if (failures.length > limit) {
    emit(`${prefix}… 另有 ${failures.length - limit} 条，见 Playwright 报告`, 'warn');
  }
}

function feedPlaywrightLogLines(raw, state, emitLine) {
  const t = stripAnsi(raw);
  if (!t.trim()) return;
  for (const line of t.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!state.inJson && isJsonReportStart(trimmed)) {
      state.inJson = true;
      state.depth = braceDelta(trimmed);
      if (state.depth <= 0) state.inJson = false;
      continue;
    }
    if (state.inJson) {
      state.depth += braceDelta(trimmed);
      if (state.depth <= 0) state.inJson = false;
      continue;
    }

    if (filterPlaywrightLogLine(line)) continue;
    emitLine(line.trimEnd());
  }
}

/** stdout/stderr 共用：抑制 JSON 报告，过滤 Playwright 原始报错 */
function createPlaywrightLogSink(opts = {}) {
  const ws = opts.ws ?? null;
  const level = opts.level ?? 'dim';
  const onLine =
    opts.onLine ??
    ((line, lv) => {
      logLine(ws, line, lv ?? level);
    });
  const state = { inJson: false, depth: 0 };

  return {
    feed(raw) {
      feedPlaywrightLogLines(raw, state, (line) => onLine(line, level));
    },
  };
}

function createPlaywrightLogStreamer(ws) {
  return createPlaywrightLogSink({ ws }).feed;
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
  parsePlaywrightResultJson,
  logPlaywrightFailureReport,
  filterPlaywrightLogLine,
  filterPlaywrightLogText,
  logConcisePlaywrightFailures,
  createPlaywrightLogSink,
  streamPlaywrightProcLog: createPlaywrightLogStreamer,
  createPlaywrightLogStreamer,
  headedFailurePlaceholder,
};
