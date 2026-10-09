/**
 * AI Smoke 巡检执行器（零 LLM 主体）：读 page-catalog → 并发逐页五级检查 → 产出结构化报告。
 *
 * 用法：
 *   npm run smoke:patrol -- --env=stage                      # 全站（smoke.enabled 且 active）
 *   npm run smoke:patrol -- --env=dev --page=request,approve # 指定页（id/label 模糊匹配）
 *   npm run smoke:patrol -- --env=dev --weight=core          # 仅核心页
 *   npm run smoke:patrol -- --env=dev --enforce-console      # console 错误计入失败（调参期后开）
 *   npm run smoke:patrol -- --env=dev --concurrency=3        # 并发 context 池（默认 2）
 *
 * 产物：results/smoke/<runId>/smoke-report.json（每页完成即增量落盘，支持中断后按 --page 续跑）
 * 退出码：存在 failed → 1；仅 suspicious → 0（噪声不挡门禁）
 */
import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';
import { getAdapter } from '../../src/app-adapter/registry.js';
import {
  attachConsoleCollector,
  filterConsoleErrors,
  loadCatalogPages,
  loadConsoleIgnore,
  runSmokeChecks,
  type CatalogPageLite,
  type SmokePageResult,
} from './smoke-checks.js';

function getArg(name: string, fallback = ''): string {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function stampRunId(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '');
}

function repoRoot(): string {
  let dir = path.resolve(process.cwd());
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'datasource/base-config.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd());
}

function pickEnvUrl(env: Record<string, string>): string {
  return env.baseURL || env.baseURL || '';
}

function pickStorageState(env: Record<string, string>): string | undefined {
  for (const raw of [process.env.STORAGE_STATE, process.env.STORAGE_STATE_PATH]) {
    const p = String(raw || '').trim();
    if (!p) continue;
    const abs = path.isAbsolute(p) ? p : path.resolve(p);
    if (fs.existsSync(abs)) return abs;
  }
  const p = env.storageState;
  if (!p) return undefined;
  const abs = path.isAbsolute(p) ? p : path.resolve(p);
  return fs.existsSync(abs) ? abs : undefined;
}

function matchOnly(page: CatalogPageLite, only: Set<string>): boolean {
  for (const o of only) {
    if (page.id === o || page.label === o || page.id.includes(o) || page.label.includes(o)) return true;
  }
  return false;
}

/** console 判定：在检查结果上追加 console 项并重算状态 */
function applyConsoleVerdict(
  result: SmokePageResult,
  filtered: Array<{ text: string; url?: string }>,
  enforce: boolean,
): void {
  result.consoleErrors = filtered;
  if (!filtered.length) {
    result.checks.push({ key: 'console', label: 'console', passed: true, detail: '无未忽略的 console/pageerror' });
    return;
  }
  const sample = filtered
    .slice(0, 3)
    .map((e) => e.text.slice(0, 120))
    .join(' | ');
  result.checks.push({
    key: 'console',
    label: 'console',
    passed: !enforce,
    suspicious: !enforce,
    detail: `${filtered.length} 条错误${enforce ? '' : '（调参期仅记录，--enforce-console 后计入失败）'}: ${sample}${filtered.length > 3 ? ' …' : ''}`,
  });
  if (result.status === 'passed' || (enforce && result.status !== 'failed')) {
    const hardFail = result.checks.some((c) => !c.passed && !c.suspicious);
    const anySuspicious = result.checks.some((c) => c.suspicious);
    result.status = hardFail ? 'failed' : anySuspicious ? 'suspicious' : 'passed';
  }
}

type ReportFile = {
  version: number;
  runId: string;
  env: string;
  startedAt: string;
  finishedAt?: string;
  concurrency: number;
  enforceConsole: boolean;
  totals: { pages: number; passed: number; suspicious: number; failed: number; consoleErrors: number };
  pages: SmokePageResult[];
};

async function main(): Promise<void> {
  const root = repoRoot();
  const env = getArg('env', process.env.PLAYWRIGHT_ENV || 'stage');
  const weight = getArg('weight', '') as '' | 'core' | 'normal';
  const limit = Number(getArg('limit', '0')) || 0;
  const concurrency = Math.min(6, Math.max(1, Number(getArg('concurrency', '2')) || 2));
  const only = new Set(getArg('page', '').split(',').map((s) => s.trim()).filter(Boolean));
  const enforceConsole = hasFlag('enforce-console');
  const noFail = hasFlag('no-fail');
  const timeoutMs = Number(getArg('timeout', '45000')) || 45_000;

  const allPages = loadCatalogPages(root);
  let pages = allPages.filter((p) => p.smoke.enabled);
  if (weight) pages = pages.filter((p) => p.smoke.weight === weight);
  if (only.size) pages = pages.filter((p) => matchOnly(p, only));
  if (limit) pages = pages.slice(0, limit);

  if (!pages.length) {
    console.log('[smoke] 无待巡检页面（检查 page-catalog.json 的 smoke.enabled / status / weight）');
    return;
  }

  const baseConfig = JSON.parse(fs.readFileSync(path.join(root, 'datasource/base-config.json'), 'utf8'));
  const envCfg = baseConfig[env] as Record<string, string> | undefined;
  if (!envCfg) throw new Error(`未知环境: ${env}（datasource/base-config.json）`);
  const baseURL = pickEnvUrl(envCfg);
  if (!baseURL) throw new Error(`环境 ${env} 未配置 baseURL`);
  const storageState = pickStorageState(envCfg);

  const runId = stampRunId();
  const outDir = path.resolve(root, 'results/smoke', runId);
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, 'smoke-report.json');

  const report: ReportFile = {
    version: 1,
    runId,
    env,
    startedAt: new Date().toISOString(),
    concurrency,
    enforceConsole,
    totals: { pages: pages.length, passed: 0, suspicious: 0, failed: 0, consoleErrors: 0 },
    pages: [],
  };
  const saveReport = () => {
    report.totals.passed = report.pages.filter((p) => p.status === 'passed').length;
    report.totals.suspicious = report.pages.filter((p) => p.status === 'suspicious').length;
    report.totals.failed = report.pages.filter((p) => p.status === 'failed').length;
    report.totals.consoleErrors = report.pages.reduce((n, p) => n + p.consoleErrors.length, 0);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  };

  const adapter = getAdapter(env);
  const ignore = loadConsoleIgnore(root);
  const screenshotDir = path.resolve(root, 'screenshots/smoke', env);

  console.log(`\n🕵️  Smoke 巡检 env=${env} 页数=${pages.length} 并发=${concurrency} enforceConsole=${enforceConsole}`);
  console.log(`📂 报告: ${path.relative(root, reportPath)}\n`);

  const browser = await chromium.launch();
  let next = 0;

  const worker = async (workerId: number): Promise<void> => {
    const context = await browser.newContext({
      baseURL,
      storageState,
      locale: 'zh-CN',
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    try {
      while (true) {
        const idx = next++;
        if (idx >= pages.length) break;
        const cp = pages[idx];
        const t0 = Date.now();
        let result: SmokePageResult;
        try {
          const collector = attachConsoleCollector(page);
          result = await runSmokeChecks(page, {
            env,
            baseURL,
            adapter,
            catalogPage: cp,
            enforceConsole,
            timeoutMs,
            screenshotPath: path.join(screenshotDir, `${cp.id}.png`),
          });
          collector.detach();
          applyConsoleVerdict(result, filterConsoleErrors(collector.errors, ignore), enforceConsole);
        } catch (err) {
          result = {
            pageId: cp.id,
            label: cp.label,
            route: cp.route,
            env,
            status: 'failed',
            durationMs: Date.now() - t0,
            checks: [{ key: 'reachable', label: '可达', passed: false, detail: String((err as Error)?.message || err).slice(0, 300) }],
            consoleErrors: [],
            screenshot: null,
            runAt: new Date().toISOString(),
          };
        }
        report.pages.push(result);
        saveReport();
        const mark = result.status === 'passed' ? '✅' : result.status === 'suspicious' ? '🟡' : '❌';
        console.log(
          `${mark} [w${workerId}] ${cp.id} → ${result.status} (${(result.durationMs / 1000).toFixed(1)}s)${result.checks.find((c) => !c.passed && !c.suspicious || c.suspicious)?.detail ? ` · ${result.checks.find((c) => (!c.passed && !c.suspicious) || c.suspicious)?.detail?.slice(0, 120)}` : ''}`,
        );
      }
    } finally {
      await context.close().catch(() => undefined);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, (_, i) => worker(i)));
  } finally {
    await browser.close().catch(() => undefined);
  }

  report.finishedAt = new Date().toISOString();
  saveReport();

  const { passed, suspicious, failed, consoleErrors } = report.totals;
  console.log(`\n📊 巡检完成：通过 ${passed} / 可疑 ${suspicious} / 失败 ${failed}（console 错误 ${consoleErrors} 条）`);
  if (failed > 0) {
    console.log('失败页：');
    for (const p of report.pages.filter((x) => x.status === 'failed')) {
      const reason = p.checks.find((c) => !c.passed && !c.suspicious)?.detail || '';
      console.log(`  ❌ ${p.pageId} ${p.route} — ${reason}`);
    }
  }
  if (suspicious > 0) {
    console.log('可疑页（不挡门禁，建议人工过一眼截图）：');
    for (const p of report.pages.filter((x) => x.status === 'suspicious')) {
      const reason = p.checks.find((c) => c.suspicious)?.detail || '';
      console.log(`  🟡 ${p.pageId} — ${reason}`);
    }
  }

  if (failed > 0 && !noFail) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
