#!/usr/bin/env tsx
/**
 * 文档索引校验。
 *
 * 索引最大的问题是会烂掉：加了新文档忘了挂、改了文件名忘了改链接。
 * 靠自觉守不住，所以做成可执行检查。三项：
 *   1. docs/ 下每篇文档都被 docs/README.md 挂到（不许有孤岛）
 *   2. 所有 md 里的相对链接目标真实存在（含指向仓库其他文件的）
 *   3. 每篇子文档都有返回索引的链接（读者进得去也出得来）
 *
 * 用法：
 *   npm run docs:check        # 有问题时退出码 1
 */
import fs from 'fs';
import path from 'path';

const DOCS = path.join(process.cwd(), 'docs');
const INDEX = 'README.md';
const BACK_LINK_RE = /\]\(\.\/README\.md\)/;

type Issue = { kind: string; detail: string };

function listDocs(): string[] {
  return fs
    .readdirSync(DOCS)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

/** 抽出所有相对链接（./x.md、../y.ts、x.md），忽略 http(s) 与纯锚点 */
function relLinks(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const t = m[1].trim();
    if (/^(https?:|mailto:|#)/.test(t)) continue;
    out.push(t);
  }
  return out;
}

function main(): void {
  const files = listDocs();
  const issues: Issue[] = [];

  if (!files.includes(INDEX)) {
    process.stderr.write(`✗ 缺少索引文件 docs/${INDEX}\n`);
    process.exit(1);
  }

  const indexSrc = fs.readFileSync(path.join(DOCS, INDEX), 'utf8');
  const indexed = new Set(
    relLinks(indexSrc)
      .map((t) => path.basename(t.split('#')[0]))
      .filter((f) => f.endsWith('.md')),
  );

  // ① 孤岛检查
  for (const f of files) {
    if (f === INDEX) continue;
    if (!indexed.has(f)) {
      issues.push({ kind: '未挂进索引', detail: `docs/${f} — 在 docs/${INDEX} 里加一行` });
    }
  }

  for (const f of files) {
    const abs = path.join(DOCS, f);
    const src = fs.readFileSync(abs, 'utf8');

    // ② 链接目标存在性（相对于 docs/ 解析）
    for (const t of relLinks(src)) {
      const target = path.resolve(DOCS, t.split('#')[0]);
      if (!fs.existsSync(target)) {
        issues.push({ kind: '失效链接', detail: `docs/${f} -> ${t}` });
      }
    }

    // ③ 返回索引链接
    if (f !== INDEX && !BACK_LINK_RE.test(src)) {
      issues.push({
        kind: '缺返回链接',
        detail: `docs/${f} — 在首个标题下加一行 > 索引：[docs/README.md](./README.md)`,
      });
    }
  }

  if (!issues.length) {
    process.stdout.write(`[docs:check] ✅ ${files.length} 篇文档，索引完整、链接无失效。\n`);
    return;
  }

  const byKind = new Map<string, string[]>();
  for (const i of issues) {
    if (!byKind.has(i.kind)) byKind.set(i.kind, []);
    byKind.get(i.kind)!.push(i.detail);
  }
  for (const [kind, items] of byKind) {
    process.stderr.write(`\n✗ ${kind}（${items.length}）：\n`);
    for (const d of items) process.stderr.write(`  · ${d}\n`);
  }
  process.stderr.write(`\n共 ${issues.length} 个问题。\n`);
  process.exit(1);
}

main();
