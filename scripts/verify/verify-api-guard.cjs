#!/usr/bin/env node
/**
 * api-guard 非阻断分类：协议同意 502 / Sentry ingest 500 不阻断；业务列表 5xx 仍失败。
 *   node scripts/verify/verify-api-guard.cjs
 */
const assert = require('assert');
const path = require('path');
const { require: tsxRequire } = require('tsx/cjs/api');

const {
  assertNoBlockingApiFailures,
  classifyApiFailure,
  isNonBlockingApiUrl,
  partitionApiFailures,
} = tsxRequire(path.join(__dirname, '../../src/utils/api-guard-classify.ts'), __filename);

function httpFailure(url, status, method = 'GET') {
  return classifyApiFailure({
    kind: 'http',
    url,
    fullUrl: `https://stage9084.example.com${url}`,
    method,
    status,
  });
}

function main() {
  const protocolUrl = '/auth/api/tenant/protocol/agree?roleType=TENANT&protocolType=USER_LOGIN';
  const sentryUrl = '/api/4/store/?sentry_key=abc123';
  const listUrl = '/api/applications/v4/search';
  const approvalListUrl = '/api/approvals/pendingApproval';
  const oauthUrl = '/oauth/token';
  const authLoginUrl = '/auth/api/login';

  assert.strictEqual(isNonBlockingApiUrl(protocolUrl), true, 'protocol/agree is non-blocking');
  assert.strictEqual(isNonBlockingApiUrl(sentryUrl), true, 'sentry store is non-blocking');
  assert.strictEqual(isNonBlockingApiUrl('/api/4/envelope/?sentry_key=x'), true, 'sentry envelope is non-blocking');
  assert.strictEqual(isNonBlockingApiUrl(listUrl), false, 'request list API stays blocking');
  assert.strictEqual(isNonBlockingApiUrl(approvalListUrl), false, 'approval list API stays blocking');
  assert.strictEqual(isNonBlockingApiUrl(oauthUrl), false, 'oauth login stays blocking');
  assert.strictEqual(isNonBlockingApiUrl(authLoginUrl), false, 'must not ignore all /auth/**');

  const protocol502 = httpFailure(protocolUrl, 502);
  const sentry500 = httpFailure(sentryUrl, 500, 'POST');
  const list502 = httpFailure(listUrl, 502, 'POST');
  const approval502 = httpFailure(approvalListUrl, 502, 'POST');

  assert.strictEqual(protocol502.blocking, false);
  assert.strictEqual(sentry500.blocking, false);
  assert.strictEqual(list502.blocking, true);
  assert.strictEqual(approval502.blocking, true);

  const warnings = [];
  assert.doesNotThrow(
    () => assertNoBlockingApiFailures('[申请单列表加载出数据行或空状态]', [protocol502], (m) => warnings.push(m)),
    'protocol/agree 502 must not fail the step',
  );
  assert.ok(warnings.some((m) => m.includes('非阻断失败') && m.includes('protocol/agree')), 'ignored failure is warned');

  warnings.length = 0;
  assert.doesNotThrow(
    () => assertNoBlockingApiFailures('[申请单列表加载出数据行或空状态]', [sentry500], (m) => warnings.push(m)),
    'sentry store 500 must not fail the step',
  );

  assert.throws(
    () => assertNoBlockingApiFailures('[申请单列表加载出数据行或空状态]', [list502]),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('监听发现 1 个失败接口'));
      assert.ok(err.message.includes('/api/applications/v4/search'));
      assert.ok(err.message.includes('status=502'));
      return true;
    },
    'business list 502 must still fail',
  );

  assert.throws(
    () => assertNoBlockingApiFailures('[审批列表加载]', [protocol502, sentry500, approval502], () => undefined),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('监听发现 1 个失败接口'));
      assert.ok(err.message.includes('/api/approvals/pendingApproval'));
      assert.ok(!err.message.includes('protocol/agree'));
      assert.ok(!err.message.includes('/api/4/store'));
      return true;
    },
    'mixed: only business 5xx fails the step',
  );

  const mixed = [protocol502, sentry500];
  const { blocking, ignored } = partitionApiFailures(mixed);
  assert.strictEqual(blocking.length, 0);
  assert.strictEqual(ignored.length, 2, 'ignored failures stay recorded for api-failures.json');

  console.log('verify-api-guard: ok');
}

main();
