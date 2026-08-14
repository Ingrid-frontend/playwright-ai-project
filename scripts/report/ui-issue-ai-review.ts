import fs from 'fs';
import path from 'path';
import type { UiIssue } from './ui-issues-index.js';
import type { ReviewVerdict, UiIssueReview } from './ui-issue-review.js';
import { fetchWithRetry } from '../feishu/index.js';

const VERDICTS = new Set<ReviewVerdict>(['ui_bug', 'likely_noise', 'unstable', 'needs_human']);

type ImagePart = { mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string };

function resolveImagePath(p?: string): string | null {
  if (!p) return null;
  const candidates = [p, path.join(process.cwd(), p), path.resolve(p)];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function readImageAsBase64(filePath: string, maxBytes = 4_500_000): ImagePart | null {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length === 0 || buf.length > maxBytes) return null;
    const ext = path.extname(filePath).toLowerCase();
    const mediaType =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : 'image/png';
    return { mediaType, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

function buildPrompt(issue: UiIssue): string {
  const pct = (issue.difference * 100).toFixed(2);
  return `你是 UI 回归审查助手。根据基线图、当前图、差异图，判断是否为真实 UI 缺陷。

上下文：
- 脚本: ${issue.scriptKey}
- 步骤: ${issue.stepNumber} ${issue.stepName}
- 浏览器: ${issue.browser}
- 对比类型: ${issue.compareKind}
- 像素差异: ${pct}%
- 严重级别: ${issue.severity}
${issue.structureType ? `- 结构告警: ${issue.structureType}` : ''}
${issue.detail ? `- 详情: ${issue.detail}` : ''}

只输出一行 JSON（不要 markdown）：
{"verdict":"ui_bug|likely_noise|unstable|needs_human","reason":"不超过40字中文","confidence":0到1}

判定口径：
- ui_bug: 布局错位、元素缺失、重叠、明显样式错误
- likely_noise: 抗锯齿、字体渲染、微小闪烁、动态数据噪声
- unstable: 更像运行间不稳定/动效，而非确定缺陷
- needs_human: 信息不足或难以自动判断`;
}

function parseAiReview(text: string): UiIssueReview | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const raw = JSON.parse(jsonMatch[0]) as {
      verdict?: string;
      reason?: string;
      confidence?: number;
    };
    if (!raw.verdict || !VERDICTS.has(raw.verdict as ReviewVerdict)) return null;
    return {
      verdict: raw.verdict as ReviewVerdict,
      reason: String(raw.reason || 'AI 复审').slice(0, 80),
      confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0.6)),
      source: 'ai',
    };
  } catch {
    return null;
  }
}

async function callClaudeVision(prompt: string, images: ImagePart[], apiKey: string): Promise<string> {
  const content: Array<Record<string, unknown>> = [];
  for (const img of images) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType,
        data: img.data,
      },
    });
  }
  content.push({ type: 'text', text: prompt });

  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_VISION_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content }],
    }),
    timeout: 60_000,
    retries: 1,
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  return json.content?.find((b) => b.type === 'text')?.text || '';
}

function collectImages(issue: UiIssue): ImagePart[] {
  const out: ImagePart[] = [];
  for (const p of [issue.diffImagePath, issue.currentPath, issue.baselinePath]) {
    const abs = resolveImagePath(p);
    if (!abs) continue;
    const img = readImageAsBase64(abs);
    if (img) out.push(img);
    if (out.length >= 3) break;
  }
  return out;
}

export function canRunAiVisionReview(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/** 用 Vision 模型覆盖单条规则结论；失败返回 null（保留规则结果） */
export async function aiReviewIssue(issue: UiIssue): Promise<UiIssueReview | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const images = collectImages(issue);
  if (images.length === 0) return null;

  try {
    const text = await callClaudeVision(buildPrompt(issue), images, apiKey);
    return parseAiReview(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`⚠️  AI 复审失败 (${issue.stepName}): ${msg.slice(0, 120)}`);
    return null;
  }
}

/** 对候选问题批量 AI 复审（串行，避免打爆限流） */
export async function applyAiReviews(issues: UiIssue[]): Promise<number> {
  let updated = 0;
  for (const issue of issues) {
    const ai = await aiReviewIssue(issue);
    if (!ai) continue;
    issue.review = ai;
    updated++;
  }
  return updated;
}
