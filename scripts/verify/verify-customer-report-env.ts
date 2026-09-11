/**
 * 客户报告环境约束：缺 --env 必须失败；--list-envs / --help 允许不带环境。
 * 用法: npx tsx scripts/verify/verify-customer-report-env.ts
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { missingCustomerEnvError, parseCustomerEnvArgs } from '../report/customer-report-env.js';

function pass(name: string) {
  console.log(`  ✓ ${name}`);
}

assert.equal(parseCustomerEnvArgs(['--list-envs']).listEnvs, true);
assert.equal(parseCustomerEnvArgs(['--help']).help, true);
assert.equal(parseCustomerEnvArgs(['foo.html']).positional[0], 'foo.html');
assert.match(missingCustomerEnvError(), /--list-envs/);
pass('CLI 参数解析');

const noEnv = spawnSync('npm', ['run', 'report:customer'], {
  encoding: 'utf8',
  env: { ...process.env, PLAYWRIGHT_ENV: 'dev' },
});
assert.notEqual(noEnv.status, 0, '缺 --env 应非 0 退出（即使 PLAYWRIGHT_ENV 已设置）');
const errText = `${noEnv.stderr || ''}${noEnv.stdout || ''}`;
assert.match(errText, /必须指定单一环境/);
assert.match(errText, /--env=/);
pass('npm run report:customer 缺 --env 失败且提示中文');

const script = path.resolve('scripts/report/compare-screenshots-customer.ts');
const help = spawnSync('npx', ['tsx', script, '--help'], {
  encoding: 'utf8',
});
assert.equal(help.status, 0, '--help 应成功');
assert.match(`${help.stdout || ''}${help.stderr || ''}`, /--env=/);
pass('--help 不要求 --env');

const list = spawnSync('npx', ['tsx', script, '--list-envs'], {
  encoding: 'utf8',
});
assert.equal(list.status, 0, '--list-envs 应成功');
assert.match(`${list.stdout || ''}${list.stderr || ''}`, /可用环境/);
pass('--list-envs 不要求 --env');

const bundle = path.resolve('scripts/report/bundle-public-reports.ts');
const bundleHelp = spawnSync('npx', ['tsx', bundle, '--help'], {
  encoding: 'utf8',
});
assert.equal(bundleHelp.status, 0);
assert.match(`${bundleHelp.stdout || ''}${bundleHelp.stderr || ''}`, /--env=/);
pass('report:bundle --help 含 --env');

console.log('\n✅ verify-customer-report-env 通过');
