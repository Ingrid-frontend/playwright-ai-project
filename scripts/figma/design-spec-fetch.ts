/**
 * 从 Figma API 拉取节点 JSON（带本地缓存）。
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const FIGMA_API = 'https://api.figma.com';
const TOKEN = process.env.FIGMA_TOKEN || process.env.FIGMA_ACCESS_TOKEN || '';

export interface FigmaPaint {
  type?: string;
  visible?: boolean;
  opacity?: number;
  color?: { r: number; g: number; b: number; a?: number };
}

export interface FigmaNode {
  id?: string;
  name?: string;
  type?: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  visible?: boolean;
  opacity?: number;
  layoutMode?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  fills?: FigmaPaint[];
  style?: Record<string, unknown>;
  characters?: string;
  cornerRadius?: number;
}

export interface FetchFigmaOptions {
  token?: string;
  cacheDir?: string;
  refresh?: boolean;
  figmaUrl?: string;
}

export function parseFigmaUrl(raw: string): { fileKey: string; nodeId?: string } {
  const m = raw.match(/figma\.com\/(?:design|file|proto)\/([^/?#]+)/);
  if (!m) throw new Error(`无法解析 Figma 链接: ${raw}`);
  const fileKey = m[1]!.split('-')[0]!;
  const nodeMatch = raw.match(/[?&]node-id=([^&#]+)/);
  const nodeId = nodeMatch ? decodeURIComponent(nodeMatch[1]!) : undefined;
  return { fileKey, nodeId };
}

function canonicalNodeId(id: string): string {
  return id.replace(/-/g, ':');
}

function safeNodeId(id: string): string {
  return id.replace(/:/g, '-').replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function figmaFetch(url: string, token: string): Promise<any> {
  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Figma API ${res.status}: 非 JSON 响应 ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`Figma API ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

async function resolveNodeId(fileKey: string, nodeId: string | undefined, token: string): Promise<string> {
  if (nodeId) return canonicalNodeId(nodeId);
  const file = await figmaFetch(`${FIGMA_API}/v1/files/${fileKey}`, token);
  const firstPage = file?.document?.children?.[0];
  if (!firstPage?.id) throw new Error('Figma 文件中未找到页面节点');
  return firstPage.id;
}

/**
 * 获取单个 Figma 节点的完整 JSON，优先使用 results/figma-cache 缓存。
 */
export async function fetchFigmaNode(fileKey: string, rawNodeId: string | undefined, options: FetchFigmaOptions = {}): Promise<{
  node: FigmaNode;
  nodeId: string;
  fromCache: boolean;
}> {
  const token = options.token || TOKEN;
  const cacheDir =
    options.cacheDir ||
    path.join(process.cwd(), 'results', 'figma-cache', fileKey, safeNodeId(canonicalNodeId(rawNodeId || '0:0')));
  const cachePath = path.join(cacheDir, 'node.json');
  if (!options.refresh && fs.existsSync(cachePath)) {
    const node = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as FigmaNode;
    return { node, nodeId: node.id || rawNodeId || '', fromCache: true };
  }
  if (!token) {
    throw new Error('未配置 FIGMA_TOKEN，且本地无该节点缓存，请先导出一次或配置 Token');
  }
  const nodeId = await resolveNodeId(fileKey, rawNodeId, token);
  const url = `${FIGMA_API}/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`;
  const data = await figmaFetch(url, token);
  const node = data?.nodes?.[nodeId]?.document as FigmaNode | undefined;
  if (!node) {
    throw new Error(`Figma 节点不存在: ${nodeId}`);
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(node, null, 2), 'utf-8');
  fs.writeFileSync(
    path.join(cacheDir, 'meta.json'),
    JSON.stringify(
      { figmaUrl: options.figmaUrl || '', fileKey, nodeId, fetchedAt: new Date().toISOString() },
      null,
      2,
    ),
    'utf-8',
  );
  return { node, nodeId, fromCache: false };
}
