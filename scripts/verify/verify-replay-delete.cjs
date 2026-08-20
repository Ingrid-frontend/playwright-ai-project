#!/usr/bin/env node
/**
 * 流程回放批量删除校验（含关联 screenshots/intent run 清理）
 *   node scripts/verify/verify-replay-delete.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { deleteFlowReplays, allowedReplayRel } = require('../../pw-files/lib/flow-replay-list');

function main() {
  assert.strictEqual(allowedReplayRel('results/intent-runs/a'), 'results/intent-runs/a');
  assert.strictEqual(allowedReplayRel('../etc/passwd'), '');
  assert.strictEqual(allowedReplayRel('results/other/x'), '');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-del-'));
  const keep = path.join(tmp, 'results/intent-runs/keep-me');
  const drop = path.join(tmp, 'results/ego-studio/drop-me');
  const shotRun = path.join(
    tmp,
    'screenshots/intent/dev/demo/run-chromium-optimized/2026-08-20-08-00-00',
  );
  fs.mkdirSync(keep, { recursive: true });
  fs.mkdirSync(drop, { recursive: true });
  fs.mkdirSync(shotRun, { recursive: true });
  fs.writeFileSync(path.join(keep, 'flow.html'), 'ok');
  fs.writeFileSync(path.join(drop, 'flow.html'), 'ok');
  fs.writeFileSync(path.join(shotRun, 'step-01.png'), 'png');
  fs.writeFileSync(
    path.join(drop, 'result.json'),
    JSON.stringify({
      screenshotDir: path.join(tmp, 'screenshots/intent/dev/demo/run-chromium-optimized/2026-08-20-08-00-00'),
    }),
  );
  fs.writeFileSync(
    path.join(drop, 'screenshots-path.txt'),
    'screenshots/intent/dev/demo/run-chromium-optimized/2026-08-20-08-00-00\n',
  );

  const bad = deleteFlowReplays(tmp, ['results/intent-runs']);
  assert.strictEqual(bad.deleted.length, 0, 'must not delete shallow path');

  const result = deleteFlowReplays(tmp, [
    'results/ego-studio/drop-me',
    'results/intent-runs/missing',
    '../evil',
  ]);
  assert.deepStrictEqual(result.deleted, ['results/ego-studio/drop-me']);
  assert.ok(!fs.existsSync(drop));
  assert.ok(fs.existsSync(keep));
  assert.ok(!fs.existsSync(shotRun), 'linked screenshot run must be removed');
  assert.ok(
    (result.deletedScreenshots || []).some((p) =>
      p.includes('screenshots/intent/dev/demo/run-chromium-optimized/2026-08-20-08-00-00'),
    ),
  );
  assert.ok(result.skipped.length >= 2);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('verify-replay-delete: ok');
}

main();
