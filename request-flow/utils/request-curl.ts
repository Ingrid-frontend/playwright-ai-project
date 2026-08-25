import type { Request } from '@playwright/test';

const SKIP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'transfer-encoding',
]);

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

export function requestToCurl(request: Request): string {
  const method = request.method().toUpperCase();
  const url = request.url();
  const lines = [`curl -X ${method} ${shellQuote(url)}`];

  for (const [key, value] of Object.entries(request.allHeaders())) {
    if (SKIP_HEADERS.has(key.toLowerCase())) continue;
    lines.push(`  -H ${shellQuote(`${key}: ${value}`)}`);
  }

  const postData = request.postData();
  if (postData && method !== 'GET' && method !== 'HEAD') {
    lines.push(`  --data-raw ${shellQuote(postData)}`);
  }

  return lines.join(' \\\n');
}
