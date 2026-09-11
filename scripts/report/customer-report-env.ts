/**
 * 客户报告环境约束：必须显式 --env，禁止默认同报混入多套环境。
 */
import fs from 'fs';
import path from 'path';
import { listKnownEnvs } from '../../src/utils/test-env-path.js';
import { friendlyEnvLabel } from './customer-report-naming.js';
import type { ScriptScanTarget } from './compare-screenshots-scan.js';

export const CUSTOMER_HTML_PREFIX = 'ui-regression-customer';
export const CUSTOMER_DELIVERY_PREFIX = 'customer-delivery';

const SKIP_DIR_NAMES = new Set([
  'results',
  'diffs',
  'pom',
  'node_modules',
  '.git',
  'figma',
  'images',
]);

export type CustomerCliArgs = {
  env?: string;
  listEnvs: boolean;
  help: boolean;
  positional: string[];
};

export type DiscoveredEnv = {
  id: string;
  sources: string[];
};

const ENV_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeEnvId(envId: string): boolean {
  const id = String(envId || '').trim();
  return Boolean(id) && ENV_ID_RE.test(id) && !id.includes('..');
}

export function parseCustomerEnvArgs(argv: string[]): CustomerCliArgs {
  let env: string | undefined;
  let listEnvs = false;
  let help = false;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--list-envs' || arg === '--list-env') {
      listEnvs = true;
      continue;
    }
    if (arg === '--env' || arg === '-e') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        env = next.trim();
        i += 1;
      } else {
        env = '';
      }
      continue;
    }
    if (arg.startsWith('--env=')) {
      env = arg.slice('--env='.length).trim();
      continue;
    }
    if (!arg.startsWith('--')) positional.push(arg);
  }
  return { env: env || undefined, listEnvs, help, positional };
}

export function customerReportHtmlRel(envId: string): string {
  return path.join('results', `${CUSTOMER_HTML_PREFIX}-${envId}.html`);
}

export function customerDeliveryJsonRel(envId: string): string {
  return path.join('results', `${CUSTOMER_DELIVERY_PREFIX}-${envId}.json`);
}

export function knownCustomerEnvIds(repoRoot?: string): string[] {
  const fromConfig = listKnownEnvs(repoRoot);
  const extras = ['dev', 'uat', 'stage', 'stage9084', 'staging'];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...fromConfig, ...extras]) {
    const key = String(id || '').trim();
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    out.push(key);
  }
  return out;
}

export function extractEnvFromRelPath(rel: string, knownEnvs: string[]): string | null {
  const known = new Map(knownEnvs.map((e) => [e.toLowerCase(), e]));
  const segs = String(rel || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  for (const seg of segs) {
    const hit = known.get(seg.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

export function filterScanTargetsByEnv(
  targets: ScriptScanTarget[],
  envId: string,
  knownEnvs: string[],
): ScriptScanTarget[] {
  const envLc = String(envId || '').trim().toLowerCase();
  if (!envLc) return [];
  return targets.filter((t) => {
    const hit = extractEnvFromRelPath(t.testDir, knownEnvs);
    if (hit) return hit.toLowerCase() === envLc;
    const segs = t.testDir.replace(/\\/g, '/').split('/').filter(Boolean);
    return segs.some((s) => s.toLowerCase() === envLc);
  });
}

function walkEnvSegments(
  absDir: string,
  knownEnvs: string[],
  found: Map<string, Set<string>>,
  source: string,
  depth: number,
): void {
  if (depth > 8 || !fs.existsSync(absDir)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  const known = new Map(knownEnvs.map((e) => [e.toLowerCase(), e]));
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    if (SKIP_DIR_NAMES.has(ent.name)) continue;
    if (/^run-(chromium|webkit|firefox|safari|edge)-/i.test(ent.name)) continue;
    const canon = known.get(ent.name.toLowerCase());
    if (canon) {
      if (!found.has(canon)) found.set(canon, new Set());
      found.get(canon)!.add(source);
    }
    walkEnvSegments(path.join(absDir, ent.name), knownEnvs, found, source, depth + 1);
  }
}

function collectEnvsFromCustomerHtml(resultsDir: string, found: Map<string, Set<string>>): void {
  if (!fs.existsSync(resultsDir)) return;
  let names: string[] = [];
  try {
    names = fs.readdirSync(resultsDir);
  } catch {
    return;
  }
  const prefix = `${CUSTOMER_HTML_PREFIX}-`;
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.html')) continue;
    const id = name.slice(prefix.length, -'.html'.length);
    if (!isSafeEnvId(id)) continue;
    if (!found.has(id)) found.set(id, new Set());
    found.get(id)!.add('results');
  }
}

export function listAvailableCustomerEnvs(opts?: {
  repoRoot?: string;
  screenshotsDir?: string;
  baselineDir?: string;
  resultsDir?: string;
  knownEnvs?: string[];
}): DiscoveredEnv[] {
  const root = opts?.repoRoot || process.cwd();
  const known = opts?.knownEnvs || knownCustomerEnvIds(root);
  const found = new Map<string, Set<string>>();
  walkEnvSegments(
    path.resolve(root, opts?.screenshotsDir || 'screenshots'),
    known,
    found,
    'screenshots',
    0,
  );
  walkEnvSegments(
    path.resolve(root, opts?.baselineDir || 'screenshots-baseline'),
    known,
    found,
    'screenshots-baseline',
    0,
  );
  collectEnvsFromCustomerHtml(path.resolve(root, opts?.resultsDir || 'results'), found);
  return [...found.entries()]
    .map(([id, sources]) => ({ id, sources: [...sources].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id, 'zh-CN'));
}

export function customerReportHelpText(): string {
  return `用法:
  npm run report:customer -- --env=<环境>
  npm run report:customer -- --list-envs

客户报告必须指定单一环境，不再生成混环境汇总 HTML。

选项:
  --env=<环境>     必填。只汇总该环境的截图与基线（如 stage9084、uat、dev、stage）
  --list-envs      列出 screenshots / screenshots-baseline / 已有报告中的可用环境
  --help           显示本说明

输出（环境后缀，不再写无后缀的 ui-regression-customer.html）:
  results/ui-regression-customer-<环境>.html
  results/customer-delivery-<环境>.json
`;
}

export function missingCustomerEnvError(available?: DiscoveredEnv[]): string {
  const ids = (available || []).map((e) => e.id);
  const availLine = ids.length
    ? `当前可用环境: ${ids.join('、')}`
    : '当前未从 screenshots / screenshots-baseline / 已有报告中发现环境';
  return [
    '客户报告必须指定单一环境，禁止默认把多套环境聚合进同一份 HTML。',
    '请传入 --env=<环境>，例如: npm run report:customer -- --env=stage9084',
    '查看可用环境: npm run report:customer -- --list-envs',
    availLine,
  ].join('\n');
}

export function formatListEnvsText(
  discovered: DiscoveredEnv[],
  configured: string[],
): string {
  const lines = ['可用环境（来自 screenshots / screenshots-baseline / 已有报告）:'];
  if (discovered.length === 0) {
    lines.push('  （无）');
  } else {
    for (const item of discovered) {
      const label = friendlyEnvLabel(item.id);
      lines.push(`  - ${item.id}  ${label}  [${item.sources.join(', ')}]`);
    }
  }
  if (configured.length) {
    lines.push(`已知配置环境（datasource/base-config.json）: ${configured.join(', ')}`);
  }
  lines.push('生成单环境报告: npm run report:customer -- --env=<环境>');
  return lines.join('\n');
}

export function assertSafeEnvId(envId: string): string {
  const id = String(envId || '').trim();
  if (!isSafeEnvId(id)) {
    throw new Error(`环境代号无效: ${envId || '(空)'}。请使用字母/数字，例如 stage9084、uat、dev、stage`);
  }
  return id;
}

export type AssetRewriteKey = {
  original: string;
  bundled: string;
  copied: boolean;
};

/** 把客户 HTML 引用的本地图片拷进 destDir/assets/，并改写为相对该目录的路径 */
export function rewriteCustomerHtmlAssets(opts: {
  html: string;
  htmlAbs: string;
  repoRoot: string;
  destDir: string;
}): { html: string; keys: AssetRewriteKey[] } {
  const htmlDir = path.dirname(opts.htmlAbs);
  const assetsRoot = path.join(opts.destDir, 'assets');
  const refs = collectLocalAssetRefs(opts.html);
  const keys: AssetRewriteKey[] = [];
  const replacements: Array<{ from: string; to: string }> = [];

  for (const original of refs) {
    const abs = path.resolve(htmlDir, original);
    const repoRel = path.relative(opts.repoRoot, abs).replaceAll(path.sep, '/');
    if (!repoRel || repoRel.startsWith('..') || path.isAbsolute(repoRel)) {
      keys.push({ original, bundled: original, copied: false });
      continue;
    }
    const bundled = `assets/${repoRel}`;
    const destAbs = path.join(opts.destDir, bundled);
    let copied = false;
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.copyFileSync(abs, destAbs);
      copied = true;
    }
    keys.push({ original, bundled, copied });
    if (copied && original !== bundled) replacements.push({ from: original, to: bundled });
  }

  replacements.sort((a, b) => b.from.length - a.from.length);
  let html = opts.html;
  for (const { from, to } of replacements) {
    html = html.split(from).join(to);
  }
  if (keys.some((k) => k.copied)) {
    fs.mkdirSync(assetsRoot, { recursive: true });
  }
  return { html, keys };
}

function collectLocalAssetRefs(html: string): string[] {
  const found = new Set<string>();
  const re = /(?:src|href)=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const u = m[1] || '';
    if (!u) continue;
    if (/^(data:|https?:|\/\/|#|javascript:)/i.test(u)) continue;
    found.add(u);
  }
  return [...found];
}

export function writeCustomerDeliveryJson(opts: {
  envId: string;
  htmlRel: string;
  generatedAt: string;
  outRel?: string;
}): string {
  const outRel = opts.outRel || customerDeliveryJsonRel(opts.envId);
  const payload = {
    env: opts.envId,
    envLabel: friendlyEnvLabel(opts.envId),
    html: opts.htmlRel.replaceAll(path.sep, '/'),
    generatedAt: opts.generatedAt,
    singleEnv: true,
  };
  const abs = path.resolve(outRel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(payload, null, 2), 'utf-8');
  return outRel;
}
