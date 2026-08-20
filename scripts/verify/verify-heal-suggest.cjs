#!/usr/bin/env node
/**
 * 离线校验自愈建议补丁
 *   node scripts/verify/verify-heal-suggest.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { require: tsxRequire } = require('tsx/cjs/api');

const {
  buildHealSuggestReport,
  extractHealPatch,
  applyHealSuggestToIntentYaml,
  writeHealSuggestArtifacts,
} = tsxRequire(path.join(__dirname, '../../src/runtime/heal-suggest.ts'), __filename);

function main() {
  const skipAssert = extractHealPatch({
    stepId: 'a1',
    attempt: 1,
    engine: 'pw',
    at: new Date().toISOString(),
    error: 'x',
    accepted: true,
    output: {
      correctedStep: { id: 'a1', action: { type: 'assert', description: '应改' } },
    },
  });
  assert.ok(skipAssert.skip, 'assert heal must skip');

  const ok = extractHealPatch({
    stepId: 'c1',
    attempt: 1,
    engine: 'ego',
    at: new Date().toISOString(),
    error: 'not found',
    accepted: true,
    output: { correctedDescription: '审批列表' },
  });
  assert.strictEqual(ok.patch?.fields.description, '审批列表');

  const report = buildHealSuggestReport([
    {
      stepId: 'c1',
      attempt: 1,
      engine: 'ego',
      at: new Date().toISOString(),
      error: 'not found',
      accepted: true,
      output: { correctedDescription: '审批列表' },
    },
  ]);
  assert.strictEqual(report.patches.length, 1);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-suggest-'));
  writeHealSuggestArtifacts(tmp, [
    {
      stepId: 'c1',
      attempt: 1,
      engine: 'ego',
      at: new Date().toISOString(),
      error: 'x',
      accepted: true,
      output: { correctedDescription: '新按钮' },
    },
  ]);
  assert.ok(fs.existsSync(path.join(tmp, 'heal-suggest.json')));
  assert.ok(fs.existsSync(path.join(tmp, 'heal-suggest.md')));

  const yamlPath = path.join(tmp, 'demo.yaml');
  fs.writeFileSync(
    yamlPath,
    `name: demo\nsteps:\n  - id: c1\n    action: click\n    description: 旧按钮\n  - id: a1\n    action: assert\n    kind: text\n    expect: 审批\n`,
    'utf-8',
  );
  const applied = applyHealSuggestToIntentYaml(yamlPath, report, { onlyAccepted: true });
  assert.deepStrictEqual(applied.updated, ['c1']);
  const text = fs.readFileSync(yamlPath, 'utf-8');
  assert.ok(text.includes('审批列表'));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('verify-heal-suggest: ok');
}

main();
