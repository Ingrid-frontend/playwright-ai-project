import { fetchWithRetry } from './feishu-utils.js';
import type { DeliveryPayload, DeliveryItem } from '../report/customer-delivery-payload.js';

/** 飞书 docx block_type 枚举（仅列本项目用到的） */
export const DOC_BLOCK_TYPE = {
  page: 1,
  text: 2,
  heading1: 3,
  heading2: 4,
  heading3: 5,
  bullet: 12,
  divider: 19,
  image: 21,
} as const;

export type DocTextStyle = { bold?: boolean; italic?: boolean };

export type DocElement = {
  text_run: { content: string; text_element_style?: DocTextStyle };
};

export type DocBlock = {
  block_type: number;
  text?: { elements: DocElement[]; style?: Record<string, unknown> };
  heading1?: { elements: DocElement[] };
  heading2?: { elements: DocElement[] };
  heading3?: { elements: DocElement[] };
  bullet?: { elements: DocElement[] };
  image?: { token: string; width?: number; height?: number };
  divider?: Record<string, never>;
};

function run(content: string, style?: DocTextStyle): DocElement {
  return { text_run: { content, ...(style ? { text_element_style: style } : {}) } };
}

function text(content: string, style?: DocTextStyle): DocBlock {
  return { block_type: DOC_BLOCK_TYPE.text, text: { elements: [run(content, style)] } };
}

function heading(level: 1 | 2 | 3, content: string): DocBlock {
  const elements = [run(content)];
  if (level === 1) return { block_type: DOC_BLOCK_TYPE.heading1, heading1: { elements } };
  if (level === 2) return { block_type: DOC_BLOCK_TYPE.heading2, heading2: { elements } };
  return { block_type: DOC_BLOCK_TYPE.heading3, heading3: { elements } };
}

function bullet(content: string): DocBlock {
  return { block_type: DOC_BLOCK_TYPE.bullet, bullet: { elements: [run(content)] } };
}

/** 空行占位，替代 descendant 不支持的 divider 做视觉分隔 */
function spacer(): DocBlock {
  return { block_type: DOC_BLOCK_TYPE.text, text: { elements: [run('')] } };
}

const KIND_PREFIX: Record<DeliveryItem['kind'], string> = {
  regress: '需要修复',
  minor: '无需处理',
  pass: '完全一致',
  uncovered: '待建基线',
};

export function buildCustomerDocTitle(payload: DeliveryPayload): string {
  const ctx = [payload.envLabel, payload.releaseTag ? `v${payload.releaseTag}` : ''].filter(Boolean).join(' · ');
  const date = payload.generatedAt.split(' ')[0] || payload.generatedAt;
  return ctx ? `UI 验收检测报告 · ${ctx} · ${date}` : `UI 验收检测报告 · ${date}`;
}

/**
 * 构建客户验收文档的正文块。
 * 顺序：结论 → 问题清单（文字结论）→ 建议操作 → 检测范围。
 * 证据截图不上传文档：docx descendant 不支持 image/divider 块（1770029/1770001），
 * 图片以附件形式存放在「UI 验收明细」多维表对应记录中，正文用文字指向明细。
 */
export function buildCustomerDocBlocks(
  payload: DeliveryPayload,
  _tokens?: Map<string, string>,
): DocBlock[] {
  const s = payload.stats;
  const blocks: DocBlock[] = [];

  blocks.push(heading(1, buildCustomerDocTitle(payload)));
  const metaLine = [
    `生成时间：${payload.generatedAt}`,
    payload.envLabel ? `环境：${payload.envLabel}` : '',
    payload.releaseTag ? `版本：v${payload.releaseTag}` : '',
  ]
    .filter(Boolean)
    .join('　|　');
  blocks.push(text(metaLine));

  blocks.push(heading(2, '一、结论'));
  blocks.push(text(payload.headline, { bold: true }));
  blocks.push(text(`发版建议：${payload.shipAdviceLabel}`));
  const coverageLine =
    `检测覆盖 ${s.coveragePct}%（已对比 ${s.comparedSteps} / ${s.expectedSteps} 步）` +
    (s.uncoveredSteps > 0 ? `，另有 ${s.uncoveredSteps} 步待建基线未参与判定` : '');
  blocks.push(text(coverageLine));
  blocks.push(
    text(
      `需要修复 ${s.regressSteps} 步　·　无需处理 ${s.minorSteps} 步　·　完全一致 ${s.passSteps} 步　·　通过率 ${(s.passRate * 100).toFixed(1)}%`,
    ),
  );

  blocks.push(heading(2, '二、问题与证据'));
  if (payload.items.length === 0) {
    blocks.push(text('本次未发现需要展示的差异项。'));
  } else {
    for (const [i, item] of payload.items.entries()) {
      blocks.push(spacer());
      blocks.push(
        heading(
          3,
          `${i + 1}. [${KIND_PREFIX[item.kind]}] ${item.title}（${item.differenceLabel}${item.affectedSteps > 1 ? `，影响 ${item.affectedSteps} 步` : ''}）`,
        ),
      );
      blocks.push(text(`流程：${item.scriptLabel}　·　步骤：${item.stepLabel}　·　浏览器：${item.browserLabel}`));
      if (item.plainText) blocks.push(text(item.plainText));
      else if (item.reason) blocks.push(text(item.reason));
      blocks.push(text(`（基线 / 本次 / 差异证据截图见「UI 验收明细」表该页对应记录）`));
    }
  }

  blocks.push(spacer());
  blocks.push(heading(2, '三、建议操作'));
  if (payload.actionItems.length === 0) {
    blocks.push(text('无额外操作建议。'));
  } else {
    for (const item of payload.actionItems) blocks.push(bullet(item));
  }

  blocks.push(heading(2, '四、检测范围'));
  blocks.push(
    text(
      `本次共 ${s.expectedSteps} 个检测步骤，其中 ${s.comparedSteps} 步与验收基线做了比对，${s.uncoveredSteps} 步尚无验收基线。`,
    ),
  );
  if (s.uncoveredSteps > 0) {
    blocks.push(
      text(
        `未建基线的步骤不参与通过率计算。确认页面样式正确后固化基线，下次即可纳入比对。`,
      ),
    );
  }

  return blocks;
}

type FeishuResponse<T> = { code: number; msg?: string; data?: T };

async function jsonRequest<T>(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetchWithRetry(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const raw = (await res.text()).replace(/^﻿/, '');
  let data: FeishuResponse<T>;
  try {
    data = JSON.parse(raw) as FeishuResponse<T>;
  } catch {
    throw new Error(`飞书返回非 JSON：${raw.slice(0, 200)}`);
  }
  if (data.code !== 0) {
    throw new Error(`飞书 API 失败 code=${data.code} msg=${data.msg || ''}`);
  }
  return data.data as T;
}

export async function createDocxDocument(token: string, title: string): Promise<string> {
  const body: { title: string; folder_token?: string } = { title };
  const folderToken = process.env.FEISHU_DOC_FOLDER_TOKEN?.trim();
  if (folderToken) body.folder_token = folderToken;
  const data = await jsonRequest<{ document?: { document_id?: string } }>(
    'https://open.feishu.cn/open-apis/docx/v1/documents',
    token,
    { method: 'POST', body: JSON.stringify(body) },
  );
  const documentId = data.document?.document_id;
  if (!documentId) throw new Error('创建飞书文档成功但未返回 document_id');
  return documentId;
}

/**
 * 批量写入内容块。飞书单请求可携带多个 descendants，
 * 逐块写入会被频率限制拖垮（每块 500ms），这里按批提交。
 */
export async function addBlocksBatched(
  token: string,
  documentId: string,
  blocks: DocBlock[],
  batchSize = 20,
): Promise<number> {
  if (blocks.length === 0) return 0;
  let written = 0;
  for (let i = 0; i < blocks.length; i += batchSize) {
    const batch = blocks.slice(i, i + batchSize);
    const childrenId: string[] = [];
    const descendants: unknown[] = [];
    batch.forEach((block, j) => {
      const blockId = `cb_${i + j}`;
      childrenId.push(blockId);
      descendants.push({ block_id: blockId, children: [], ...block });
    });
    await jsonRequest(
      `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/descendant`,
      token,
      { method: 'POST', body: JSON.stringify({ index: -1, children_id: childrenId, descendants }) },
    );
    written += batch.length;
    if (i + batchSize < blocks.length) await new Promise((r) => setTimeout(r, 400));
  }
  return written;
}

type PublicPerm = { permission_public?: { link?: string; url?: string } };

/** 带 JSON 解析但不抛错（把失败留给调用方决策） */
async function tryRequest<T>(url: string, token: string, init: RequestInit = {}): Promise<T | null> {
  try {
    const res = await fetchWithRetry(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    const raw = (await res.text()).replace(/^\uFEFF/, '');
    const data = JSON.parse(raw) as { code: number; msg?: string; data?: T };
    return data.code === 0 ? (data.data as T) : null;
  } catch {
    return null;
  }
}

/**
 * 生成文档分享链接（多路 best-effort）：
 *  1. 老 drive/v1/files/{id}/share 已下线（404），不再使用。
 *  2. 先读 permissions/{id}/public（文档已公开时直接拿 link）。
 *  3. 未公开则尝试 PUT 设为「组织内可阅读」，再读一次。
 *  4. 应用未开通 drive:drive / docs:doc 等权限时全部失败 → 返回基础 URL 并在结果中标注需手动授权。
 */
export async function shareDocxDocument(token: string, documentId: string): Promise<string> {
  const base = `https://open.feishu.cn/open-apis/drive/v1/permissions/${documentId}/public?type=docx`;
  const fallback = `https://feishu.cn/docx/${documentId}`;

  const existing = await tryRequest<PublicPerm>(base, token, { method: 'GET' });
  const link = existing?.permission_public?.link || existing?.permission_public?.url;
  if (link) return link;

  await tryRequest(base, token, {
    method: 'PUT',
    body: JSON.stringify({
      external_access_entity: 'open',
      security_entity: 'anyone_can_view',
      comment_entity: 'anyone_can_view',
      link_share_entity: 'anyone_readable',
      invite_external: true,
    }),
  });

  const after = await tryRequest<PublicPerm>(base, token, { method: 'GET' });
  const afterLink = after?.permission_public?.link || after?.permission_public?.url;
  if (afterLink) return afterLink;

  console.warn(`  ⚠️  文档未取得公开分享链接（应用需开通 drive:drive / drive:file / docs:doc 之一）。`);
  console.warn(`     document_id=${documentId}，请在飞书内手动「分享」后使用 fallback 链接。`);
  return fallback;
}
