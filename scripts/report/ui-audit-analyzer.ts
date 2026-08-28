import fs from 'fs';
import path from 'path';
import { fetchWithRetry } from '../feishu/index.js';
import { buildChatCompletionsUrl } from '../../src/ai/llm-client.js';
import type { StepMeta } from './structure-check.js';
import {
  buildAuditSystemPrompt,
  buildAuditUserPrompt,
  type AuditStepContext,
} from './ui-audit-prompt.js';
import {
  normalizeAuditResult,
  verdictFromIssues,
  type AuditIssue,
  type AuditResult,
} from './ui-audit-schema.js';

const MAX_IMAGE_BYTES = 4_500_000;

type MediaType = 'image/png' | 'image/jpeg' | 'image/webp';

interface ImagePart {
  mediaType: MediaType;
  data: string;
}

export function readImageAsBase64(filePath: string): ImagePart | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    const ext = path.extname(filePath).toLowerCase();
    const mediaType: MediaType =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/png';
    return { mediaType, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

export function canRunAiAudit(): boolean {
  return Boolean(resolveVisionApiKey());
}

function envValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * 视觉审计的 API Key。
 * 优先 AI_API_KEY（本模块专用），回退到项目既有的 OpenAI 兼容配置，
 * 这样 .env 里已配好火山方舟 / OpenAI 的用户无需重复配一份。
 */
export function resolveVisionApiKey(): string | undefined {
  return envValue('AI_API_KEY', 'AI_TEST_OPENAI_API_KEY', 'OPENAI_API_KEY');
}

export interface VisionConfig {
  apiKey: string;
  model: string;
  url: string;
}

/** 解析 OpenAI 兼容视觉接口配置；缺 Key 返回 null 由调用方降级 */
export function resolveVisionConfig(): VisionConfig | null {
  const apiKey = resolveVisionApiKey();
  if (!apiKey) return null;
  const model =
    envValue('AI_VISION_MODEL', 'AI_MODEL', 'AI_TEST_MODEL', 'OPENAI_MODEL') || 'gpt-4o-mini';
  const baseUrl = envValue(
    'AI_BASE_URL',
    'AI_TEST_OPENAI_BASE_URL',
    'OPENAI_API_BASE',
    'OPENAI_BASE_URL',
  );
  return { apiKey, model, url: buildChatCompletionsUrl(baseUrl, 'https://api.openai.com') };
}

/** AI_AUDIT_MOCK=1 强制 mock；=0 强制真跑；未设置时无 key 自动降级 */
export function shouldUseMock(): boolean {
  const flag = process.env.AI_AUDIT_MOCK?.trim();
  if (flag === '1' || flag?.toLowerCase() === 'true') return true;
  if (flag === '0' || flag?.toLowerCase() === 'false') return false;
  return !canRunAiAudit();
}

/**
 * Mock 分析：不调模型，用 StepMeta 里的确定性信号推断问题。
 * 用于无 key 环境下验证全链路，也可作为 AI 不可用时的兜底。
 */
export function mockAnalyze(meta: StepMeta): AuditResult {
  const issues: AuditIssue[] = [];
  let seq = 0;
  const nextId = () => `uia-${++seq}`;

  // 无任何可判定信号 → 明确标记未审计，而不是谎报"通过"
  if (!hasRuleSignals(meta)) {
    return {
      score: 0,
      verdict: 'skipped',
      source: 'mock',
      issues: [
        {
          id: nextId(),
          type: 'other',
          severity: 'info',
          selector: '',
          bbox: null,
          description:
            '缺少可判定信号（无关键选择器/布局/错误信息），mock 模式无法给出结论，请启用 AI 视觉分析',
          confidence: 1,
        },
      ],
    };
  }

  const vp = meta.viewport;
  const viewW = vp?.width ?? meta.imageWidth ?? 0;
  const viewH = vp?.height ?? meta.imageHeight ?? 0;

  for (const err of meta.pageErrors ?? []) {
    issues.push({
      id: nextId(),
      type: 'console',
      severity: 'blocker',
      selector: '',
      bbox: null,
      description: `页面错误: ${String(err).slice(0, 100)}`,
      confidence: 0.95,
    });
  }

  for (const err of meta.consoleErrors ?? []) {
    issues.push({
      id: nextId(),
      type: 'console',
      severity: 'warning',
      selector: '',
      bbox: null,
      description: `控制台错误: ${String(err).slice(0, 100)}`,
      confidence: 0.85,
    });
  }

  const layout = meta.layout ?? {};
  if (layout.horizontalOverflow) {
    const px =
      layout.scrollWidth && layout.innerWidth ? layout.scrollWidth - layout.innerWidth : undefined;
    issues.push({
      id: nextId(),
      type: 'overflow',
      severity: 'warning',
      selector: 'document',
      bbox: viewW && viewH ? { x: 0, y: 0, width: viewW, height: viewH } : null,
      description: `检测到横向溢出${px != null ? ` ${px}px` : ''}，可能存在元素超出视口`,
      confidence: 0.85,
    });
  }

  for (const [key, info] of Object.entries(meta.selectors ?? {})) {
    if (!info) continue;
    if (!info.exists) {
      issues.push({
        id: nextId(),
        type: 'missing-element',
        severity: 'blocker',
        selector: key,
        bbox: null,
        description: `关键元素缺失: ${key}`,
        confidence: 0.9,
      });
      continue;
    }
    const b = info.bbox;
    if (!b) continue;
    if (b.width <= 0 || b.height <= 0) {
      issues.push({
        id: nextId(),
        type: 'component',
        severity: 'warning',
        selector: key,
        bbox: null,
        description: `元素尺寸异常（宽或高为 0）: ${key}`,
        confidence: 0.8,
      });
      continue;
    }
    if (viewW > 0 && b.x + b.width > viewW + 1) {
      issues.push({
        id: nextId(),
        type: 'overflow',
        severity: 'warning',
        selector: key,
        bbox: b,
        description: `元素超出视口右边界: ${key}`,
        confidence: 0.8,
      });
    }
  }

  return normalizeAuditResult(
    { issues, verdict: verdictFromIssues(issues) },
    'mock',
  );
}

/**
 * 判断 StepMeta 是否含**足以支撑结论**的判定信号。
 * 注意：layout.horizontalOverflow=false 只是"这一项没问题"，不足以证明整页健康，
 * 因此不算有效信号——否则会把"没检测出问题"谎报成"通过"（假绿）。
 * 只有关键选择器检查或运行时错误信息才构成可下结论的依据。
 */
export function hasRuleSignals(meta: StepMeta): boolean {
  if ((meta.consoleErrors ?? []).length > 0) return true;
  if ((meta.pageErrors ?? []).length > 0) return true;
  // 溢出为真是实打实的缺陷信号；为假不足以佐证整体健康
  if (meta.layout?.horizontalOverflow === true) return true;
  const selectors = Object.values(meta.selectors ?? {}).filter(Boolean);
  return selectors.length > 0;
}

function parseAuditJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const match = body.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`模型返回非 JSON: ${body.slice(0, 200)}`);
    return JSON.parse(match[0]);
  }
}

function visionContent(
  images: { label?: string; image: ImagePart }[],
  userPrompt: string,
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  for (const item of images) {
    if (item.label) content.push({ type: 'text', text: item.label });
    content.push({
      type: 'image_url',
      image_url: { url: `data:${item.image.mediaType};base64,${item.image.data}` },
    });
  }
  content.push({ type: 'text', text: userPrompt });
  return content;
}

async function callVision(
  system: string,
  userPrompt: string,
  images: { label?: string; image: ImagePart }[],
  config: VisionConfig,
): Promise<string> {
  const res = await fetchWithRetry(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: images.length > 1 ? 2000 : 1500,
      temperature: 0,
      stream: false,
      // 部分兼容网关支持该字段强制 JSON；不支持时会忽略，prompt 里也已约定纯 JSON 输出
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: visionContent(images, userPrompt),
        },
      ],
    }),
    timeout: 90_000,
    retries: 1,
  });

  if (!res.ok) {
    throw new Error(`视觉接口 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (json.error?.message) throw new Error(json.error.message.slice(0, 200));
  return json.choices?.[0]?.message?.content || '';
}

function withInfo(result: AuditResult, description: string): AuditResult {
  return {
    ...result,
    issues: [
      ...result.issues,
      {
        id: `uia-info-${result.issues.length + 1}`,
        type: 'other',
        severity: 'info',
        selector: '',
        bbox: null,
        description,
        confidence: 1,
      },
    ],
  };
}

/**
 * 审计单张截图。mock 模式或无 key 时走规则推断；
 * AI 调用失败时降级为 mock 结果并附带一条 info 说明，不中断整体流程。
 * 传入 figmaImagePath 时走双图对比（Figma 为基准）。
 */
export async function auditStep(
  screenshotPath: string,
  meta: StepMeta,
  ctx: AuditStepContext,
  opts?: { figmaImagePath?: string },
): Promise<AuditResult> {
  const figmaPath = opts?.figmaImagePath;
  if (shouldUseMock()) {
    const fallback = mockAnalyze(meta);
    return figmaPath
      ? withInfo(fallback, '已提供 Figma 基准但 mock 无法对比，请启用 AI 视觉')
      : fallback;
  }

  const config = resolveVisionConfig();
  if (!config) {
    const fallback = mockAnalyze(meta);
    return figmaPath
      ? withInfo(fallback, '已提供 Figma 基准但当前无视觉模型，已降级为规则分析')
      : fallback;
  }

  const image = readImageAsBase64(screenshotPath);
  if (!image) {
    return withInfo(mockAnalyze(meta), '截图不可读或超出大小限制，已降级为规则分析');
  }

  const figmaImage = figmaPath ? readImageAsBase64(figmaPath) : null;
  const hasFigma = Boolean(figmaImage);
  const visionImages = hasFigma && figmaImage
    ? [
        { label: '【图1 · Figma 设计稿】', image: figmaImage },
        { label: '【图2 · 实际页面截图】', image },
      ]
    : [{ image }];

  try {
    const text = await callVision(
      buildAuditSystemPrompt({
        hasFigma,
        hasHelios: Boolean(ctx.helios?.tokensSummary || ctx.helios?.layoutRules?.length),
      }),
      buildAuditUserPrompt(meta, ctx),
      visionImages,
      config,
    );
    return { ...normalizeAuditResult(parseAuditJson(text), 'ai'), baseline: hasFigma ? 'figma' : 'none' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`⚠️  AI 审计失败 (${ctx.stepName}): ${msg.slice(0, 140)}`);
    return withInfo(mockAnalyze(meta), `AI 审计失败，已降级为规则分析: ${msg.slice(0, 80)}`);
  }
}
