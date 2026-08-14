import fs from 'fs';
import path from 'path';

export function parseDateCategoryToDate(code: string): Date {
  const s = String(code || '').trim();
  if (/^\d{6}$/.test(s)) {
    const y = 2000 + parseInt(s.slice(0, 2), 10);
    const m = parseInt(s.slice(2, 4), 10) - 1;
    const d = parseInt(s.slice(4, 6), 10);
    return new Date(y, m, d);
  }
  if (/^\d{8}$/.test(s)) {
    const y = parseInt(s.slice(0, 4), 10);
    const m = parseInt(s.slice(4, 6), 10) - 1;
    const d = parseInt(s.slice(6, 8), 10);
    return new Date(y, m, d);
  }
  throw new Error(`无效日期分类：${code}`);
}

export function toShortDateCategoryCode(input: string): string {
  const s = String(input || '').trim();
  if (/^\d{6}$/.test(s)) return validateShortDateCategoryCode(s);
  if (/^\d{8}$/.test(s)) return validateShortDateCategoryCode(s.slice(2));
  throw new Error(`日期格式须为 6 位 YYMMDD，如 260717：${s || '(空)'}`);
}

export function validateShortDateCategoryCode(input: string): string {
  const s = String(input || '').trim();
  if (!/^\d{6}$/.test(s)) {
    throw new Error(`日期格式须为 6 位 YYMMDD，如 260717：${s || '(空)'}`);
  }
  const y = 2000 + parseInt(s.slice(0, 2), 10);
  const m = parseInt(s.slice(2, 4), 10);
  const d = parseInt(s.slice(4, 6), 10);
  if (m < 1 || m > 12) throw new Error(`月份无效：${s}`);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    throw new Error(`日期无效：${s}`);
  }
  return s;
}

export function isDateCategoryDirSegment(seg: string): boolean {
  return /^\d{6}$/.test(seg) || /^\d{8}$/.test(seg);
}

export function compareDateCategoryCodes(a: string, b: string): number {
  return parseDateCategoryToDate(a).getTime() - parseDateCategoryToDate(b).getTime();
}

export function normalizeDateCategoryList(list: string[]): string[] {
  if (!Array.isArray(list)) throw new Error('dateCategories 须为数组');
  const out: Array<{ short: string; time: number }> = [];
  const seen = new Set<string>();
  for (const item of list) {
    const short = toShortDateCategoryCode(item);
    const timeKey = String(parseDateCategoryToDate(short).getTime());
    if (seen.has(timeKey)) throw new Error(`重复日期：${short}`);
    seen.add(timeKey);
    out.push({ short, time: parseDateCategoryToDate(short).getTime() });
  }
  if (!out.length) throw new Error('至少保留一个日期分类');
  out.sort((a, b) => a.time - b.time);
  return out.map((x) => x.short);
}

export function formatDateCategoryCalendarLabel(code: string): string {
  const d = parseDateCategoryToDate(code);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getDateCategoryForCalendarDay(dateKey: string, configPath?: string): string {
  let fileDate: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    const [y, m, d] = dateKey.split('-').map(Number);
    fileDate = new Date(y, m - 1, d);
  } else if (/^\d{8}$/.test(dateKey)) {
    const y = parseInt(dateKey.slice(0, 4), 10);
    const m = parseInt(dateKey.slice(4, 6), 10) - 1;
    const d = parseInt(dateKey.slice(6, 8), 10);
    fileDate = new Date(y, m, d);
  } else {
    console.warn(`⚠️  无法解析日期分类键: ${dateKey}`);
    return 'default';
  }

  const abs = configPath || path.join(process.cwd(), 'config', 'date-categories.json');
  if (!fs.existsSync(abs)) {
    console.warn(`⚠️  配置文件不存在: ${abs}`);
    return 'default';
  }

  try {
    const config = JSON.parse(fs.readFileSync(abs, 'utf-8'));
    const categories = normalizeDateCategoryList(config.dateCategories || []);

    for (const category of categories) {
      const categoryDate = parseDateCategoryToDate(category);
      if (fileDate <= categoryDate) {
        return category;
      }
    }

    return categories[categories.length - 1];
  } catch (error) {
    console.warn(`⚠️  读取 date-categories 失败: ${error}`);
    return 'default';
  }
}
