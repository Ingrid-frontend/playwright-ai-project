import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isLoginLikeRoute } from '../../src/utils/login-detection.js';
import { runTimestampSortKey } from './baseline-comparisons.js';

export interface ScreenshotInfo {
  path: string;
  relativePath: string;
  timestamp: string;
  date: string;
  displayTimestamp: string;
  type: 'pom' | 'optimized';
  stepName: string;
  browser?: string;
  route?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MENU_ITEMS = JSON.parse(fs.readFileSync(path.join(__dirname, '../../datasource/menu_items.json'), 'utf-8'));
const MENU_ROUTES = JSON.parse(fs.readFileSync(path.join(__dirname, '../../datasource/menu_routes.json'), 'utf-8'));

export function getMenuNameByRoute(route: string): string {
  const normalizedRoute = '/' + route.replace(/_/g, '/');

  for (const [key, routeValue] of Object.entries(MENU_ROUTES)) {
    if (routeValue === normalizedRoute) {
      return MENU_ITEMS[key] || '';
    }
  }

  return '';
}

/** 从运行目录名解析展示用时间（支持 ISO 与旧版目录名） */
export function formatDisplayTimestampFromRunDir(runDirName: string): string {
  const iso = runDirName.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (iso) {
    const utc = Date.parse(`${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:${iso[6]}Z`);
    if (!Number.isNaN(utc)) {
      const local = new Date(utc + 8 * 60 * 60 * 1000);
      return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}:${String(local.getUTCSeconds()).padStart(2, '0')}`;
    }
  }

  const legacy = runDirName.match(/(\d{2})-(\d{2})-(\d{2})-/);
  if (legacy) {
    const hours = Number.parseInt(legacy[1], 10);
    const minutes = Number.parseInt(legacy[2], 10);
    const seconds = Number.parseInt(legacy[3], 10);
    const dateObj = new Date();
    dateObj.setHours(hours, minutes, seconds, 0);
    const adjustedDate = new Date(dateObj.getTime() + 8 * 60 * 60 * 1000);
    return `${String(adjustedDate.getHours()).padStart(2, '0')}:${String(adjustedDate.getMinutes()).padStart(2, '0')}:${String(adjustedDate.getSeconds()).padStart(2, '0')}`;
  }

  return runDirName;
}

export function getRouteDisplayName(route: string): string {
  for (const [key, routeValue] of Object.entries(MENU_ROUTES)) {
    const normalizedRouteValue = String(routeValue).replace(/\//g, '_').replace(/^_/, '');
    if (normalizedRouteValue === route) {
      return MENU_ITEMS[key] || route;
    }
  }

  return route;
}

export function isLoginScreenshotCandidate(fileName: string, route?: string): boolean {
  if (route && isLoginLikeRoute(route)) return true;
  const normalized = fileName.replace(/\\/g, '/').toLowerCase();
  return /(^|[_/.-])login([_/.-]|$)/i.test(normalized) || /__.*login.*\.png$/i.test(normalized);
}

/** 按运行时间戳升序，最早一次作为基线 */
export function sortScreenshotsByRunTime(screenshots: ScreenshotInfo[]): ScreenshotInfo[] {
  return [...screenshots].sort((a, b) => {
    const ta = runTimestampSortKey(a.timestamp);
    const tb = runTimestampSortKey(b.timestamp);
    if (ta !== tb) return ta - tb;
    return a.path.localeCompare(b.path);
  });
}

/** 与 getAllScreenshots 中 stepName 规则一致；勿依赖文件名里必须有 `__` */
export function extractStepNameFromPath(imagePath: string): string {
  const base = path.basename(imagePath.replace(/\\/g, '/'));
  const m = base.match(/^step-\d+-(.+)\.png$/);
  if (!m) return 'unknown';
  const rest = m[1];
  const routeMatch = rest.match(/^(.+)__(.+)$/);
  return routeMatch ? routeMatch[1] : rest;
}

export function routeFromScreenshotPath(imagePath: string): string {
  const base = path.basename(imagePath.replace(/\\/g, '/'));
  const m = base.match(/^step-\d+-(.+)\.png$/);
  if (!m) return '';
  const routeMatch = m[1].match(/^(.+)__(.+)$/);
  return routeMatch ? routeMatch[2] : '';
}

export function extractImageLabelWithRoute(imagePath: string, index: number): string {
  const timeMatch = imagePath.match(/(\d{2}-\d{2}-\d{2})-/);
  if (timeMatch) {
    const [hh, mm, ss] = timeMatch[1].split('-').map(Number);
    const dateObj = new Date();
    dateObj.setHours(hh, mm, ss, 0);
    const adjustedDate = new Date(dateObj.getTime() + 8 * 60 * 60 * 1000);
    const timeStrAdjusted = `${String(adjustedDate.getHours()).padStart(2, '0')}:${String(adjustedDate.getMinutes()).padStart(2, '0')}:${String(adjustedDate.getSeconds()).padStart(2, '0')}`;

    const routeMatch = imagePath.match(/__(.+)\.png$/);
    if (routeMatch) {
      const route = routeMatch[1];
      const routeDisplayName = getRouteDisplayName(route);
      if (route !== routeDisplayName) {
        return `${timeStrAdjusted} (${routeDisplayName})`;
      }
    }

    return timeStrAdjusted;
  }
  return `图片 ${index}`;
}

export function escapeHtmlAttr(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 从脚本目录名中解析时间戳（如 我的审批_2026-04-23_19-29-05），用于 Tab 排序。
 * 取字符串中最后一次匹配的 YYYY-MM-DD_HH-MM-SS；无时戳返回 0。
 */
export function scriptDirTimestampMs(scriptDir: string): number {
  const re = /(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(scriptDir)) !== null) {
    const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}`);
    if (!Number.isNaN(t)) last = t;
  }
  return last;
}
