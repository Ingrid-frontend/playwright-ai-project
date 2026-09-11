/**
 * 本地 results/ 清理脚本的共用能力：参数、体积统计、安全路径、中文预览日志。
 * 只允许动 results/ 下的可再生成产物；永不碰 screenshots-baseline、.env、源码、results/jobs。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export type PruneItem = {
  /** 相对 results 根的展示路径 */
  rel: string;
  abs: string;
  bytes: number;
  reason: string;
};

export function getArgValue(name: string, argv = process.argv.slice(2)): string | undefined {
  const prefix = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === `--${name}` && i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) {
      return argv[i + 1];
    }
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

export function hasFlag(name: string, argv = process.argv.slice(2)): boolean {
  return argv.some((arg) => arg === `--${name}` || (name === 'h' && arg === '-h'));
}

export function parseNonNegInt(raw: string | undefined, fallback: number, flag: string): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${flag} 必须是 >= 0 的整数，收到: ${raw}`);
  }
  return n;
}

export function resolveResultsRoot(argv = process.argv.slice(2), cwd = process.cwd()): string {
  const raw = getArgValue('results', argv) || 'results';
  return path.resolve(cwd, raw);
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = i === 0 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

/** 递归统计文件体积；目录不存在或不可读时返回 0 */
export function measurePathBytes(absPath: string): number {
  let total = 0;
  const walk = (p: string) => {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return;
    if (st.isFile()) {
      total += st.size;
      return;
    }
    if (!st.isDirectory()) return;
    let names: string[] = [];
    try {
      names = fs.readdirSync(p);
    } catch {
      return;
    }
    for (const name of names) walk(path.join(p, name));
  };
  walk(absPath);
  return total;
}

export function isInsideDir(absPath: string, root: string): boolean {
  const resolved = path.resolve(absPath);
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, resolved);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** results/jobs 及其中一切都不可删 */
export function isJobsPath(absPath: string, resultsRoot: string): boolean {
  const jobs = path.resolve(resultsRoot, 'jobs');
  const resolved = path.resolve(absPath);
  return resolved === jobs || resolved.startsWith(jobs + path.sep);
}

const FORBIDDEN_NAME_RE = /(?:^|[\\/])(?:screenshots-baseline|\.env(?:\..*)?|node_modules|\.git)(?:$|[\\/])/;

export function isForbiddenAbs(absPath: string, resultsRoot: string): boolean {
  const resolved = path.resolve(absPath);
  if (FORBIDDEN_NAME_RE.test(resolved)) return true;
  if (!isInsideDir(resolved, resultsRoot) && resolved !== path.resolve(resultsRoot)) return true;
  if (isJobsPath(resolved, resultsRoot)) return true;
  return false;
}

export function assertSafeDeleteTarget(absPath: string, resultsRoot: string): void {
  if (isForbiddenAbs(absPath, resultsRoot) || !isInsideDir(absPath, resultsRoot)) {
    throw new Error(`拒绝删除受保护或不在 results/ 内的路径: ${absPath}`);
  }
}

export function printPruneHeader(title: string, apply: boolean, extra: string[] = []): void {
  const mode = apply ? '执行删除' : '预览（未加 --apply，不会删除）';
  console.log(`${title}`);
  console.log(`模式: ${mode}`);
  for (const line of extra) console.log(line);
  console.log('');
}

export function printPrunePlan(items: PruneItem[], apply: boolean): void {
  const bytes = items.reduce((n, it) => n + it.bytes, 0);
  if (items.length === 0) {
    console.log('无需清理。');
    if (!apply) console.log('提示: 加 --apply 才会真正删除。');
    return;
  }
  const verb = apply ? '将删除' : '预览将删除';
  console.log(`${verb} ${items.length} 项 · 约 ${formatBytes(bytes)}`);
  for (const it of items) {
    console.log(`  - ${it.rel}  (${formatBytes(it.bytes)})  ${it.reason}`);
  }
  if (!apply) {
    console.log('');
    console.log('提示: 加 --apply 才会真正删除。');
  }
}

export function applyRemovals(items: PruneItem[], resultsRoot: string): { deleted: number; bytes: number } {
  let deleted = 0;
  let bytes = 0;
  for (const it of items) {
    assertSafeDeleteTarget(it.abs, resultsRoot);
    if (!fs.existsSync(it.abs)) continue;
    fs.rmSync(it.abs, { recursive: true, force: true });
    deleted += 1;
    bytes += it.bytes;
  }
  return { deleted, bytes };
}

export function printApplyResult(deleted: number, bytes: number): void {
  if (deleted === 0) {
    console.log('未删除任何文件。');
    return;
  }
  console.log(`✅ 已删除 ${deleted} 项 · 释放约 ${formatBytes(bytes)}`);
}

export function loadKnownEnvs(repoRoot = process.cwd()): string[] {
  const extra = ['dev', 'uat', 'stage', 'stage9084', 'prod', 'production', 'staging', 'test'];
  const cfgPath = path.join(repoRoot, 'datasource/base-config.json');
  const fromCfg: string[] = [];
  if (fs.existsSync(cfgPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
      fromCfg.push(...Object.keys(raw).filter(Boolean));
    } catch {
      /* ignore */
    }
  }
  const uniq = [...new Set([...fromCfg, ...extra].map((s) => s.trim()).filter(Boolean))];
  return uniq.sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function isDirectRun(metaUrl: string): boolean {
  const self = path.resolve(fileURLToPath(metaUrl));
  return process.argv.slice(1).some((arg) => {
    try {
      return path.resolve(arg) === self;
    } catch {
      return false;
    }
  });
}
