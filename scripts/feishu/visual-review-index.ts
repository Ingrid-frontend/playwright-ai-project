import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ReviewTransport } from './deliver-visual-review.js';

export type ReviewTarget = { app: string; table: string; origin: string };
export function reviewTargetKey(target: ReviewTarget): string {
  return createHash('sha256').update(JSON.stringify(target)).digest('hex').slice(0, 24);
}

export function reviewReceiptPath(target: ReviewTarget, deliveryId: string, stateDir = 'results/visual-review-deliveries'): string {
  const key = createHash('sha256').update(deliveryId).digest('hex');
  return path.resolve(stateDir, reviewTargetKey(target), `${key}.json`);
}

type Entry = { id: string; title: string; url: string };
type IndexState = { documentId?: string; blockId?: string; pending?: string; entries: Entry[] };

/** 索引只写专属文本块，不覆盖交付正文或用户添加的其他块。 */
export async function updateVisualReviewIndex(
  target: ReviewTarget, entry: Entry, stateDir: string, service: ReviewTransport,
): Promise<string> {
  const file = path.resolve(stateDir, reviewTargetKey(target), 'index.json');
  const state: IndexState = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { entries: [] };
  if (state.pending) throw new Error(`固定入口写入结果未知：${state.pending}，请人工核对回执，禁止重放`);
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2)); fs.renameSync(`${file}.tmp`, file);
  };
  if (!state.documentId) {
    state.pending = 'create-index-document'; save();
    const data = await service.api('docx/v1/documents', 'POST', {
      title: '申请单视觉复核 · 报告入口',
      ...(process.env.FEISHU_DOC_FOLDER_TOKEN ? { folder_token: process.env.FEISHU_DOC_FOLDER_TOKEN } : {}),
    });
    if (!data.document?.document_id) throw new Error('固定入口缺少文档 ID');
    state.documentId = data.document.document_id; delete state.pending; save();
  }
  const doc = state.documentId;
  if (!state.blockId) {
    state.pending = 'create-index-block'; save();
    const data = await service.api(`docx/v1/documents/${doc}/blocks/${doc}/children`, 'POST', {
      children: [{ block_type: 2, text: { elements: [{ text_run: { content: '报告入口初始化中' } }] } }], index: -1,
    });
    if (!data.children?.[0]?.block_id) throw new Error('固定入口缺少正文块 ID');
    state.blockId = data.children[0].block_id; delete state.pending; save();
  }
  const existing = state.entries.find(e => e.id === entry.id);
  if (existing && existing.url !== entry.url) throw new Error('同一交付指向不同文档，请核对回执');
  // 重试历史交付不将其提升为最新交付。首次登记先持久化，再幂等更新远端。
  if (!existing) { state.entries.unshift(entry); save(); }
  const elements = [
    { text_run: { content: '最新正式交付（按首次发布顺序）\n' } },
    { text_run: { content: state.entries[0].title, text_element_style: { link: { url: state.entries[0].url } } } },
    { text_run: { content: '\n\n历史交付\n' } },
    ...state.entries.slice(1).flatMap(e => [
      { text_run: { content: e.title, text_element_style: { link: { url: e.url } } } },
      { text_run: { content: '\n' } },
    ]),
  ];
  if (state.entries.length > 100) throw new Error('入口超过 100 次交付，请先规划历史归档；本次交付报告已保留');
  await service.api(`docx/v1/documents/${doc}/blocks/${state.blockId}`, 'PATCH', { update_text_elements: { elements } });
  const check = await service.api(`docx/v1/documents/${doc}/blocks/${state.blockId}`);
  // get block 使用 block 字段；没有明确回读结果不报告入口更新成功。
  const actual = check.block?.text?.elements;
  if (JSON.stringify(actual?.map(e => [e.text_run.content, e.text_run.text_element_style?.link?.url])) !==
      JSON.stringify(elements.map(e => [e.text_run.content, e.text_run.text_element_style?.link.url]))) {
    throw new Error('固定入口链接回读不一致，请重试入口同步');
  }
  return `${target.origin}/docx/${doc}`;
}
