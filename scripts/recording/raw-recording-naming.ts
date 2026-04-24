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
    if (line.includes('page.goto(')) return 'goto';
    if (line.includes('.check(')) return 'check';
    if (line.includes('.selectOption(')) return 'select';
    if (line.includes('.press(')) return 'press';
  }
  return 'script';
}

export function inferFeature(code: string): string {
  const lines = code
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

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
 */
export function buildRecordingBaseSlug(code: string, options: RecordingSlugOptions = {}): string {
  const feature = shortenSegment(options.name?.trim() || inferFeature(code), 14);
  const behavior = shortenSegment(options.description?.trim() || inferBehavior(code), 14);
  const baseName =
    `${feature}-${behavior}`.replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 32) || 'recording-codegen';
  return baseName;
}

/** 支持 YYYY-MM-DD 或 YYYYMMDD（与 raw-recordings 子目录分类一致） */
export function getDateCategoryForCalendarDay(dateKey: string): string {
  const configPath = path.join(process.cwd(), 'config', 'date-categories.json');

  let fileDate: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    const [y, m, d] = dateKey.split('-').map(Number);
    fileDate = new Date(y, m - 1, d);
  } else if (/^\d{8}$/.test(dateKey)) {
    const y = parseInt(dateKey.substring(0, 4), 10);
    const m = parseInt(dateKey.substring(4, 6), 10) - 1;
    const d = parseInt(dateKey.substring(6, 8), 10);
    fileDate = new Date(y, m, d);
  } else {
    console.warn(`⚠️  无法解析日期分类键: ${dateKey}`);
    return 'default';
  }

  if (!fs.existsSync(configPath)) {
    console.warn(`⚠️  配置文件不存在: ${configPath}`);
    return 'default';
  }

  try {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent) as { dateCategories: string[] };

    for (const category of config.dateCategories) {
      const catYear = parseInt(category.substring(0, 4), 10);
      const catMonth = parseInt(category.substring(4, 6), 10) - 1;
      const catDay = parseInt(category.substring(6, 8), 10);
      const categoryDate = new Date(catYear, catMonth, catDay);

      if (fileDate <= categoryDate) {
        return category;
      }
    }

    return config.dateCategories[config.dateCategories.length - 1];
  } catch (error) {
    console.warn(`⚠️  读取 date-categories 失败: ${error}`);
    return 'default';
  }
}

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
