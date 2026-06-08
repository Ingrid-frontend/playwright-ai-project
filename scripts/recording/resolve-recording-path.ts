/**
 * 解析录制落盘相对路径（与 record.ts / generate-raw-recording 命名一致）。
 *
 * CLI:
 *   npx tsx scripts/recording/resolve-recording-path.ts --json < payload.json
 * payload: { code, name?, description?, target?: "original" | "raw" }
 */
import {
  buildRecordingBaseSlug,
  getDateCategoryForCalendarDay,
} from './raw-recording-naming.js';

import {
  buildRawOriginalRel,
  isEnvSegmentEnabled,
} from '../../src/utils/test-env-path.js';

export type RecordingPathTarget = 'original' | 'raw';

export interface ResolveRecordingPathInput {
  code: string;
  name?: string;
  description?: string;
  target?: RecordingPathTarget;
  /** Playwright 环境 id，与 datasource/base-config.json 一致 */
  playwrightEnv?: string;
  /** 用于 timestamp / dateCategory；默认当前时间 */
  at?: Date;
}

export interface ResolveRecordingPathResult {
  relativePath: string;
  baseName: string;
  baseSlug: string;
  dateCategory: string;
  timestamp: string;
  target: RecordingPathTarget;
  playwrightEnv: string | null;
}

export function formatRecordingTimestamp(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}_${String(at.getHours()).padStart(2, '0')}-${String(at.getMinutes()).padStart(2, '0')}-${String(at.getSeconds()).padStart(2, '0')}`;
}

export function resolveRecordingPath(input: ResolveRecordingPathInput): ResolveRecordingPathResult {
  const code = String(input.code || '');
  const at = input.at ?? new Date();
  const target: RecordingPathTarget = input.target === 'raw' ? 'raw' : 'original';
  const timestamp = formatRecordingTimestamp(at);
  const dateIso = timestamp.split('_')[0];
  const dateCategory = getDateCategoryForCalendarDay(dateIso);
  const baseSlug = buildRecordingBaseSlug(code, {
    name: input.name,
    description: input.description,
  });
  const baseName = `${baseSlug}_${timestamp}`;
  const fileName = `${baseName}.spec.ts`;
  const playwrightEnv = input.playwrightEnv?.trim() || process.env.PLAYWRIGHT_ENV?.trim() || undefined;
  const relativePath =
    target === 'original'
      ? buildRawOriginalRel({ playwrightEnv, dateCategory, fileName, repoRoot: undefined })
      : isEnvSegmentEnabled() && playwrightEnv
        ? `tests/raw-recordings/${playwrightEnv}/${dateCategory}/${fileName}`
        : `tests/raw-recordings/${dateCategory}/${fileName}`;

  return {
    relativePath,
    baseName,
    baseSlug,
    dateCategory,
    timestamp,
    target,
    playwrightEnv: playwrightEnv || null,
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const jsonMode = process.argv.includes('--json');
  let payload: ResolveRecordingPathInput;

  if (jsonMode) {
    const raw = await readStdin();
    payload = JSON.parse(raw || '{}') as ResolveRecordingPathInput;
  } else {
    const fileIdx = process.argv.indexOf('--file');
    const file = fileIdx >= 0 ? process.argv[fileIdx + 1] : undefined;
    if (!file) {
      console.error('用法: npx tsx scripts/recording/resolve-recording-path.ts --json < payload.json');
      process.exit(1);
    }
    const fs = await import('fs');
    payload = { code: fs.readFileSync(file, 'utf8') };
    const nameIdx = process.argv.indexOf('--name');
    const descIdx = process.argv.indexOf('--description');
    if (nameIdx >= 0) payload.name = process.argv[nameIdx + 1];
    if (descIdx >= 0) payload.description = process.argv[descIdx + 1];
    if (process.argv.includes('--target=raw')) payload.target = 'raw';
  }

  const result = resolveRecordingPath(payload);
  if (jsonMode) {
    process.stdout.write(JSON.stringify(result));
  } else {
    console.log(result.relativePath);
  }
}

const isMain =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('resolve-recording-path.ts') ||
    process.argv[1].endsWith('resolve-recording-path.js'));

if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
