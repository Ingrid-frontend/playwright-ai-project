import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { buildNativeScriptEnv, requireScriptReview } from '../ai/run-playwright-script.js';

const code = "await page.getByRole('heading').isVisible();\n";
const hash = createHash('sha256').update(code).digest('hex');
assert.throws(() => requireScriptReview(code), /未经审核/);
assert.throws(() => requireScriptReview(code, 'invalid'), /未经审核/);
assert.doesNotThrow(() => requireScriptReview(code, hash));
assert.throws(() => requireScriptReview(`${code}\n`, hash), /内容已变更/);

const source = {
  PATH: '/usr/bin',
  HOME: '/offline/home',
  TMPDIR: '/offline/tmp',
  PLAYWRIGHT_BROWSERS_PATH: '/offline/browsers',
  LLM_API_KEY: 'not-a-real-secret',
  OPENAI_API_KEY: 'not-a-real-secret',
  FEISHU_APP_SECRET: 'not-a-real-secret',
  TEST_PASSWORD: 'not-a-real-secret',
  NODE_OPTIONS: '--require=/offline/untrusted.js',
  NODE_PATH: '/offline/untrusted',
};
assert.deepEqual(buildNativeScriptEnv(source), {
  PATH: source.PATH,
  HOME: source.HOME,
  TMPDIR: source.TMPDIR,
  PLAYWRIGHT_BROWSERS_PATH: source.PLAYWRIGHT_BROWSERS_PATH,
});
assert.deepEqual(buildNativeScriptEnv({}), {});
assert.equal(source.NODE_OPTIONS, '--require=/offline/untrusted.js');

const require = createRequire(import.meta.url);
const { runEgoNlFlow } = require('../../pw-files/lib/ego-nl-run.js');
const { runFlowReplay } = require('../../pw-files/lib/flow-replay-list.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-review-'));
const calls: string[][] = [];
const events: Array<{ type: string; seq?: number; sha256?: string; ok?: boolean }> = [];
const ws = { readyState: 1, send: (raw: string) => events.push(JSON.parse(raw)) };
let writeResult = false;
const deps = {
  resolveRepoRoot: () => root,
  buildRepoSpawnEnv: () => ({}),
  getSessionPlaywrightEnv: () => 'stage9084',
  getSessionAccountProfile: () => 'offline',
  spawn: (_bin: string, args: string[]) => {
    calls.push(args);
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    const output = args.find((arg) => arg.startsWith('--out='))!.slice(6);
    if (args[0].endsWith('generate-playwright-script.ts')) {
      fs.writeFileSync(output, code);
    } else {
      assert.equal(args[0], 'scripts/ai/run-playwright-script.ts');
      assert.ok(args.includes(`--reviewed-sha256=${hash}`));
      const scriptPath = args.find((arg) => arg.startsWith('--script='))!.slice(9);
      assert.equal(fs.readFileSync(scriptPath, 'utf-8'), code);
      if (writeResult) {
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true }));
      }
    }
    queueMicrotask(() => proc.emit('close', 0));
    return proc;
  },
};
const runCount = () => calls.filter((args) => args[0].endsWith('/run-playwright-script.ts')).length;
try {
  fs.writeFileSync(path.join(root, 'playwright.config.ts'), '');
  const session = { egoAuditCancelled: false, egoAuditSeq: 0, nativeScriptReview: null as { scriptPath: string } | null };
  const generate = () => runEgoNlFlow(ws, session, { engine: 'pw', caseDescription: 'offline', audit: false }, deps);
  const approve = () => runEgoNlFlow(ws, session, { seq: session.egoAuditSeq, reviewedSha256: hash }, deps);
  await generate();
  assert.equal(runCount(), 0);
  assert.equal(events.slice().reverse().find((event) => event.type === 'ego:nl-run:script')?.sha256, hash);
  await runEgoNlFlow(ws, session, { seq: session.egoAuditSeq, reviewedSha256: 'invalid' }, deps);
  assert.equal(runCount(), 0);
  fs.appendFileSync(session.nativeScriptReview!.scriptPath, '\n');
  await approve();
  assert.equal(runCount(), 0);
  await generate();
  session.egoAuditCancelled = true;
  await approve();
  assert.equal(runCount(), 0);
  await generate();
  await approve();
  assert.equal(runCount(), 1);
  assert.equal(events.slice().reverse().find((event) => event.type === 'ego:nl-run:done')?.ok, false);
  await approve();
  assert.equal(runCount(), 1);
  writeResult = true;
  await generate();
  await approve();
  assert.equal(runCount(), 2);
  assert.equal(events.slice().reverse().find((event) => event.type === 'ego:nl-run:done')?.ok, true);

  const outRel = 'results/ego-studio/review-fixture';
  fs.mkdirSync(path.join(root, outRel), { recursive: true });
  const replayPath = path.join(root, outRel, 'generated.ts');
  fs.writeFileSync(replayPath, code);
  const replaySession = { replayRunSeq: 0 };
  const previewReplay = () => runFlowReplay(ws, replaySession, { outRel }, deps);
  const approveReplay = () => runFlowReplay(ws, replaySession, { outRel, seq: replaySession.replayRunSeq, reviewedSha256: hash }, deps);
  await previewReplay();
  assert.equal(runCount(), 2);
  fs.appendFileSync(replayPath, '\n');
  await approveReplay();
  assert.equal(runCount(), 2);
  fs.writeFileSync(replayPath, code);
  await approveReplay();
  assert.equal(runCount(), 2, 'reverting a changed file cannot revive a consumed review');
  await previewReplay();
  await runFlowReplay(ws, replaySession, { reviewCancelled: true, seq: replaySession.replayRunSeq }, deps);
  await approveReplay();
  assert.equal(runCount(), 2);
  await previewReplay();
  await approveReplay();
  assert.equal(runCount(), 3);
  assert.equal(events.slice().reverse().find((event) => event.type === 'replay:run:done')?.ok, true);
  await approveReplay();
  assert.equal(runCount(), 3);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('native script review and environment verification passed');
