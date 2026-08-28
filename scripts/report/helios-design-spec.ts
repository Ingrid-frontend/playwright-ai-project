import fs from 'fs';
import path from 'path';

const TOKENS_PATH = path.join('config', 'helios-design-tokens.json');
const BINDINGS_PATH = path.join('config', 'helios-audit-bindings.json');

export interface HeliosBinding {
  script: string;
  step: string;
  figmaNodeId: string;
  figmaPage?: string;
  layout?: string[];
}

export interface HeliosAuditContext {
  enabled: boolean;
  tokensSummary?: string;
  layoutRules?: string[];
  figmaPage?: string;
}

interface HeliosTokensFile {
  colors?: Array<{ name: string; hex?: string }>;
  typography?: Array<{ name: string; fontSize?: number; fontWeight?: number }>;
  semantic?: { text?: string[]; background?: string[]; icon?: string[] };
}

interface HeliosBindingsFile {
  bindings?: HeliosBinding[];
}

let tokensCache: HeliosTokensFile | null | undefined;
let bindingsCache: HeliosBinding[] | undefined;

function readJson<T>(rel: string): T | null {
  const abs = path.resolve(process.cwd(), rel);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function loadHeliosTokens(): HeliosTokensFile | null {
  if (tokensCache !== undefined) return tokensCache;
  tokensCache = readJson<HeliosTokensFile>(TOKENS_PATH);
  return tokensCache;
}

export function loadHeliosBindings(): HeliosBinding[] {
  if (bindingsCache) return bindingsCache;
  const json = readJson<HeliosBindingsFile>(BINDINGS_PATH);
  bindingsCache = Array.isArray(json?.bindings)
    ? json!.bindings!.filter((b) => b.script && b.step)
    : [];
  return bindingsCache;
}

function matchBinding(
  bindings: HeliosBinding[],
  scriptKey: string,
  stepName: string,
  stepNumber?: number,
): HeliosBinding | null {
  const script = String(scriptKey || '');
  const step = String(stepName || '');
  const num = stepNumber != null ? String(stepNumber) : '';
  for (const item of bindings) {
    if (!script.includes(item.script) && item.script !== script) continue;
    if (item.step === num || step.includes(item.step) || step === item.step) return item;
  }
  return null;
}

function pickColor(tokens: HeliosTokensFile, pattern: RegExp): string | undefined {
  const hit = tokens.colors?.find((c) => pattern.test(c.name) && c.hex);
  return hit ? `${hit.name} ${hit.hex}` : undefined;
}

function pickTypo(tokens: HeliosTokensFile, pattern: RegExp): string | undefined {
  const hit = tokens.typography?.find((t) => pattern.test(t.name));
  if (!hit) return undefined;
  const parts = [hit.name];
  if (hit.fontSize) parts.push(`${hit.fontSize}px`);
  if (hit.fontWeight) parts.push(`w${hit.fontWeight}`);
  return parts.join(' ');
}

/** 压缩 Token 摘要，控制 prompt 体积 */
export function buildHeliosTokensSummary(tokens: HeliosTokensFile | null): string | undefined {
  if (!tokens) return undefined;
  const lines: string[] = [];

  const primary = pickColor(tokens, /Neutral-10|文本.*主要/);
  const secondary = pickColor(tokens, /Neutral-7|次要/);
  const placeholder = pickColor(tokens, /Neutral-5|辅助|占位/);
  const brand = pickColor(tokens, /Blue-6|主色/);
  const link = pickColor(tokens, /Blue-6|链接/);
  const error = pickColor(tokens, /Warning-6|错误/);
  const bg = pickColor(tokens, /背景/);

  if (primary) lines.push(`主要文本: ${primary}`);
  if (secondary) lines.push(`次要文本: ${secondary}`);
  if (placeholder) lines.push(`辅助/占位: ${placeholder}`);
  if (brand) lines.push(`主题色: ${brand}`);
  if (link && link !== brand) lines.push(`链接色: ${link}`);
  if (error) lines.push(`错误色: ${error}`);
  if (bg) lines.push(`页面背景: ${bg}`);

  const title = pickTypo(tokens, /一级标题|24/);
  const body = pickTypo(tokens, /正文.*14|辅助标题/);
  if (title) lines.push(`标题: ${title}`);
  if (body) lines.push(`正文: ${body}`);

  for (const t of tokens.semantic?.text?.slice(0, 4) ?? []) {
    lines.push(t);
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}

export function resolveHeliosAuditContext(
  scriptKey: string,
  stepName: string,
  stepNumber?: number,
): HeliosAuditContext {
  const tokens = loadHeliosTokens();
  const binding = matchBinding(loadHeliosBindings(), scriptKey, stepName, stepNumber);
  const tokensSummary = buildHeliosTokensSummary(tokens);
  const layoutRules = binding?.layout?.length ? binding.layout : undefined;

  if (!tokensSummary && !layoutRules) {
    return { enabled: false };
  }

  return {
    enabled: true,
    tokensSummary,
    layoutRules,
    figmaPage: binding?.figmaPage,
  };
}

/** 测试或热更新时清缓存 */
export function clearHeliosSpecCache(): void {
  tokensCache = undefined;
  bindingsCache = undefined;
}
