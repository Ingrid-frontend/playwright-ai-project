import { fetchWithRetry } from './feishu-utils.js';
import type { DeliveryPayload, DeliveryItem } from '../report/customer-delivery-payload.js';
import { resolveDeliveryImagePath } from '../report/customer-delivery-payload.js';

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

function image(token: string): DocBlock {
  return { block_type: DOC_BLOCK_TYPE.image, image: { token } };
}

function divider(): DocBlock {
  return { block_type: DOC_BLOCK_TYPE.divider, divider: {} };
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
 * 顺序：结论 → 问题清单（含证据图）→ 建议操作 → 检测范围。
 * 图片缺失时降级为一行文字说明，不留下空白块。
 */
export function buildCustomerDocBlocks(
  payload: DeliveryPayload,
  tokens: Map<string, string>,
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
      blocks.push(divider());
      blocks.push(
        heading(
          3,
          `${i + 1}. [${KIND_PREFIX[item.kind]}] ${item.title}（${item.differenceLabel}${item.affectedSteps > 1 ? `，影响 ${item.affectedSteps} 步` : ''}）`,
        ),
      );
      blocks.push(text(`流程：${item.scriptLabel}　·　步骤：${item.stepLabel}　·　浏览器：${item.browserLabel}`));
      if (item.plainText) blocks.push(text(item.plainText));
      else if (item.reason) blocks.push(text(item.reason));

      for (const img of item.images) {
        const abs = resolveDeliveryImagePath(img.relPath);
        const token = tokens.get(abs);
        if (!token) {
          blocks.push(text(`（${img.label}图未上传成功，详见本地报告）`));
          continue;
        }
        blocks.push(text(`${img.label}：`, { bold: true }));
        blocks.push(image(token));
      }
    }
  }

  blocks.push(divider());
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

export async function shareDocxDocument(token: string, documentId: string): Promise<string> {
  const data = await jsonRequest<{ share_url?: string }>(
    `https://open.feishu.cn/open-apis/drive/v1/files/${documentId}/share`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        share_entity_type: 'docx',
        share_to_client: {
          share_client_type: 'link',
          link_share_setting: {
            share_link_allow_copy: true,
            share_link_allow_comment: true,
            share_link_allow_view: true,
            share_link_public: true,
          },
        },
      }),
    },
  );
  return data.share_url || `https://feishu.cn/docx/${documentId}`;
}
