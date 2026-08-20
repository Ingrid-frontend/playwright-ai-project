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
  evaluateViewportConsistency,
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

  // 视口一致性：尺寸对得上放行，对不上（如 2908x1640 vs 1280x720）拒绝
  const okSize = { viewport: { width: 1280, height: 720, deviceScaleFactor: 1 }, imageWidth: 1280, imageHeight: 720 };
  assert.strictEqual(evaluateViewportConsistency(okSize), null);

  const fullPage = { viewport: { width: 1280, height: 720, deviceScaleFactor: 1 }, imageWidth: 1280, imageHeight: 4200 };
  assert.strictEqual(evaluateViewportConsistency(fullPage), null, 'fullPage 高度超出视口应放行');

  const drifted = { viewport: { width: 1280, height: 720, deviceScaleFactor: 1 }, imageWidth: 2908, imageHeight: 1640 };
  assert.ok(evaluateViewportConsistency(drifted), '窗口漂移尺寸应被拒绝');

  const dpr2 = { viewport: { width: 1280, height: 720, deviceScaleFactor: 2 }, imageWidth: 2560, imageHeight: 1440 };
  assert.strictEqual(evaluateViewportConsistency(dpr2), null, 'DPR=2 应按倍数换算');

  // 缺字段时不误判（老基线没有 viewport 元数据）
  assert.strictEqual(evaluateViewportConsistency({ imageWidth: 1280, imageHeight: 720 }), null);

  console.log('✅ verify-baseline-quality passed');
}

main();
