#!/usr/bin/env tsx
/**
 * 失败路径选择器诊断：flow run 失败后，自动把失败信息里的定位链
 * 放到「今天的真实页面」上复算一遍，回答两个问题：
 *   1. 哪条定位链断了（UI 漂移）→ missing / invisible / ambiguous
 *   2. 页面现在的结构长什么样（表头/页签/搜索框）→ 与 catalog 差异
 *
 * 设计约束：
 *   - best-effort：诊断自身失败绝不抛错，只写 reason 后 exit 0
 *     （gate 语义由主流程决定，诊断只提供证据）
 *   - 无 ego lite 依赖：直接用 Playwright + storageState 无头复算，
 *     本机与 CI 都能跑；无登录态时降级为「仅解析失败定位链」
 *
 * 用法:
 *   npm run flow:selector-audit -- --flow=request-flow --run=<runId>
 *   npm run flow:selector-audit -- --flow=request-flow --run=<runId> --parse-only
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { chromium } from '@playwright/test';
import {
  parseLocatorExpression,
  type SelectorPart,
} from '../../src/utils/spec-selectors.js';
import {
  buildProbeSource,
  mergeFrameResults,
  type FrameProbeOutput,
  type ProbeStepInput,
  type ProbeStepResult,
} from '../../src/utils/ego-selector-probe.js';
import { getBaseEnvConfig } from '../../src/utils/env-config.js';
import { getFlow } from './flow-registry.js';

const require = createRequire(import.meta.url);
const repoEnv = require('../../pw-files/repo-env.js');

/** 登录页特征（与 gen-catalog-from-probe 保持一致） */
const LOGIN_MARKERS = /二维码登录|账号登录|请使用.*APP扫码/;

type AuditSummary = {
  missing: number;
  ambiguous: number;
  invisible: number;
  healthy: number;
};

type StructureFrame = {
  frameUrl: string;
  headers: string[];
  tabs: string[];
  placeholders: string[];
  rows: number;
  hasAntTable: boolean;
  bodySnippet: string;
};

type SelectorAuditReport = {
  generatedAt: string;
  flowId: string;
  flowLabel: string;
  runId: string;
  env: string;
  profile: string;
  pageUrl: string;
  loginRedirect: boolean;
  probes: ProbeStepResult[];
  summary: AuditSummary;
  bizFrame: StructureFrame | null;
  frames: StructureFrame[];
  catalogDrift: string[];
  reason?: string;
};

type FailureItem = { title?: string; message?: string };

function getArg(name: string, fallback = ''): string {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function readJsonSafe<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * 从 Playwright 失败消息里提取可复算的定位链。
 * 两层粒度：
 *   1. 「Locator:」整链（含 filter/first，parseLocatorExpression 会跳过收窄调用）
 *   2. 消息里散落的 locator('css') / getByText('x') / getByRole('role') 片段
 */
export function extractProbeSteps(failures: FailureItem[]): ProbeStepInput[] {
  const seen = new Set<string>();
  const steps: ProbeStepInput[] = [];
  const push = (raw: string, stepName: string, parts: SelectorPart[] | null) => {
    const key = raw.trim();
    if (!key || seen.has(key) || !parts || parts.length === 0) return;
    seen.add(key);
    steps.push({
      index: steps.length + 1,
      stepName,
      line: 0,
      raw: key,
      inFrame: /contentFrame|frameLocator/.test(key),
      parts,
      optional: false,
    });
  };

  for (const failure of failures) {
    const msg = String(failure.message || '');
    const title = (failure.title || '失败用例').split('›').pop()?.trim() || '失败用例';

    // 1) 整链：Locator: locator('...').filter(...).first()
    for (const m of msg.matchAll(/^\s*Locator:\s*(.+)$/gm)) {
      const raw = m[1].trim();
      push(raw, title, parseLocatorExpression(raw));
    }

    // 2) CSS 片段：locator('css') —— 判断单个子选择器是否还活着
    for (const m of msg.matchAll(/locator\(\s*(['"])(.+?)\1/g)) {
      const css = m[2].trim();
      if (!css) continue;
      push(`locator('${css}')`, `${title} · css 片段`, [{ kind: 'css', value: css }]);
    }

    // 3) 文本/角色片段
    for (const m of msg.matchAll(/getByText\(\s*(['"])(.+?)\1/g)) {
      const value = m[2].trim();
      if (!value) continue;
      push(`getByText('${value}')`, `${title} · 文本`, [{ kind: 'text', value, exact: false }]);
    }
    for (const m of msg.matchAll(/getByRole\(\s*(['"])(.+?)\1/g)) {
      const role = m[2].trim();
      if (!role) continue;
      push(`getByRole('${role}')`, `${title} · 角色`, [{ kind: 'role', role, exact: false }]);
    }
  }

  return steps;
}

/** 从 catalog 源码提取 COLUMNS / TABS / SEARCH_PLACEHOLDER（与 runCheck 同语义） */
export function extractCatalogContract(catalogSrc: string): {
  columns: string[];
  tabs: string[];
  placeholder: string;
} {
  const arrItems = (name: string): string[] => {
    const m = catalogSrc.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`));
    if (!m) return [];
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter(Boolean);
  };
  const ph = catalogSrc.match(/export const SEARCH_PLACEHOLDER = '([^']*)'/)?.[1] || '';
  return { columns: arrItems('COLUMNS'), tabs: arrItems('TABS'), placeholder: ph };
}

const STRUCTURE_SNIPPET = `(() => {
  const text = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim();
  return {
    frameUrl: location.href,
    headers: [...document.querySelectorAll('.ant-table-thead th')].map(text).filter(Boolean),
    tabs: [...document.querySelectorAll('.ant-tabs-tab')].map(text).filter(Boolean),
    placeholders: [...document.querySelectorAll('input[placeholder]')]
      .map((el) => el.getAttribute('placeholder')).filter(Boolean),
    rows: document.querySelectorAll('.ant-table-tbody tr.ant-table-row').length,
    hasAntTable: Boolean(document.querySelector('.ant-table')),
    bodySnippet: ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').trim().slice(0, 300),
  };
})()`;

function pickBizFrame(frames: StructureFrame[]): StructureFrame | null {
  let best: StructureFrame | null = null;
  let bestScore = -1;
  for (const f of frames) {
    const score = f.headers.length * 3 + f.rows + f.tabs.length * 2 + (f.hasAntTable ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

/** 比对实机结构与 catalog（只报缺失方向：catalog 有实机没有才算漂移） */
export function diffCatalogContract(
  biz: StructureFrame | null,
  catalog: { columns: string[]; tabs: string[]; placeholder: string },
): string[] {
  const drift: string[] = [];
  if (!biz) return drift;

  const norm = (s: string) => s.replace(/\s+/g, '');
  const liveHeaders = new Set(biz.headers.map(norm));
  const missingCols = catalog.columns.map(norm).filter((c) => c && c !== '+' && !liveHeaders.has(c));
  if (missingCols.length) {
    drift.push(`表头：catalog ${missingCols.length} 列在实机消失：${missingCols.join(' / ')}`);
  }

  const liveTabs = new Set(biz.tabs.map((t) => t.replace(/[（(]\s*\d+\s*[)）]\s*$/, '').replace(/\s+/g, '')));
  const missingTabs = catalog.tabs.map(norm).filter((t) => t && !liveTabs.has(t));
  if (missingTabs.length) {
    drift.push(`页签：catalog ${missingTabs.length} 个在实机消失：${missingTabs.join(' / ')}`);
  }

  if (catalog.placeholder && catalog.placeholder !== '请输入' && !biz.placeholders.includes(catalog.placeholder)) {
    drift.push(`搜索框 placeholder：catalog「${catalog.placeholder}」实机未出现（现值：${biz.placeholders.slice(0, 3).join(' | ') || '无'}）`);
  }

  return drift;
}

function summarize(probes: ProbeStepResult[]): AuditSummary {
  return {
    missing: probes.filter((p) => p.verdict === 'missing' && !p.optional).length,
    ambiguous: probes.filter((p) => p.verdict === 'ambiguous').length,
    invisible: probes.filter((p) => p.verdict === 'invisible').length,
    healthy: probes.filter((p) => p.verdict === 'ok').length,
  };
}

function writeReport(repoRoot: string, report: SelectorAuditReport): { jsonRel: string; mdRel: string } {
  const dir = path.join(repoRoot, 'results', 'flow-runs', report.flowId, report.runId);
  fs.mkdirSync(dir, { recursive: true });
  const jsonAbs = path.join(dir, 'selector-audit.json');
  fs.writeFileSync(jsonAbs, JSON.stringify(report, null, 2), 'utf8');

  const lines: string[] = [
    `# 选择器诊断 · ${report.flowLabel || report.flowId} · ${report.runId}`,
    '',
    `生成于 ${report.generatedAt} · env=${report.env}${report.profile ? ` · profile=${report.profile}` : ''}`,
    report.pageUrl ? `页面: ${report.pageUrl}` : '',
    report.reason ? `⚠️ ${report.reason}` : '',
    '',
  ].filter((l) => l !== '');

  if (report.probes.length === 0) {
    lines.push('失败消息中未解析到可复算的定位链（可能是数据断言失败，非选择器问题）。');
  } else {
    const label: Record<ProbeStepResult['verdict'], string> = {
      ok: '✅ 健康',
      missing: '❌ 断裂',
      ambiguous: '⚠️ 多重匹配',
      invisible: '⚠️ 不可见',
    };
    for (const p of report.probes) {
      lines.push(`- ${label[p.verdict]} ${p.raw}`);
      lines.push(`  ${p.stepName} · 匹配 total=${p.total} visible=${p.visible}${p.brokenAtPart ? `，断在第 ${p.brokenAtPart} 段` : ''}`);
      if (p.samples.length) lines.push(`  命中示例: ${p.samples.join(' | ')}`);
      if (p.frameUrl) lines.push(`  所在 frame: ${p.frameUrl}`);
    }
  }

  if (report.catalogDrift.length) {
    lines.push('', '## catalog 漂移');
    for (const d of report.catalogDrift) lines.push(`- ${d}`);
  }
  if (report.bizFrame) {
    lines.push(
      '',
      '## 实机结构',
      `- 表头: ${report.bizFrame.headers.join(' | ') || '（无）'}`,
      `- 页签: ${report.bizFrame.tabs.join(' | ') || '（无）'}`,
      `- 数据行: ${report.bizFrame.rows}`,
    );
  }

  const mdAbs = jsonAbs.replace(/\.json$/, '.md');
  fs.writeFileSync(mdAbs, `${lines.join('\n')}\n`, 'utf8');
  return {
    jsonRel: path.relative(repoRoot, jsonAbs).replace(/\\/g, '/'),
    mdRel: path.relative(repoRoot, mdAbs).replace(/\\/g, '/'),
  };
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const flowId = getArg('flow');
  const runId = getArg('run');
  const parseOnly = hasFlag('parse-only');
  const urlOverride = getArg('url');

  const flow = getFlow(flowId);
  if (!flow || !runId) {
    console.error('[selector-audit] 用法: npm run flow:selector-audit -- --flow=<id> --run=<runId> [--parse-only]');
    process.exit(flow && runId ? 0 : 1);
    return;
  }

  const manifest = readJsonSafe<Record<string, unknown>>(
    path.join(repoRoot, 'results', 'flow-runs', flowId, runId, 'manifest.json'),
  );
  const failures = (manifest?.failures as FailureItem[] | undefined) || [];
  const env = String(manifest?.env || process.env.PLAYWRIGHT_ENV || 'dev');
  const profile = String(manifest?.accountProfile || '');

  const steps = extractProbeSteps(failures);
  const baseReport: SelectorAuditReport = {
    generatedAt: new Date().toISOString(),
    flowId,
    flowLabel: flow.label,
    runId,
    env,
    profile,
    pageUrl: '',
    loginRedirect: false,
    probes: [],
    summary: { missing: 0, ambiguous: 0, invisible: 0, healthy: 0 },
    bizFrame: null,
    frames: [],
    catalogDrift: [],
  };

  if (steps.length === 0) {
    const report = { ...baseReport, reason: '失败消息未含定位链（数据断言失败），无需选择器复算' };
    writeReport(repoRoot, report);
    console.log('[selector-audit] 失败消息未含定位链，无需复算');
    return;
  }

  console.log(`[selector-audit] 解析到 ${steps.length} 条待复算定位链（失败 ${failures.length} 条）`);

  if (parseOnly) {
    const report = { ...baseReport, probes: [], reason: 'parse-only 模式：仅解析未复算' };
    writeReport(repoRoot, report);
    return;
  }

  // 登录态：优先该 run 用的档案，兜底 STORAGE_STATE 环境变量
  let storage = '';
  try {
    const resolved = repoEnv.resolveValidatedStorageAbs(repoRoot, env, profile);
    storage = resolved?.abs || '';
  } catch {
    storage = '';
  }
  if (!storage) {
    const envStorage = String(process.env.STORAGE_STATE || '').trim();
    if (envStorage && fs.existsSync(path.isAbsolute(envStorage) ? envStorage : path.resolve(repoRoot, envStorage))) {
      storage = path.isAbsolute(envStorage) ? envStorage : path.resolve(repoRoot, envStorage);
    }
  }

  const base = getBaseEnvConfig(env)?.baseURL || String(process.env.BASE_URL || '').trim();
  if (!base) {
    const report = { ...baseReport, reason: `环境 ${env} 未配置 baseURL，无法复算` };
    writeReport(repoRoot, report);
    console.log('[selector-audit] 无 baseURL，降级输出解析结果');
    return;
  }

  const entry = urlOverride || flow.entry;
  const target = /^https?:\/\//i.test(entry) ? entry : new URL(entry, base).toString();
  const catalogPath = path.join(repoRoot, flowId, 'utils', `${flow.domain}-catalog.ts`);
  const catalogSrc = fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, 'utf8') : '';
  const catalog = catalogSrc ? extractCatalogContract(catalogSrc) : { columns: [], tabs: [], placeholder: '' };

  const probeSource = buildProbeSource(steps);
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      baseURL: base,
      ...(storage ? { storageState: storage } : {}),
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // 等表格或网络空闲，最长 12s；失败不致命（后面逐 frame 复算自会反映）
    await Promise.race([
      page.waitForSelector('.ant-table', { timeout: 12_000 }).catch(() => undefined),
      page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined),
    ]);

    const pageUrl = page.url();
    const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 600));
    const loginRedirect =
      /\/login/i.test(pageUrl) || LOGIN_MARKERS.test(bodyText) ||
      (await Promise.all(
        page.frames().map((f) =>
          f.evaluate(() => (document.body?.innerText || '')).catch(() => ''),
        ),
      )).some((t) => LOGIN_MARKERS.test(t));

    if (loginRedirect) {
      const report: SelectorAuditReport = {
        ...baseReport,
        pageUrl,
        loginRedirect: true,
        reason: `页面落在登录页（${profile || env} 登录态失效），无法复算。请先刷新登录态后重跑诊断`,
      };
      writeReport(repoRoot, report);
      console.log('[selector-audit] 登录态失效，仅输出解析结果');
      return;
    }

    const frames: FrameProbeOutput[] = [];
    const structures: StructureFrame[] = [];
    for (const frame of page.frames()) {
      try {
        const probed = await frame.evaluate<FrameProbeOutput>(probeSource);
        if (probed) frames.push(probed);
      } catch {
        /* frame 可能已销毁 */
      }
      try {
        const struct = await frame.evaluate<StructureFrame>(STRUCTURE_SNIPPET);
        if (struct) structures.push(struct);
      } catch {
        /* ignore */
      }
    }

    const probes = mergeFrameResults(steps, frames);
    const biz = pickBizFrame(structures);
    const drift = catalogSrc ? diffCatalogContract(biz, catalog) : [];
    const report: SelectorAuditReport = {
      ...baseReport,
      pageUrl,
      probes,
      summary: summarize(probes),
      bizFrame: biz,
      frames: structures,
      catalogDrift: drift,
      ...(catalogSrc ? {} : { reason: '未找到 catalog 文件，跳过结构比对' }),
    };
    writeReport(repoRoot, report);

    console.log(
      `[selector-audit] 复算完成 · 断裂 ${report.summary.missing} · 多重匹配 ${report.summary.ambiguous} · 不可见 ${report.summary.invisible} · 漂移 ${drift.length}`,
    );
    for (const p of probes.filter((x) => x.verdict === 'missing' && !x.optional)) {
      console.log(`[selector-audit]   ❌ ${p.raw}`);
    }
    for (const d of drift) console.log(`[selector-audit]   ⚠️ ${d}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const report = { ...baseReport, reason: `诊断执行失败（不影响主流程结论）: ${message.slice(0, 300)}` };
    writeReport(repoRoot, report);
    console.log('[selector-audit] 诊断执行失败，已记录原因');
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

// 仅直接执行时运行（被 import 供单测/冒烟复用 extractProbeSteps 等纯函数）
const invokedDirectly =
  process.argv[1] && /run-failure-selector-audit\.(ts|js|mjs)$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((err) => {
    // best-effort：诊断绝不抛错
    console.error('[selector-audit]', err instanceof Error ? err.message : err);
    process.exit(0);
  });
}
