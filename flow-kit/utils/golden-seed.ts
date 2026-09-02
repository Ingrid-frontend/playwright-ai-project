import fs from 'fs';
import path from 'path';

/**
 * Golden 种子数据解析器（共享实现）。
 *
 * 之前 request-flow / approval-flow 各写了一份只有常量不同的同款代码。
 * 这里参数化「种子文件路径 + 字段名」，各 flow 用 createGoldenSeedResolver 生成自己的
 * resolveGoldenSeed，保持对外签名不变。
 */
export type GoldenSeedEntry = Record<string, string | undefined>;

export type GoldenSeedOptions = {
  /** 种子文件相对仓库根的路径，如 request-flow/datasource/golden-seeds.json */
  seedsRel: string;
  /** 单号字段候选名，按顺序取第一个非空值 */
  docNoKeys: string[];
  /** 关键字字段候选名 */
  keywordKeys?: string[];
};

export type GoldenSeed = {
  docNo: string;
  keyword: string;
};

function readSeedsFile(
  seedsRel: string,
  repoRoot?: string,
): Record<string, Record<string, GoldenSeedEntry>> {
  const roots = repoRoot
    ? [path.join(repoRoot, seedsRel)]
    : [path.join(process.cwd(), seedsRel), path.join(process.cwd(), '..', seedsRel)];
  for (const abs of roots) {
    if (!fs.existsSync(abs)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }
  return {};
}

function firstNonEmpty(entry: GoldenSeedEntry, keys: string[]): string {
  for (const key of keys) {
    const val = String(entry?.[key] || '').trim();
    if (val) return val;
  }
  return '';
}

export function createGoldenSeedResolver(opts: GoldenSeedOptions) {
  return function resolveGoldenSeed(
    envId: string,
    roleSlug: string,
    repoRoot?: string,
  ): GoldenSeed {
    const env = String(envId || 'dev').trim();
    const slug = String(roleSlug || '').trim();
    const seeds = readSeedsFile(opts.seedsRel, repoRoot);
    const bucket = seeds[env] || {};
    const entry: GoldenSeedEntry = (slug && bucket[slug]) || bucket['*'] || bucket.default || {};
    return {
      docNo: firstNonEmpty(entry, opts.docNoKeys),
      keyword: firstNonEmpty(entry, opts.keywordKeys ?? []),
    };
  };
}
