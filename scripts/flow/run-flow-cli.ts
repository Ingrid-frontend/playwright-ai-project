#!/usr/bin/env tsx
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import dotenv from 'dotenv';
import type { FlowId } from '../../src/utils/flow-run-report.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const require = createRequire(import.meta.url);
const { finalizeFlowRun, detectPipeline } = require('../../pw-files/lib/flow-run-common.js');
const { parsePlaywrightResultJson } = require('../../pw-files/lib/failure-report.js');

const FLOW_META: Record<
  FlowId,
  { configRel: string; label: string; reportDir: string }
> = {
  'request-flow': {
    configRel: 'request-flow/playwright.config.ts',
    label: '申请单流程',
    reportDir: 'request-flow/playwright-report',
  },
  'approval-flow': {
    configRel: 'approval-flow/playwright.config.ts',
    label: '审批流程',
    reportDir: 'approval-flow/playwright-report',
  },
};

type Args = {
  flowId: FlowId;
  spec: string;
  env: string;
  chatId: string;
  messageId: string;
};

function parseArgs(argv: string[]): Args {
  let flowId: FlowId = 'request-flow';
  let spec = 'request/full-flow.spec.ts';
  let env = process.env.PLAYWRIGHT_ENV?.trim() || 'uat';
  let chatId = '';
  let messageId = '';

  for (const arg of argv) {
    if (arg.startsWith('--flow=')) flowId = arg.slice(7) as FlowId;
    else if (arg.startsWith('--spec=')) spec = arg.slice(7);
    else if (arg.startsWith('--env=')) env = arg.slice(6);
    else if (arg.startsWith('--chat-id=')) chatId = arg.slice(10);
    else if (arg.startsWith('--message-id=')) messageId = arg.slice(13);
  }

  if (flowId === 'approval-flow' && spec === 'request/full-flow.spec.ts') {
    spec = 'approval/full-flow.spec.ts';
  }

  return { flowId, spec, env, chatId, messageId };
}

function resolveStorage(repoRoot: string, envId: string): string {
  for (const id of [envId, 'dev', 'uat', 'stage']) {
    const p = path.join(repoRoot, 'storage/loginState', `${id}.json`);
    if (fs.existsSync(p)) return p;
  }
  return '';
}

function runNpmScript(script: string, extraArgs: string[] = []): void {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  spawnSync(npm, ['run', script, '--', ...extraArgs], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const meta = FLOW_META[args.flowId];
  if (!meta) {
    console.error(`未知 flow: ${args.flowId}`);
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const configAbs = path.join(repoRoot, meta.configRel);
  if (!fs.existsSync(configAbs)) {
    console.error(`未找到 ${meta.configRel}`);
    process.exit(1);
  }

  const storage = resolveStorage(repoRoot, args.env);
  if (!storage) {
    console.error(`缺少登录态 storage/loginState/${args.env}.json`);
    process.exit(1);
  }

  const startTime = Date.now();
  const startedAt = new Date(startTime).toISOString();
  const runId = startedAt.replace(/[:.]/g, '-');

  const spawnEnv = { ...process.env };
  spawnEnv.PLAYWRIGHT_ENV = args.env;
  spawnEnv.BASE_URL = spawnEnv.BASE_URL || '';
  spawnEnv.STORAGE_STATE = storage;
  spawnEnv.FLOW_RUN_ID = runId;
  spawnEnv.FLOW_RUN_STARTED_AT = startedAt;
  spawnEnv.FLOW_SPEC = args.spec;
  spawnEnv.FLOW_RUN_MODE = 'headless';

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const pwArgs = ['playwright', 'test', '--config', meta.configRel, args.spec, '--reporter=json'];

  console.log(`[flow:run] ${meta.label} · env=${args.env} · ${args.spec}`);

  const proc = spawnSync(npx, pwArgs, {
    cwd: repoRoot,
    env: spawnEnv,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  const stdout = proc.stdout || '';
  const exitCode = proc.status ?? 1;
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const specRelative = path.join(args.flowId, 'tests', args.spec).replace(/\\/g, '/');

  let passed = 0;
  let failed = 0;
  let total = 0;
  let failures: Array<{ title?: string; message?: string }> = [];

  try {
    const result = parsePlaywrightResultJson(stdout);
    const s = result.stats || {};
    const expected = Number(s.expected) || 0;
    const unexpected = Number(s.unexpected) || 0;
    const skipped = Number(s.skipped) || 0;
    const flaky = Number(s.flaky) || 0;
    passed = expected + flaky;
    failed = unexpected;
    total = expected + unexpected + skipped + flaky;
    if (exitCode !== 0 || failed > 0) {
      failures = (result.suites || []).flatMap((suite: { specs?: Array<{ title?: string; tests?: Array<{ results?: Array<{ error?: { message?: string } }> }> }> }) =>
        (suite.specs || []).flatMap((spec) =>
          (spec.tests || []).flatMap((test) =>
            (test.results || [])
              .filter((r) => r.error)
              .map((r) => ({ title: spec.title, message: r.error?.message || '' })),
          ),
        ),
      );
    }
  } catch {
    passed = exitCode === 0 ? 1 : 0;
    failed = exitCode === 0 ? 0 : 1;
    total = 1;
  }

  const ok = exitCode === 0 && failed === 0;
  const reportRel = `${meta.reportDir}/index.html`;

  finalizeFlowRun(repoRoot, args.flowId, meta.label, {
    ok,
    exitCode,
    cancelled: false,
    mode: 'headless',
    spec: args.spec,
    grep: '',
    env: args.env,
    passed,
    failed,
    total,
    duration,
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    failures,
    specRelative,
    runMode: 'headless',
    playwrightReportDir: meta.reportDir,
    reportHint: reportRel,
    pipeline: detectPipeline(args.spec, {}),
  });

  runNpmScript('feishu:flow-weekly-doc', [`--flow=${args.flowId}`]);

  const notifyArgs = [`--flow=${args.flowId}`];
  if (args.chatId) notifyArgs.push(`--chat-id=${args.chatId}`);
  runNpmScript('feishu:flow-notify', notifyArgs);

  process.exit(ok ? 0 : 1);
}

main();
