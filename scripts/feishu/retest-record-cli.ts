#!/usr/bin/env tsx
/**
 * 记录反馈项复验结果
 *
 * 用法：
 *   npm run retest:record -- --stable-id=abc123 --env=stage9084 --run=run-42 --verdict=resolved
 *   npm run retest:record -- --stable-id=abc123 --env=stage9084 --run=run-43 --verdict=still-present --notes="差异仍在"
 *   npm run retest:status
 */
import {
  recordRetestAttempt,
  readRetestTrace,
  buildRetestSummary,
  formatRetestSummary,
  deriveStableIssueId,
  type RetestVerdict,
} from './retest-trace.js';

function main(): void {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const value = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };

  if (flags.has('--status')) {
    const summary = buildRetestSummary();
    console.log(formatRetestSummary(summary));
    if (summary.entries.length > 0) {
      console.log('\n明细：');
      for (const entry of summary.entries) {
        const status = entry.resolvedAt ? '✅' : entry.attempts.length > 0 ? '🔄' : '⏳';
        console.log(`  ${status} ${entry.stableIssueId} ${entry.scriptLabel} · ${entry.stepLabel}（${entry.attempts.length} 次复验）`);
      }
    }
    return;
  }

  if (flags.has('--list')) {
    const stableId = value('stable-id');
    const entries = readRetestTrace(stableId);
    if (entries.length === 0) {
      console.log('无复验记录');
      return;
    }
    for (const entry of entries) {
      console.log(`\n[${entry.stableIssueId}] ${entry.scriptLabel} · ${entry.stepLabel}`);
      console.log(`  首次发现: ${entry.firstDetectedAt}`);
      if (entry.resolvedAt) console.log(`  已解决: ${entry.resolvedAt}（run=${entry.resolvedByRunId}）`);
      for (const attempt of entry.attempts) {
        const icon = attempt.verdict === 'resolved' ? '✅' : attempt.verdict === 'still-present' ? '❌' : '🔄';
        console.log(`  ${icon} #${attempt.attemptIndex} ${attempt.testedAt} run=${attempt.runId}${attempt.notes ? ` (${attempt.notes})` : ''}`);
      }
    }
    return;
  }

  const stableId = value('stable-id');
  const envId = value('env') || '';
  const runId = value('run') || '';
  const verdictStr = value('verdict') || '';
  const notes = value('notes');
  const evidencePath = value('evidence');

  if (!stableId && !envId) {
    console.error('请指定 --stable-id=<id> 或至少 --env=<id>');
    console.error('用法: npm run retest:record -- --stable-id=<id> --env=<env> --run=<runId> --verdict=resolved|still-present|changed');
    process.exit(1);
  }
  if (!runId) {
    console.error('请指定 --run=<runId>');
    process.exit(1);
  }
  if (!verdictStr || !['resolved', 'still-present', 'changed'].includes(verdictStr)) {
    console.error('请指定 --verdict=resolved|still-present|changed');
    process.exit(1);
  }

  const scriptLabel = value('script') || '';
  const stepLabel = value('step') || '';
  const browserLabel = value('browser') || '';
  const title = value('title') || '';

  const id = stableId || deriveStableIssueId(envId, scriptLabel, stepLabel, browserLabel, title);

  const entry = recordRetestAttempt({
    stableIssueId: id,
    envId,
    scriptLabel,
    stepLabel,
    browserLabel,
    title,
    runId,
    verdict: verdictStr as RetestVerdict,
    notes,
    evidencePath,
  });

  const icon = verdictStr === 'resolved' ? '✅' : verdictStr === 'still-present' ? '❌' : '🔄';
  console.log(`${icon} 已记录复验：stableId=${id}, attempt=#${entry.attempts.length}, verdict=${verdictStr}`);
  if (verdictStr === 'resolved') {
    console.log(`   问题已解决，resolvedAt=${entry.resolvedAt}`);
  }
}

main();
