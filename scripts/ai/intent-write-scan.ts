#!/usr/bin/env tsx
/**
 * Intent 写动作扫描 CLI（pw-files 入库门禁调用，单一事实源在 src/types/test-intent.ts）。
 *
 *   npx tsx scripts/ai/intent-write-scan.ts --yaml=results/drafts/request/intent.preview.yaml
 *
 * 输出 JSON：{ ok, writeActions, reviewRequired, trustLevel, pageId }
 */
import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { detectWriteActions, validateTestIntent } from '../../src/types/test-intent.js';

function getArg(name: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : '';
}

async function main(): Promise<void> {
  const rel = getArg('yaml');
  if (!rel) {
    console.error('用法: tsx scripts/ai/intent-write-scan.ts --yaml=<path>');
    process.exit(2);
  }
  const abs = path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
  if (!fs.existsSync(abs)) {
    console.error(`文件不存在: ${rel}`);
    process.exit(2);
  }
  try {
    const raw = parseYaml(fs.readFileSync(abs, 'utf8'));
    const intent = validateTestIntent(raw);
    const writeActions = detectWriteActions(intent);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          path: path.relative(process.cwd(), abs).replace(/\\/g, '/'),
          writeActions,
          reviewRequired: writeActions.length > 0 || intent.reviewRequired === true,
          trustLevel: intent.trustLevel || 'trial',
          pageId: intent.pageId || null,
        },
        null,
        2,
      )}\n`,
    );
  } catch (err) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 300) })}\n`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
