import fs from 'fs';
import path from 'path';
import {
  flowLabel,
  flowRunsDir,
  manifestPath,
  readApiFailures,
  readFlowRunProgress,
  type ApiFailureLogEntry,
  type FlowId,
  type FlowRunManifest,
} from './flow-run-report.js';

export type FlowRunAiDebug = {
  manifest: FlowRunManifest;
  markdown: string;
};

function trimLines(s: string, max: number): string {
  return s
    .split('\n')
    .slice(0, max)
    .join('\n')
    .trim();
}

function readJsonSafe<T>(abs: string): T | null {
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function resolveFlowRunManifest(
  repoRoot: string,
  flowId: FlowId,
  runId: string,
): FlowRunManifest | null {
  const direct = readJsonSafe<FlowRunManifest>(path.join(repoRoot, manifestPath(flowId, runId)));
  if (direct) return direct;

  const histDir = path.join(repoRoot, flowRunsDir(flowId), 'history');
  if (!fs.existsSync(histDir)) return null;
  for (const name of fs.readdirSync(histDir).filter((f) => f.endsWith('.json'))) {
    const rows = readJsonSafe<FlowRunManifest[]>(path.join(histDir, name));
    if (!Array.isArray(rows)) continue;
    const hit = rows.find((r) => r.runId === runId);
    if (hit) return hit;
  }
  return null;
}

function specAbsPath(repoRoot: string, flowId: FlowId, spec: string): string {
  const normalized = String(spec || '').replace(/^\//, '');
  const rel = normalized.startsWith('tests/') ? normalized : `tests/${normalized}`;
  return path.join(repoRoot, flowId, rel);
}

function readSpecExcerpt(repoRoot: string, flowId: FlowId, spec: string, maxLines = 120): string {
  const abs = specAbsPath(repoRoot, flowId, spec);
  if (!fs.existsSync(abs)) return `（未找到 ${flowId}/${spec}）`;
  try {
    return trimLines(fs.readFileSync(abs, 'utf-8'), maxLines);
  } catch {
    return '（读取用例失败）';
  }
}

function listScreenshotSteps(repoRoot: string, manifest: FlowRunManifest): string[] {
  if (manifest.screenshotsDiscarded) return [];
  const scriptKey = manifest.scriptKey;
  const runId = manifest.runId;
  if (!scriptKey || !runId) return [];
  const runDir = path.join(repoRoot, 'screenshots', scriptKey, 'run-chromium-flow', runId);
  if (!fs.existsSync(runDir)) return [];
  return fs
    .readdirSync(runDir)
    .filter((n) => n.endsWith('.png'))
    .sort()
    .slice(0, 12);
}

function fmtResult(manifest: FlowRunManifest): string {
  const passed = manifest.passed ?? 0;
  const total = manifest.total ?? 0;
  const skipped = manifest.skipped ?? 0;
  const skipHint = skipped ? `, ${skipped} 跳过` : '';
  if (manifest.ok === false) return `失败（${passed}/${total} 通过${skipHint}）`;
  if (passed === total && total > 0) return `通过（${passed}/${total}）`;
  if (skipped === total && total > 0) return `全部跳过（${skipped}/${total}）`;
  return `未完成（${passed}/${total} 通过${skipHint}）`;
}

function formatApiFailures(entries: ApiFailureLogEntry[]): string {
  if (!entries.length) return '';
  const lines = ['### 接口报错', ''];
  for (const entry of entries) {
    for (const f of entry.failures || []) {
      lines.push(`- [${entry.testTitle || '接口监听'}] ${f.method || 'GET'} ${f.url || ''}`);
      if (f.kind) lines.push(`  - kind: ${f.kind}`);
      if (f.status != null) lines.push(`  - status: ${f.status}`);
      if (f.errorText) lines.push(`  - error: ${f.errorText}`);
      if (f.bodySummary) lines.push(`  - body: ${f.bodySummary}`);
    }
  }
  return lines.join('\n');
}

function formatPwFailures(manifest: FlowRunManifest): string {
  const items = manifest.failures || [];
  if (!items.length) return '';
  const lines = ['### Playwright 失败项', ''];
  items.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.title || '未命名用例'}`);
    if (item.message) lines.push('```', trimLines(item.message, 14), '```');
  });
  return lines.join('\n');
}

function formatProgress(repoRoot: string, flowId: FlowId, runId: string, manifest: FlowRunManifest): string {
  const scriptKey = manifest.scriptKey;
  let runDir = '';
  if (scriptKey && runId) {
    runDir = path.join(repoRoot, 'screenshots', scriptKey, 'run-chromium-flow', runId);
  }
  const progress = readFlowRunProgress(runDir, flowId, runId);
  if (!progress) return '';

  const lines = ['### 步骤进度', ''];
  if (manifest.ok !== false && !progress.error) {
    lines.push(`- 状态: 已完成（${progress.completedSteps?.length || 0} 步）`);
  } else if (progress.currentStep) {
    lines.push(
      `- 当前/卡住步骤: #${progress.currentStep.num} ${progress.currentStep.name}`,
      `- 开始于: ${progress.currentStep.startedAt}`,
    );
  }
  if (progress.pageUrl) lines.push(`- 页面 URL: ${progress.pageUrl}`);
  if (progress.error) lines.push(`- 错误: ${progress.error}`);
  if (progress.completedSteps?.length) {
    lines.push(`- 已完成 ${progress.completedSteps.length} 步:`);
    for (const s of progress.completedSteps.slice(-6)) {
      lines.push(`  - #${s.num} ${s.name}`);
    }
  }
  lines.push(`- 进度文件: \`results/flow-runs/${flowId}/${runId}/progress.json\``);
  return lines.join('\n');
}

function formatSkips(manifest: FlowRunManifest): string {
  const items = manifest.skips || [];
  if (!items.length) return '';
  const lines = ['### 跳过用例', ''];
  for (const s of items) {
    lines.push(`- ${s.title || '未命名用例'}: ${s.reason || '已跳过（未记录原因）'}`);
  }
  return lines.join('\n');
}

function artifactLines(manifest: FlowRunManifest): string[] {
  const lines: string[] = [];
  const push = (label: string, rel?: string) => {
    if (rel) lines.push(`- ${label}: \`${rel}\``);
  };
  push('Playwright 报告', manifest.playwrightReportRel);
  push('步骤回放', manifest.replayReportRel);
  push('截图对比', manifest.compareReportRel);
  push('客户报告', manifest.customerReportRel);
  push('运行汇总', manifest.summaryReportRel);
  push('接口报错日志', manifest.apiFailureLogRel);
  return lines;
}

export function buildFlowRunAiMarkdown(
  repoRoot: string,
  flowId: FlowId,
  manifest: FlowRunManifest,
): string {
  const apiFailures = readApiFailures(flowId, manifest.runId);
  const shots = listScreenshotSteps(repoRoot, manifest);
  const specExcerpt = readSpecExcerpt(repoRoot, flowId, manifest.spec || '');
  const resultText = fmtResult(manifest);
  const askLine = `请根据以下${flowLabel(flowId)}执行数据排查脚本问题（选择器、等待、测试数据或断言），并给出修改建议：`;

  const lines = [
    `## 业务流程执行排查包（给 AI）`,
    ``,
    `- 流程: ${flowLabel(flowId)}`,
    `- 标记: \`${manifest.runMarker || manifest.runId}\``,
    `- runId: \`${manifest.runId}\``,
    `- 开始: ${manifest.startedAt || '—'}`,
    `- 结束: ${manifest.finishedAt || '—'}`,
    `- 环境: ${manifest.env || 'dev'}`,
    `- 用例: \`${manifest.spec || '—'}\``,
    `- scriptKey: \`${manifest.scriptKey || '—'}\``,
    `- 结果: ${resultText}`,
    `- 耗时: ${manifest.durationSec ?? '—'}s`,
    `- exitCode: ${manifest.exitCode ?? '—'}`,
    `- Trace: ${manifest.traceMode || 'on-first-retry'}`,
  ];

  if (manifest.screenshotsDiscarded) {
    lines.push(`- 截图: 本次未全通过，截图已丢弃（保留回放）`);
  } else if (shots.length) {
    lines.push(`- 截图步骤: ${shots.join(', ')}`);
  }

  const artifacts = artifactLines(manifest);
  if (artifacts.length) {
    lines.push('', '### 关联产物', '', ...artifacts);
  }

  const pwBlock = formatPwFailures(manifest);
  const apiBlock = formatApiFailures(apiFailures);
  const progressBlock = formatProgress(repoRoot, flowId, manifest.runId, manifest);
  const skipBlock = formatSkips(manifest);
  if (pwBlock) lines.push('', pwBlock);
  if (progressBlock) lines.push('', progressBlock);
  if (apiBlock) lines.push('', apiBlock);
  if (skipBlock) lines.push('', skipBlock);

  lines.push(
    '',
    '---',
    askLine,
    '',
    '### 用例脚本（节选）',
    '```typescript',
    specExcerpt,
    '```',
    '',
    '### 建议下一步',
    '- 对照失败步骤、接口报错与回放定位卡点',
    '- 若为数据波动，固定 golden seed 或 promote 截图基线',
    '- 修改后重跑同一 env/spec，并用标记检索本次 run',
  );

  return lines.join('\n');
}

export function buildFlowRunAiDebug(
  repoRoot: string,
  flowId: FlowId,
  runId: string,
): FlowRunAiDebug | null {
  const manifest = resolveFlowRunManifest(repoRoot, flowId, runId);
  if (!manifest) return null;
  return {
    manifest,
    markdown: buildFlowRunAiMarkdown(repoRoot, flowId, manifest),
  };
}
