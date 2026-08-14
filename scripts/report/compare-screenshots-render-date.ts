import type { ImageComparison } from './image-diff.js';
import { type ScreenshotInfo } from './compare-screenshots-utils.js';

export function extractCalendarDayKey(raw: string): string | null {
  if (!raw) return null;

  const runMatch = raw.match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (runMatch) return runMatch[1];

  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]);
    const d = Number(iso[3]);
    const dt = new Date(y, mo - 1, d);
    if (!Number.isNaN(dt.getTime())) {
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
  }

  const compact = raw.match(/(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?:[^\d]|$)/);
  if (compact) {
    const y = Number(compact[1]);
    const mo = Number(compact[2]);
    const d = Number(compact[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(y, mo - 1, d);
      if (!Number.isNaN(dt.getTime())) {
        return `${compact[1]}-${compact[2]}-${compact[3]}`;
      }
    }
  }

  return null;
}

export function calendarDayKeyForScreenshot(s: ScreenshotInfo): string {
  for (const raw of [s.date, s.timestamp]) {
    if (!raw) continue;
    const key = extractCalendarDayKey(String(raw));
    if (key) return key;
  }
  const fallback = String(s.date || s.timestamp || 'unknown');
  return `__unparsed__${fallback}`;
}

export function formatDateGroupTitle(groupKey: string): string {
  if (groupKey.startsWith('__unparsed__')) {
    const raw = groupKey.slice('__unparsed__'.length);
    return raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const iso = groupKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return `${iso[2]}${iso[3]}`;
  }

  return groupKey
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function groupScreenshotsByDate(screenshots: ScreenshotInfo[]): Map<string, ScreenshotInfo[]> {
  const grouped = new Map<string, ScreenshotInfo[]>();
  screenshots.forEach((screenshot) => {
    const key = calendarDayKeyForScreenshot(screenshot);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(screenshot);
  });
  return grouped;
}

export function generateDateGroup(date: string, screenshots: ScreenshotInfo[]): string {
  const sortedScreenshots = [...screenshots].sort((a, b) => {
    return a.displayTimestamp.localeCompare(b.displayTimestamp);
  });
  return `
  <div class="date-group">
    <div class="date-title">${formatDateGroupTitle(date)}</div>
    <div class="screenshot-grid">
      ${sortedScreenshots.map((s) => generateScreenshotCard(s)).join('')}
    </div>
  </div>`;
}

export function generateScreenshotCard(screenshot: ScreenshotInfo): string {
  return `
  <div class="screenshot-card">
    <div class="screenshot-time">${screenshot.displayTimestamp}</div>
    <img class="screenshot-image" src="${screenshot.relativePath}" alt="${screenshot.stepName}" loading="lazy" onclick="openModal('${screenshot.relativePath}')">
  </div>`;
}

export function groupImageComparisonsByCalendarDay(
  comparisons: ImageComparison[],
): Map<string, ImageComparison[]> {
  const grouped = new Map<string, ImageComparison[]>();
  comparisons.forEach((c) => {
    const key =
      extractCalendarDayKey(c.image1Path) ||
      extractCalendarDayKey(c.image2Path) ||
      '__unparsed__其他';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(c);
  });
  return grouped;
}

/** 同一步骤下多张子图：before 先于 after（文件名后缀 -before / -after） */
export function compareScreenshotSubsectionNames(a: string, b: string): number {
  const aBefore = a.endsWith('-before');
  const bBefore = b.endsWith('-before');
  const aAfter = a.endsWith('-after');
  const bAfter = b.endsWith('-after');
  if (aBefore && bAfter) return -1;
  if (aAfter && bBefore) return 1;
  if (a.startsWith('before') && !b.startsWith('before')) return -1;
  if (!a.startsWith('before') && b.startsWith('before')) return 1;
  return a.localeCompare(b, 'zh-CN');
}

export function groupScreenshotsByBrowser(screenshots: ScreenshotInfo[]): Map<string, ScreenshotInfo[]> {
  const grouped = new Map<string, ScreenshotInfo[]>();
  screenshots.forEach((screenshot) => {
    const browser = screenshot.browser || 'unknown';
    if (browser === 'firefox') {
      return;
    }
    if (!grouped.has(browser)) {
      grouped.set(browser, []);
    }
    grouped.get(browser)!.push(screenshot);
  });
  return grouped;
}
