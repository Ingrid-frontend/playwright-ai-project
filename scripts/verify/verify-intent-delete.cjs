#!/usr/bin/env node
/**
 * YAML 用例批量删除校验
 *   node scripts/verify/verify-intent-delete.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { deleteIntentDefinitions } = require('../../pw-files/lib/intent-run');

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-del-'));
  const defDir = path.join(tmp, 'tests/definitions');
  fs.mkdirSync(defDir, { recursive: true });
  fs.writeFileSync(path.join(defDir, 'keep.yaml'), 'name: keep\nsteps: [{action: wait}]\n');
  fs.writeFileSync(path.join(defDir, 'drop.yaml'), 'name: drop\nsteps: [{action: wait}]\n');

  const bad = deleteIntentDefinitions(tmp, ['tests/definitions']);
  assert.strictEqual(bad.deleted.length, 0);

  const result = deleteIntentDefinitions(tmp, [
    'tests/definitions/drop.yaml',
    'results/intent-studio/x.yaml',
    'tests/definitions/missing.yaml',
    'drop.yaml',
  ]);
  // 'drop.yaml' without prefix becomes tests/definitions/drop.yaml but already deleted
  assert.ok(result.deleted.includes('tests/definitions/drop.yaml'));
  assert.ok(!fs.existsSync(path.join(defDir, 'drop.yaml')));
  assert.ok(fs.existsSync(path.join(defDir, 'keep.yaml')));
  assert.ok(result.skipped.some((s) => String(s.path).includes('intent-studio')));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('verify-intent-delete: ok');
}

main();
