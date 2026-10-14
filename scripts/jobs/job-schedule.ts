import fs from 'fs';
import path from 'path';
import { jobDir } from './job-utils.js';

const DOW: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type ClockParts = {
  year: string;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dow: number;
};

export function clockParts(date: Date, timeZone: string): ClockParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: bag.year,
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    dow: DOW[bag.weekday] ?? 0,
  };
}

export function clockSlot(date: Date, timeZone: string): string {
  const p = clockParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function matchField(field: string, value: number, dow: boolean): boolean {
  if (field === '*') return true;
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const piece = part.trim();
    if (!piece) return false;
    const [rawStart, rawEnd] = piece.split('-');
    const start = Number(rawStart);
    const end = rawEnd === undefined ? start : Number(rawEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return false;
    for (let n = start; n <= end; n++) values.add(n);
  }
  if (dow) {
    if (values.has(7)) values.add(0);
    if (values.has(0)) values.add(7);
  }
  return values.has(value);
}

/** 五段 cron：分 时 日 月 周。支持 *、数字、逗号、范围。日和周同时受限时按与关系匹配。 */
export function cronMatches(expr: string, date: Date, timeZone: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const now = clockParts(date, timeZone);
  const [minute, hour, dom, month, dow] = fields;
  return (
    matchField(minute, now.minute, false) &&
    matchField(hour, now.hour, false) &&
    matchField(dom, now.day, false) &&
    matchField(month, now.month, false) &&
    matchField(dow, now.dow, true)
  );
}

function firedPath(jobId: string): string {
  return path.join(jobDir(jobId), 'schedule-fired.json');
}

export function readFiredSlot(jobId: string): string {
  const file = firedPath(jobId);
  if (!fs.existsSync(file)) return '';
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as { slot?: string };
    return String(data.slot || '');
  } catch {
    return '';
  }
}

export function writeFiredSlot(jobId: string, slot: string): void {
  const file = firedPath(jobId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ slot }, null, 2));
}
