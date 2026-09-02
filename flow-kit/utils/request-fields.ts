import type { Request, Response } from '@playwright/test';

const TRACE_HEADER_KEYS = [
  'spanid',
  'span-id',
  'x-b3-spanid',
  'x-b3-traceid',
  'x-b3-parentspanid',
  'traceid',
  'trace-id',
  'x-request-id',
  'x-trace-id',
  'request-id',
  'sw8',
  'uber-trace-id',
  'x-correlation-id',
];

/** 归一化追踪字段名，避免 span-id / x-b3-spanid 等多名重复 */
function normalizeTraceKey(raw: string): string {
  const k = raw.toLowerCase().replace(/^x-b3-/, '').replace(/-/g, '');
  if (k === 'spanid') return 'spanid';
  if (k === 'parentspanid') return 'parentSpanId';
  if (k === 'traceid') return 'traceid';
  if (k === 'requestid') return 'requestId';
  if (k === 'correlationid') return 'correlationId';
  if (raw.toLowerCase() === 'sw8') return 'sw8';
  if (raw.toLowerCase() === 'uber-trace-id') return 'uberTraceId';
  return raw;
}

function pickHeader(headers: Record<string, string>, name: string): string {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower && v?.trim()) return v.trim();
  }
  return '';
}

function collectTraceHeaders(headers: Record<string, string>, out: Record<string, string>) {
  for (const key of TRACE_HEADER_KEYS) {
    const v = pickHeader(headers, key);
    if (!v) continue;
    const label = normalizeTraceKey(key);
    if (!out[label]) out[label] = v;
  }
}

/**
 * 仅提取排查用唯一字段：hlyRequestID + spanid/traceid 等。
 * 不重复 host/path/roleType（已在 URL 行体现）。
 */
export function extractRequestFields(request: Request, response?: Response): Record<string, string> {
  const fields: Record<string, string> = {};
  const url = request.url();

  try {
    const u = new URL(url);
    const hly =
      u.searchParams.get('hlyRequestID') ||
      u.searchParams.get('hlyrequestid') ||
      '';
    if (hly) fields.hlyRequestID = hly;
  } catch {
    /* ignore */
  }

  collectTraceHeaders(request.headers(), fields);
  if (response) {
    try {
      collectTraceHeaders(response.headers(), fields);
    } catch {
      /* ignore */
    }
  }

  // spanid 与 traceid 同值时只保留 spanid
  if (fields.spanid && fields.traceid && fields.spanid === fields.traceid) {
    delete fields.traceid;
  }

  return fields;
}

export function formatRequestFields(fields: Record<string, string> | undefined): string {
  if (!fields || !Object.keys(fields).length) return '';
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}
