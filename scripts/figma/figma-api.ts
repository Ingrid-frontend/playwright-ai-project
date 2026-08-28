import { fetchWithRetry } from '../feishu/index.js';

const HELIOS_FILE_KEY = '86WDjDbixGJ7WtrMvvdiZn';

export function resolveFigmaToken(): string | undefined {
  for (const key of ['FIGMA_ACCESS_TOKEN', 'FIGMA_TOKEN', 'FIGMA_API_TOKEN']) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function figmaNodeUrl(fileKey: string, nodeId: string): string {
  const slug = nodeId.replace(/:/g, '-');
  return `https://www.figma.com/design/${fileKey}/Helios-Design-System?node-id=${slug}`;
}

export async function figmaGet<T>(path: string, token: string): Promise<T> {
  const res = await fetchWithRetry(`https://api.figma.com/v1${path}`, {
    headers: { 'X-Figma-Token': token },
    timeout: 60_000,
    retries: 2,
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`Figma API ${path} → HTTP ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export interface FigmaPage {
  id: string;
  name: string;
}

export interface FigmaStyleMeta {
  key: string;
  name: string;
  style_type: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';
  node_id: string;
}

export async function fetchFilePages(token: string, fileKey = HELIOS_FILE_KEY): Promise<FigmaPage[]> {
  const json = await figmaGet<{ document?: { children?: Array<{ id: string; name: string }> } }>(
    `/files/${fileKey}?depth=1`,
    token,
  );
  return (json.document?.children ?? []).map((p) => ({ id: p.id, name: p.name }));
}

export async function fetchPublishedStyles(
  token: string,
  fileKey = HELIOS_FILE_KEY,
): Promise<FigmaStyleMeta[]> {
  const json = await figmaGet<{ meta?: { styles?: Record<string, FigmaStyleMeta> } }>(
    `/files/${fileKey}/styles`,
    token,
  );
  return Object.values(json.meta?.styles ?? {});
}

type FigmaPaint = { type?: string; color?: { r: number; g: number; b: number; a?: number } };
type FigmaTextStyle = {
  fontSize?: number;
  fontWeight?: number;
  lineHeightPx?: number;
  fontFamily?: string;
};
type FigmaNodeDoc = {
  fills?: FigmaPaint[];
  style?: FigmaTextStyle;
  effects?: Array<{ type?: string; radius?: number; color?: { r: number; g: number; b: number; a?: number } }>;
};

function toHex(c?: { r: number; g: number; b: number }): string | undefined {
  if (!c) return undefined;
  const h = (n: number) =>
    Math.round(Math.max(0, Math.min(1, n)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase();
}

export function parseFillHex(node?: FigmaNodeDoc): string | undefined {
  const fill = node?.fills?.find((f) => f.type === 'SOLID' && f.color);
  return toHex(fill?.color);
}

export function parseTextStyle(node?: FigmaNodeDoc): {
  fontSize?: number;
  fontWeight?: number;
  lineHeightPx?: number;
  fontFamily?: string;
} {
  const s = node?.style ?? {};
  return {
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    lineHeightPx: s.lineHeightPx,
    fontFamily: s.fontFamily,
  };
}

export async function fetchNodes(
  token: string,
  nodeIds: string[],
  fileKey = HELIOS_FILE_KEY,
): Promise<Record<string, FigmaNodeDoc | undefined>> {
  const out: Record<string, FigmaNodeDoc | undefined> = {};
  const uniq = [...new Set(nodeIds.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 50) {
    const batch = uniq.slice(i, i + 50);
    const ids = encodeURIComponent(batch.join(','));
    const json = await figmaGet<{ nodes?: Record<string, { document?: FigmaNodeDoc }> }>(
      `/files/${fileKey}/nodes?ids=${ids}`,
      token,
    );
    for (const id of batch) {
      out[id] = json.nodes?.[id]?.document;
    }
  }
  return out;
}

export { HELIOS_FILE_KEY };
