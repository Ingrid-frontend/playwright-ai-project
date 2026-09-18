#!/usr/bin/env tsx
/**
 * 校验 config/test-jobs.json 与 .github/workflows/scheduled-test-jobs.yml 的调度一致性。
 *
 * 用法：npx tsx scripts/verify/verify-schedules.ts
 *
 * 检查项：
 *   1. config 有 schedule 但 CI 无对应 cron → 报错
 *   2. CI 有 cron 但 config schedule=null → 报警告
 *   3. cron 时间换算后不一致 → 报错
 *   4. timezone 声明与实际 CI 用 UTC → 记录说明
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(ROOT, 'config/test-jobs.json');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/scheduled-test-jobs.yml');

type ConfigJob = {
  id: string;
  enabled: boolean;
  schedule: string | null;
  timezone: string;
  description: string;
};

type Config = {
  defaults: { cronTimezone?: string };
  jobs: ConfigJob[];
};

type CiMapping = { cron: string; jobId: string; line: number };

function parseConfig(): Config {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  return {
    defaults: raw.defaults ?? {},
    jobs: (raw.jobs ?? []).map((j: Record<string, unknown>) => ({
      id: j.id as string,
      enabled: j.enabled !== false,
      schedule: (j.schedule as string | null) ?? null,
      timezone: (j.timezone as string) || 'UTC',
      description: (j.description as string) || '',
    })),
  };
}

function parseWorkflow(): { crons: string[]; mappings: CiMapping[]; caseDefault?: string } {
  const text = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
  const lines = text.split('\n');

  const crons: string[] = [];
  const cronRe = /^\s*-\s*cron:\s*'([^']+)'/;
  for (const line of lines) {
    const m = line.match(cronRe);
    if (m) crons.push(m[1]);
  }

  const mappings: CiMapping[] = [];
  const caseRe = /^\s*"([^"]+)"\)\s*JOB_ID=(\S+)/;
  let inCase = false;
  let caseDefault: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('case "${{ github.event.schedule }}"')) {
      inCase = true;
      continue;
    }
    if (inCase) {
      const m = line.match(caseRe);
      if (m) {
        mappings.push({ cron: m[1], jobId: m[2], line: i + 1 });
        continue;
      }
      const def = line.match(/^\s*\*\)\s*JOB_ID=(\S+)/);
      if (def) {
        caseDefault = def[1];
        inCase = false;
      }
    }
  }

  return { crons, mappings, caseDefault };
}

function cronToHuman(cron: string): string {
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  const dayNames: Record<string, string> = {
    '0': '周日', '1': '周一', '2': '周二', '3': '周三',
    '4': '周四', '5': '周五', '6': '周六', '7': '周日',
  };
  let schedule = '';
  if (dom === '*' && mon === '*' && dow === '*') schedule = '每天';
  else if (dow !== '*' && dom === '*') {
    const days = dow.split(',').map((d) => dayNames[d] || d).join('、');
    schedule = `每${days}`;
  } else schedule = `${dom}/${mon}`;
  return `${schedule} ${time} UTC`;
}

function utcToCst(cron: string): string {
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, _dom, _mon, _dow] = parts;
  let h = parseInt(hour, 10) + 8;
  let dayShift = '';
  if (h >= 24) {
    h -= 24;
    dayShift = '（次日）';
  }
  return `${h.toString().padStart(2, '0')}:${min.padStart(2, '0')} 北京${dayShift}`;
}

function main(): void {
  const config = parseConfig();
  const workflow = parseWorkflow();

  const cronTimezone = config.defaults.cronTimezone || '未声明';
  console.log(`\n配置 cronTimezone: ${cronTimezone}`);
  console.log(`CI cron 数量: ${workflow.crons.length}`);
  console.log(`CI case 映射: ${workflow.mappings.length} 条${workflow.caseDefault ? ` + catch-all → ${workflow.caseDefault}` : ''}\n`);

  const ciByJobId = new Map<string, CiMapping>();
  for (const m of workflow.mappings) ciByJobId.set(m.jobId, m);

  let errors = 0;
  let warnings = 0;

  for (const job of config.jobs) {
    if (!job.enabled) continue;

    const configCron = job.schedule;
    const ciMapping = ciByJobId.get(job.id);

    if (configCron && !ciMapping && !workflow.caseDefault) {
      console.log(`❌ ${job.id}: config 有 schedule="${configCron}"，但 CI 无对应映射`);
      errors++;
      continue;
    }

    if (configCron && !ciMapping && workflow.caseDefault) {
      const inCatchAll = !workflow.mappings.some((m) => m.cron === configCron);
      if (inCatchAll && workflow.caseDefault !== job.id) {
        console.log(`❌ ${job.id}: config schedule="${configCron}" 落入 CI catch-all → ${workflow.caseDefault}（应为 ${job.id}）`);
        errors++;
      } else if (inCatchAll && workflow.caseDefault === job.id) {
        console.log(`✅ ${job.id}: config "${configCron}" = CI catch-all → ${workflow.caseDefault} ✓`);
        console.log(`   ${cronToHuman(configCron)} = ${utcToCst(configCron)}`);
      }
      continue;
    }

    if (!configCron && ciMapping) {
      console.log(`⚠️  ${job.id}: config schedule=null，但 CI 映射到 "${ciMapping.cron}"`);
      console.log(`   CI: ${cronToHuman(ciMapping.cron)} = ${utcToCst(ciMapping.cron)}`);
      warnings++;
      continue;
    }

    if (!configCron && !ciMapping) {
      if (workflow.caseDefault === job.id) {
        console.log(`ℹ️  ${job.id}: config schedule=null，CI 通过 catch-all 触发`);
      } else {
        console.log(`ℹ️  ${job.id}: 无调度（仅手动触发）`);
      }
      continue;
    }

    if (configCron && ciMapping) {
      if (configCron === ciMapping.cron) {
        console.log(`✅ ${job.id}: config "${configCron}" = CI "${ciMapping.cron}" ✓`);
        console.log(`   ${cronToHuman(configCron)} = ${utcToCst(configCron)}`);
      } else {
        console.log(`❌ ${job.id}: config "${configCron}" ≠ CI "${ciMapping.cron}"`);
        console.log(`   config: ${cronToHuman(configCron)} = ${utcToCst(configCron)}`);
        console.log(`   CI:     ${cronToHuman(ciMapping.cron)} = ${utcToCst(ciMapping.cron)}`);
        errors++;
      }
    }

    if (job.timezone !== 'UTC' && configCron) {
      console.log(`   ℹ️  timezone="${job.timezone}" 为展示用，CI cron 统一使用 UTC`);
    }
  }

  for (const m of workflow.mappings) {
    const found = config.jobs.some((j) => j.id === m.jobId);
    if (!found) {
      console.log(`⚠️  CI 映射 "${m.cron}" → ${m.jobId}，但 config 无此 job`);
      warnings++;
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`结果: ${errors} 个错误, ${warnings} 个警告`);

  if (cronTimezone !== 'UTC') {
    console.log(`\n建议: 在 config defaults 添加 "cronTimezone": "UTC" 明确 CI cron 统一用 UTC`);
  }

  if (errors > 0) process.exit(1);
}

main();
