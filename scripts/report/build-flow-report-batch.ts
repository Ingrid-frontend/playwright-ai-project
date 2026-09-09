#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  normalizeReportBatchId,
  reportBatchDir,
  type ReportBatchRun,
  writeReportBatch,
} from './customer-report-batch.js';

type GoldenBatch = {
  flowId: string;
  env: string;
  results?: Array<{
    ok: boolean;
    skipped?: boolean;
    profileId: string;
    roleSlug: string;
    runId?: string;
    passed?: number;
    failed?: number;
    total?: number;
  }>;
};

function values(argv: string[], key: string): string[] {
  return argv
    .filter((arg) => arg.startsWith(`--${key}=`))
    .map((arg) => arg.slice(key.length + 3).trim())
    .filter(Boolean);
}

function readGoldenBatch(flowId: string): GoldenBatch | null {
  const abs = path.resolve('results', 'flow-runs', flowId, 'last-golden-batch.json');
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, 'utf8')) as GoldenBatch;
}

function main(): void {
  const argv = process.argv.slice(2);
  const flowIds = values(argv, 'flow');
  const targets = flowIds.length ? flowIds : ['request-flow', 'approval-flow'];
  const requestedId = values(argv, 'batch-id')[0];
  const batchId = normalizeReportBatchId(
    requestedId || `delivery-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  const runs: ReportBatchRun[] = [];

  for (const flowId of targets) {
    const batch = readGoldenBatch(flowId);
    if (!batch) continue;
    for (const item of batch.results || []) {
      runs.push({
        flowId,
        env: batch.env,
        profileId: item.profileId,
        roleSlug: item.roleSlug,
        scriptKey: `${flowId}/${batch.env}/golden-regression/by-account/${item.roleSlug}`,
        runId: item.runId || '',
        ok: Boolean(item.ok),
        skipped: Boolean(item.skipped),
        required: true,
        passed: item.passed,
        failed: item.failed,
        total: item.total,
      });
    }
  }

  if (!runs.length) {
    console.error('未找到可汇总的 Golden 批次');
    process.exit(1);
  }

  writeReportBatch({
    batchId,
    createdAt: new Date().toISOString(),
    expectedRunCount: runs.length,
    runs,
  });

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const report = spawnSync(
    npm,
    ['run', 'report:flow-customer', '--', `--batch-id=${batchId}`],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    },
  );
  if (report.status !== 0) process.exit(report.status || 1);

  console.log(`\n✅ 交付批次: ${batchId}`);
  console.log(`📄 客户报告: ${path.join(reportBatchDir(batchId), 'customer-report.html')}`);
}

main();
