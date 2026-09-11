#!/usr/bin/env node
/**
 * 离线校验 Golden 现场种子策略（不启动浏览器）：
 *   node scripts/verify/verify-live-list-seed.cjs
 */
const assert = require('assert');
const path = require('path');
const { loadTsUtil } = require('../../src/utils/load-ts-util.cjs');

function main() {
  const {
    deriveFilterKeyword,
    isUsableListCell,
    resolveLiveDocNo,
    resolveLiveFilterKeyword,
    SKIP_NO_ROWS_DOC,
    SKIP_NO_DOC,
    SKIP_NO_KEYWORD,
    SKIP_NO_ROWS_FILTER,
  } = loadTsUtil('live-list-seed.ts');

  assert.strictEqual(isUsableListCell(''), false);
  assert.strictEqual(isUsableListCell('  -  '), false);
  assert.strictEqual(isUsableListCell('CB004250700001'), true);

  assert.strictEqual(deriveFilterKeyword(''), '');
  assert.strictEqual(deriveFilterKeyword('-'), '');
  assert.strictEqual(deriveFilterKeyword('  测试申请单ABCDEF  '), '测试申请单ABC');
  assert.strictEqual(deriveFilterKeyword('213'), '213');

  const noRows = resolveLiveDocNo({
    hasRows: false,
    liveDocNo: 'CLSQ2603002',
    configuredDocNo: 'CB004250700001',
  });
  assert.deepStrictEqual(noRows, { ok: false, skipReason: SKIP_NO_ROWS_DOC });

  const staleConfigured = resolveLiveDocNo({
    hasRows: true,
    liveDocNo: 'CLSQ2603002',
    configuredDocNo: 'CB004250700001',
  });
  assert.strictEqual(staleConfigured.ok, true);
  assert.strictEqual(staleConfigured.value, 'CLSQ2603002');
  assert.strictEqual(staleConfigured.source, 'live');
  assert.strictEqual(staleConfigured.ignoredConfigured, 'CB004250700001');

  const liveOnly = resolveLiveDocNo({ hasRows: true, liveDocNo: 'EA1144499145925038250' });
  assert.deepStrictEqual(liveOnly, {
    ok: true,
    value: 'EA1144499145925038250',
    source: 'live',
  });

  const unreadable = resolveLiveDocNo({
    hasRows: true,
    liveDocNo: '',
    configuredDocNo: 'CB004250700001',
  });
  assert.deepStrictEqual(unreadable, { ok: false, skipReason: SKIP_NO_DOC });

  const filterNoRows = resolveLiveFilterKeyword({
    hasRows: false,
    liveReason: '测试',
    configuredKeyword: '测试',
  });
  assert.deepStrictEqual(filterNoRows, { ok: false, skipReason: SKIP_NO_ROWS_FILTER });

  const filterEmptyReason = resolveLiveFilterKeyword({
    hasRows: true,
    liveReason: '-',
    configuredKeyword: '测试',
  });
  assert.deepStrictEqual(filterEmptyReason, { ok: false, skipReason: SKIP_NO_KEYWORD });

  const ignoreDefaultKeyword = resolveLiveFilterKeyword({
    hasRows: true,
    liveReason: '出差测试申请单',
    configuredKeyword: '测试',
  });
  assert.strictEqual(ignoreDefaultKeyword.ok, true);
  assert.strictEqual(ignoreDefaultKeyword.value, '出差测试申请单');
  assert.strictEqual(ignoreDefaultKeyword.ignoredConfigured, '测试');

  const ignoreNumericConfigured = resolveLiveFilterKeyword({
    hasRows: true,
    liveReason: '部门团建预算',
    configuredKeyword: '213',
  });
  assert.strictEqual(ignoreNumericConfigured.ok, true);
  assert.strictEqual(ignoreNumericConfigured.value, '部门团建预算');
  assert.strictEqual(ignoreNumericConfigured.ignoredConfigured, '213');

  console.log('verify-live-list-seed: ok');
}

main();
