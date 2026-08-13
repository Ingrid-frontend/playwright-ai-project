import fs from 'fs';
import path from 'path';

export interface RecordingSlugOptions {
  /** 对应 generate-raw-recording 的 --name / record 的 --feature */
  name?: string;
  /** 对应 --description / record 的 --behavior 或 --action */
  description?: string;
}

export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return parts[parts.length - 2];
    }
    return hostname;
  } catch {
    return 'unknown';
  }
}

export function sanitizePathSegment(name: string): string {
  return (
    name
      .replace(/[^\w\u4e00-\u9fa5-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .substring(0, 18) || 'test'
  );
}

export function shortenSegment(name: string, maxLength = 8): string {
  const cleaned = sanitizePathSegment(name);
  return cleaned.length > maxLength ? cleaned.substring(0, maxLength) : cleaned;
}

export function inferBehavior(code: string): string {
  const lines = code
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.includes('.click(')) return 'click';
    if (line.includes('.fill(')) return 'fill';
    if (line.includes('.type(')) return 'type';
    if (line.includes('.check(')) return 'check';
    if (line.includes('.selectOption(')) return 'select';
    if (line.includes('.press(')) return 'press';
  }
  for (const line of lines) {
    if (line.includes('page.goto(')) return 'goto';
  }
  return 'script';
}

/**
 * 从录制代码推断「功能名」slug。
 * 优先用首个简短界面文案（如菜单 getByText('我的审批')），避免一律落成 huilianyi-goto 这类「域名+首个 goto」。
 */
export function inferFeature(code: string): string {
  const lines = code
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const textMatch =
      line.match(/getByText\(\s*['"]([^'"]+)['"]/i) ||
      line.match(/getBy(?:Role|Label|Placeholder|AltText)\([^)]*name\s*:\s*['"]([^'"]+)['"]/i);
    if (!textMatch?.[1]) continue;
    const raw = textMatch[1].trim();
    if (/^https?:\/\//i.test(raw)) continue;
    // 太长多为整句文案/广告位，不适合做文件名前缀；过短略过
    if (raw.length < 2 || raw.length > 20) continue;
    const v = shortenSegment(raw, 12);
    if (v && v !== 'unknown') return v;
  }

  let sawRelativeGoto = false;
  for (const line of lines) {
    const gotoMatch = line.match(/page\.goto\(['"]([^'"]+)['"]/);
    if (!gotoMatch) continue;
    const url = gotoMatch[1];
    if (/^https?:\/\//i.test(url)) {
      const domain = extractDomain(url);
      if (domain && domain !== 'unknown') return domain;
    } else {
      sawRelativeGoto = true;
    }
  }

  for (const line of lines) {
    const textMatch =
      line.match(/getByText\(\s*['"]([^'"]+)['"]/i) ||
      line.match(/getBy(?:Role|Label|Placeholder|AltText)\([^)]*name\s*:\s*['"]([^'"]+)['"]/i);
    if (textMatch?.[1]) {
      const v = shortenSegment(textMatch[1], 12);
      if (v && v !== 'unknown') return v;
    }
  }

  if (sawRelativeGoto) return 'home';

  return inferBehavior(code);
}

/**
 * 与 generate-raw-recording 的 generateFileName 中 baseName 规则一致（不含路径与时间戳）。
 * 未显式传 description 且推断行为为普通 click 时，不拼「-click」，便于与菜单名（如「我的审批」）一致。
 */
export function buildRecordingBaseSlug(code: string, options: RecordingSlugOptions = {}): string {
  const explicitDesc = options.description?.trim();
  const feature = shortenSegment(options.name?.trim() || inferFeature(code), 14);
  const inferredBehavior = inferBehavior(code);
  const behavior = shortenSegment(explicitDesc || inferredBehavior, 14);

  let base: string;
  if (!explicitDesc && inferredBehavior === 'click' && feature) {
    base = feature;
  } else {
    base = `${feature}-${behavior}`.replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  return (base || 'recording-codegen').substring(0, 32);
}

import { getDateCategoryForCalendarDay } from '../../src/utils/date-category.cjs';

export { getDateCategoryForCalendarDay };

/**
 * 从 Codegen / 包装后的 spec 中提取 test 回调体（与 generate-raw-recording 落盘 original 的「片段」形态对齐）。
 */
export function extractSnippetFromPlaywrightSpec(source: string): string {
  const trimmed = source.trim();
  const marker = /async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{/;
  const m = trimmed.match(marker);
  if (!m || m.index === undefined) {
    return trimmed;
  }
  const startBrace = trimmed.indexOf('{', m.index + m[0].length - 1);
  if (startBrace === -1) {
    return trimmed;
  }
  let depth = 0;
  for (let i = startBrace; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        return trimmed.slice(startBrace + 1, i).trim();
      }
    }
  }
  return trimmed;
}

/**
 * 将原始片段写入 tests/raw-recordings/original/<dateCategory>/，与主文件同名（仅目录不同）。
 */
export function writeOriginalRecordingBackup(snippet: string, finalSpecPath: string, rawRecordingsRoot: string): void {
  const originalDir = path.join(rawRecordingsRoot, 'original');
  if (!fs.existsSync(originalDir)) {
    fs.mkdirSync(originalDir, { recursive: true });
  }

  const baseNameWithTimestamp = path.basename(finalSpecPath, '.spec.ts');
  const dateMatch = baseNameWithTimestamp.match(/(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) {
    console.warn(`⚠️  无法从文件名提取日期: ${baseNameWithTimestamp}`);
    return;
  }
  const dateStr = dateMatch[1];
  const dateCategory = getDateCategoryForCalendarDay(dateStr);
  const categoryDir = path.join(originalDir, dateCategory);

  if (!fs.existsSync(categoryDir)) {
    fs.mkdirSync(categoryDir, { recursive: true });
  }

  const originalFileName = path.join(categoryDir, `${baseNameWithTimestamp}.spec.ts`);
  fs.writeFileSync(originalFileName, snippet, 'utf-8');
  console.log(`✅ 已保存原始代码: ${originalFileName}`);
}
