#!/usr/bin/env node
/**
 * 离线校验 Golden 现场种子策略（不启动浏览器）：
 *   node scripts/verify/verify-live-list-seed.cjs
 *
 * 核心回归：列表有行 + 过期 REQUEST_DOC_NO 时必须用现场单号，
 * 不得搜索「CB004250700001」这类 env 常量。
 */
const assert = require('assert');
const { loadTsUtil } = require('../../src/utils/load-ts-util.cjs');

function main() {
  const {
    deriveFilterKeyword,
    isGoldenForceSeed,
    isUsableListCell,
    resolveGoldenDocSeed,
    resolveGoldenFilterKeyword,
    resolveLiveDocNo,
    ANNOTATION_STALE_IGNORED,
    SKIP_NO_ROWS_DOC,
    SKIP_NO_DOC,
    SKIP_NO_KEYWORD,
    SKIP_NO_ROWS_FILTER,
  } = loadTsUtil('live-list-seed.ts');

  assert.strictEqual(isGoldenForceSeed(''), false);
  assert.strictEqual(isGoldenForceSeed('0'), false);
  assert.strictEqual(isGoldenForceSeed('1'), true);
  assert.strictEqual(isGoldenForceSeed('true'), true);

  assert.strictEqual(isUsableListCell(''), false);
  assert.strictEqual(isUsableListCell('  -  '), false);
  assert.strictEqual(isUsableListCell('CB004250700001'), true);

  assert.strictEqual(deriveFilterKeyword(''), '');
  assert.strictEqual(deriveFilterKeyword('-'), '');
  assert.strictEqual(deriveFilterKeyword('  测试申请单ABCDEF  '), '测试申请单ABC');
  assert.strictEqual(deriveFilterKeyword('213'), '213');

  // 列表有行 + 过期 env：现场胜出（禁止未找到单据「CB004…」）
  const staleEnvWhileListHasRows = resolveGoldenDocSeed({
    hasRows: true,
    liveDocNo: 'CLSQ2603002',
    configuredDocNo: 'CB004250700001',
    staticDocNo: 'EA-STALE-STATIC',
    configuredPresentInList: false,
    staticPresentInList: false,
    forceSeed: false,
  });
  assert.strictEqual(staleEnvWhileListHasRows.ok, true);
  assert.strictEqual(staleEnvWhileListHasRows.value, 'CLSQ2603002');
  assert.strictEqual(staleEnvWhileListHasRows.source, 'live');
  assert.strictEqual(staleEnvWhileListHasRows.ignoredConfigured, 'CB004250700001');
  assert.strictEqual(staleEnvWhileListHasRows.annotationType, ANNOTATION_STALE_IGNORED);
  assert.notStrictEqual(staleEnvWhileListHasRows.value, 'CB004250700001');

  // env 单号即使仍在列表，无 GOLDEN_FORCE_SEED 时仍用首行现场值
  const envPresentButLiveFirst = resolveGoldenDocSeed({
    hasRows: true,
    liveDocNo: 'CLSQ2603002',
    configuredDocNo: 'EA-IN-LIST',
    configuredPresentInList: true,
    forceSeed: false,
  });
  assert.strictEqual(envPresentButLiveFirst.value, 'CLSQ2603002');
  assert.strictEqual(envPresentButLiveFirst.source, 'live');
  assert.strictEqual(envPresentButLiveFirst.annotationType, ANNOTATION_STALE_IGNORED);

  // GOLDEN_FORCE_SEED=1 才允许 env 排在现场之前
  const forced = resolveGoldenDocSeed({
    hasRows: true,
    liveDocNo: 'CLSQ2603002',
    configuredDocNo: 'CB004250700001',
    forceSeed: true,
  });
  assert.strictEqual(forced.ok, true);
  assert.strictEqual(forced.value, 'CB004250700001');
  assert.strictEqual(forced.source, 'forced');

  // 空列表：不拿过期常量去搜
  const emptyWithStale = resolveGoldenDocSeed({
    hasRows: false,
    liveDocNo: '',
    configuredDocNo: 'CB004250700001',
    forceSeed: false,
  });
  assert.deepStrictEqual(emptyWithStale, { ok: false, skipReason: SKIP_NO_ROWS_DOC });

  const emptyForced = resolveGoldenDocSeed({
    hasRows: false,
    liveDocNo: '',
    configuredDocNo: 'CB004250700001',
    forceSeed: true,
  });
  assert.strictEqual(emptyForced.value, 'CB004250700001');
  assert.strictEqual(emptyForced.source, 'forced');

  const liveOnly = resolveGoldenDocSeed({ hasRows: true, liveDocNo: 'EA1144499145925038250' });
  assert.deepStrictEqual(liveOnly, {
    ok: true,
    value: 'EA1144499145925038250',
    source: 'live',
  });

  // 有行但读不出首行：仅当 env 仍可见才用，否则 skip（不盲搜）
  const unreadableStale = resolveGoldenDocSeed({
    hasRows: true,
    liveDocNo: '',
    configuredDocNo: 'CB004250700001',
    configuredPresentInList: false,
  });
  assert.deepStrictEqual(unreadableStale, { ok: false, skipReason: SKIP_NO_DOC });

  const unreadableVerified = resolveGoldenDocSeed({
    hasRows: true,
    liveDocNo: '',
    configuredDocNo: 'EA-STILL-VISIBLE',
    configuredPresentInList: true,
  });
  assert.strictEqual(unreadableVerified.ok, true);
  assert.strictEqual(unreadableVerified.value, 'EA-STILL-VISIBLE');
  assert.strictEqual(unreadableVerified.source, 'verified-configured');

  const filterStale = resolveGoldenFilterKeyword({
    hasRows: true,
    liveReason: '出差测试申请单',
    configuredKeyword: '测试',
    staticKeyword: '213',
    forceSeed: false,
  });
  assert.strictEqual(filterStale.ok, true);
  assert.strictEqual(filterStale.value, '出差测试申请单');
  assert.strictEqual(filterStale.ignoredConfigured, '测试');
  assert.strictEqual(filterStale.annotationType, ANNOTATION_STALE_IGNORED);

  const filterEmpty = resolveGoldenFilterKeyword({
    hasRows: false,
    liveReason: '',
    configuredKeyword: '测试',
  });
  assert.deepStrictEqual(filterEmpty, { ok: false, skipReason: SKIP_NO_ROWS_FILTER });

  const filterNoLive = resolveGoldenFilterKeyword({
    hasRows: true,
    liveReason: '-',
    configuredKeyword: '测试',
    configuredPresentInList: false,
  });
  assert.deepStrictEqual(filterNoLive, { ok: false, skipReason: SKIP_NO_KEYWORD });

  // 旧别名仍指向同一决策（列表有行时 live 胜出）
  const alias = resolveLiveDocNo({
    hasRows: true,
    liveDocNo: 'CLSQ2603002',
    configuredDocNo: 'CB004250700001',
  });
  assert.strictEqual(alias.value, 'CLSQ2603002');

  console.log('verify-live-list-seed: ok');
}

main();
