#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { require: tsxRequire } = require('tsx/cjs/api');

const {
  applySelectorDriftPatches,
  pickAppliedSelector,
} = tsxRequire(path.join(__dirname, '../report/selector-drift-suggest.ts'), __filename);

function main() {
  const patch = {
    issueId: 'i1',
    scriptKey: 'flows/request-flow/dev/full-flow',
    stepNumber: 1,
    stepName: '列表',
    key: 'request-list-root',
    configSelector: '.old-root',
    resolvedBy: 'fallback',
    suggestSelectors: ['.new-root', '.old-root'],
    metaPath: 'x.meta.json',
    note: '',
  };
  assert.strictEqual(pickAppliedSelector(patch), '.new-root');
  assert.strictEqual(pickAppliedSelector({ ...patch, resolvedBy: 'selector' }), null);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'selector-drift-'));
  const cfgPath = path.join(tmp, 'ui-regression.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify(
      {
        structureChecks: {
          items: [{ key: 'request-list-root', selector: '.old-root' }],
        },
      },
      null,
      2,
    ),
    'utf-8',
  );

  const report = {
    generatedAt: new Date().toISOString(),
    patches: [patch],
    skipped: [],
  };

  const dry = applySelectorDriftPatches(tmp, report, { configPath: cfgPath, dryRun: true });
  assert.strictEqual(dry.applied.length, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).structureChecks.items[0].selector, '.old-root');

  const applied = applySelectorDriftPatches(tmp, report, { configPath: cfgPath });
  assert.strictEqual(applied.applied.length, 1);
  assert.strictEqual(
    JSON.parse(fs.readFileSync(cfgPath, 'utf8')).structureChecks.items[0].selector,
    '.new-root, .old-root',
  );

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('verify-selector-drift-apply: ok');
}

main();
