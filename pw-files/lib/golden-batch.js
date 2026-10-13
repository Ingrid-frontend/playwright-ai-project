const fs = require('fs');
const path = require('path');
const { parsePlaywrightResultJson, parsePlaywrightFailures, parsePlaywrightSkips } = require('./failure-report');

function parseGoldenExecution(stdout, exitCode) {
  let passed = 0, failed = 0, total = 0, skipped = 0;
  let parsedResult = null;
  let skips = [], failures = [];
  try {
    const result = parsePlaywrightResultJson(stdout);
    const stats = result?.stats;
    if (!stats || !['expected', 'unexpected', 'skipped', 'flaky'].every(
      (key) => Number.isInteger(stats[key]) && stats[key] >= 0,
    )) throw new Error('缺少有效 Playwright stats（expected/unexpected/skipped/flaky）');
    passed = stats.expected + stats.flaky;
    failed = stats.unexpected;
    skipped = stats.skipped;
    total = passed + failed + skipped;
    skips = parsePlaywrightSkips(result);
    failures = parsePlaywrightFailures(result, null, exitCode);
    parsedResult = result;
    if (total === 0) failures.push({ message: 'Playwright 未执行任何测试（total=0），请检查 grep / spec / project' });
  } catch (error) {
    passed = 0;
    failed = 0;
    total = 0;
    skipped = 0;
    skips = [];
    failures = [{ message: `Playwright 结果解析失败，无法确认有效执行: ${error instanceof Error ? error.message : String(error)}` }];
  }
  const allSkipped = skipped > 0 && passed === 0 && failed === 0 && exitCode === 0 && failures.length === 0;
  const ok = exitCode === 0 && passed > 0 && failed === 0 && failures.length === 0;
  return { ok, allSkipped, exitCode, passed, failed, total, skipped, skips, failures, parsedResult };
}

function finalizeGoldenExecution(execution, finalized) {
  const skippedOnly = execution.allSkipped;
  const ok = execution.ok && finalized.ok === true;
  const gateError = finalized.compareGateFailed ? 'Golden 对比门禁未通过'
    : finalized.uiAuditGateFailed ? 'Golden UI 审计门禁未通过'
      : finalized.apiFailureCount > 0 ? `Golden API 门禁未通过（${finalized.apiFailureCount}）`
        : 'Golden 最终门禁未通过';
  return {
    ok,
    skipped: skippedOnly,
    skippedOnly,
    exitCode: ok ? 0 : skippedOnly ? 2 : execution.exitCode || 1,
    reason: skippedOnly ? execution.skips[0]?.reason || '全部测试跳过，无有效执行' : undefined,
    error: ok || skippedOnly ? '' : execution.failures[0]?.message || gateError,
  };
}

function isExecutedPass(result) {
  return result.ok === true && !result.skipped && !result.skippedOnly && result.exitCode === 0 &&
    Number.isInteger(result.passed) && result.passed > 0 && result.failed === 0 &&
    Number.isInteger(result.total) && result.total >= result.passed;
}

function isNoDataSkip(result) {
  return Boolean(result)
    && (result.skipped || result.skippedOnly)
    && !(result.passed > 0)
    && !(result.failed > 0);
}

function goldenBatchStatus(results) {
  const skips = results.filter(isNoDataSkip);
  const passes = results.filter(isExecutedPass);
  const failed = results.filter((r) => !isExecutedPass(r) && !isNoDataSkip(r));
  const skippedOnly = results.length > 0 && failed.length === 0 && passes.length === 0 && skips.length === results.length;
  const ok = failed.length === 0 && passes.length > 0 && passes.length + skips.length === results.length;
  return { ok, exitCode: ok ? 0 : skippedOnly ? 2 : 1, skippedOnly };
}

function summarizeGoldenRounds(rows, plannedRounds) {
  const passedRounds = rows.filter((r) => r.ok && r.exitCode === 0 && r.failureType === null).length;
  const ok = Number.isInteger(plannedRounds) && plannedRounds > 0 &&
    rows.length === plannedRounds && passedRounds === plannedRounds;
  return { ok, passedRounds };
}

function goldenBatchAbs(repoRoot, flowId) {
  return path.join(repoRoot, 'results', 'flow-runs', flowId, 'last-golden-batch.json');
}

function readGoldenBatch(repoRoot, flowId) {
  const abs = goldenBatchAbs(repoRoot, flowId);
  if (!fs.existsSync(abs)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function writeGoldenBatch(repoRoot, flowId, batch) {
  const abs = goldenBatchAbs(repoRoot, flowId);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(batch, null, 2), 'utf8');
}

function summarizeGoldenBatch(batch) {
  if (!batch) return { ok: false, exitCode: 1, lines: [], skippedOnly: false };
  const lines = [];
  const ignored = batch.ignored || [];
  const results = batch.results || [];
  const passed = results.filter(isExecutedPass);
  const failed = results.filter((r) => !isExecutedPass(r) && !r.skipped && !r.skippedOnly);
  const skipped = results.filter((r) => r.skipped || r.skippedOnly);
  const status = goldenBatchStatus(results);
  const skippedOnly = status.skippedOnly;
  const ok = status.ok;
  const exitCode = status.exitCode;

  if (ignored.length) {
    for (const item of ignored) {
      lines.push(`忽略 ${item.profileId}${item.roleSlug ? ` (${item.roleSlug})` : ''}: ${item.reason || '无有效登录态'}`);
    }
  }
  for (const item of passed) {
    lines.push(
      `通过 ${item.profileId}${item.roleSlug ? ` (${item.roleSlug})` : ''}: ${item.passed ?? '?'}/${item.total ?? '?'}`,
    );
  }
  for (const item of failed) {
    lines.push(
      `失败 ${item.profileId}${item.roleSlug ? ` (${item.roleSlug})` : ''}: ${item.error || `${item.passed ?? 0}/${item.total ?? '?'}`}`,
    );
  }
  for (const item of skipped) {
    lines.push(
      `跳过 ${item.profileId}${item.roleSlug ? ` (${item.roleSlug})` : ''}: ${item.reason || '无数据'}`,
    );
  }

  let headline;
  if (skippedOnly) {
    headline = `Golden 批次无效：${skipped.length} 个角色全被跳过（无单据可跑）${ignored.length ? `，${ignored.length} 个忽略` : ''}`;
  } else if (ok) {
    const skipHint = skipped.length ? `，${skipped.length} 个无数据跳过` : '';
    headline = `Golden 批次完成：${passed.length} 个角色通过${skipHint}${ignored.length ? `，${ignored.length} 个忽略` : ''}`;
  } else if (failed.length && passed.length) {
    headline = `Golden 批次部分失败：${passed.length} 通过，${failed.length} 失败${ignored.length ? `，${ignored.length} 忽略` : ''}`;
  } else if (!failed.length) {
    headline = `Golden 批次跳过：${skipped.length} 个角色无数据`;
  } else {
    headline = `Golden 批次失败：${failed.length} 个角色未通过`;
  }

  return { ok, exitCode, headline, lines, skippedOnly };
}

module.exports = {
  parseGoldenExecution,
  finalizeGoldenExecution,
  goldenBatchStatus,
  summarizeGoldenRounds,
  goldenBatchAbs,
  readGoldenBatch,
  writeGoldenBatch,
  summarizeGoldenBatch,
};
