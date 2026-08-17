#!/usr/bin/env node
/**
 * 离线校验 Golden 晋升质量闸门
 *   node scripts/verify/verify-baseline-quality.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { require: tsxRequire } = require('tsx/cjs/api');

const {
  isEmptyShellDomHash,
  evaluateMetaQuality,
  assertRunEligibleForGolden,
} = tsxRequire(path.join(__dirname, '../../src/utils/baseline-quality.ts'), __filename);

function main() {
  assert.strictEqual(isEmptyShellDomHash('BODY|1||'), true);
  assert.strictEqual(isEmptyShellDomHash('BODY|44|active-scrollbar|江苏省精创电气'), false);

  const shell = evaluateMetaQuality({
    domHash: 'BODY|1||',
    selectors: { html: { exists: true } },
  });
  assert.ok(shell, 'empty shell should fail');

  const rich = evaluateMetaQuality({
    domHash: 'BODY|44|active-scrollbar|江苏省精创电气股份有限公司工作台',
    selectors: { html: { exists: true } },
  });
  assert.strictEqual(rich, null);

  const tmpBad = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-bad-'));
  fs.writeFileSync(
    path.join(tmpBad, 'step-1-x.meta.json'),
    JSON.stringify({ domHash: 'BODY|1||', selectors: { html: { exists: true } } }),
  );
  fs.writeFileSync(path.join(tmpBad, 'step-1-x.png'), Buffer.from([1, 2, 3]));
  let rejected = false;
  try {
    assertRunEligibleForGolden(tmpBad);
  } catch {
    rejected = true;
  }
  assert.strictEqual(rejected, true);

  const tmpGood = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-good-'));
  fs.writeFileSync(
    path.join(tmpGood, 'step-1-x.meta.json'),
    JSON.stringify({
      domHash: 'BODY|44|active-scrollbar|江苏省精创电气股份有限公司工作台我的审批',
      selectors: { html: { exists: true } },
    }),
  );
  fs.writeFileSync(path.join(tmpGood, 'step-1-x.png'), Buffer.from([1, 2, 3]));
  assertRunEligibleForGolden(tmpGood);

  console.log('✅ verify-baseline-quality passed');
}

main();
