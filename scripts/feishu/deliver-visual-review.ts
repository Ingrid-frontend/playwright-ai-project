import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { PNG } from 'pngjs';
import { loadFeishuAppConfig, getFeishuAccessToken } from './feishu-app.js';
import { fetchWithRetry } from './feishu-utils.js';
import { REVIEW_NEXT, reviewHash, type VisualReviewReport } from '../report/visual-review-report.js';
import { reviewReceiptPath, reviewTargetKey, updateVisualReviewIndex } from './visual-review-index.js';
import { envLabelFromId } from '../report/customer-report-naming.js';

type Block = {
  block_id?: string; block_type: number; image?: { token?: string; width?: number; height?: number };
  text?: { elements: Element[] }; heading1?: { elements: Element[] };
};
type Element = { text_run: { content: string; text_element_style?: { link: { url: string } } } };
type RecordData = { record_id: string; fields: Record<string, unknown> };
type ApiData = {
  block?: Block;
  document?: { document_id: string }; children?: Block[]; items?: (Block & RecordData & { field_name: string; type: number })[];
  record?: RecordData; file_token?: string; has_more?: boolean; page_token?: string;
};
export type ReviewTransport = {
  api(route: string, method?: string, body?: unknown): Promise<ApiData>;
  upload(file: string, parentType: string, parent: string): Promise<string>;
};
type Receipt = {
  hash: string; target: string; pending?: string; documentId?: string;
  blocks: Record<string, string>; media: Record<string, string>; records: Record<string, string>; verified?: boolean;
};
const text = (content: string, heading = false): Block => ({
  block_type: heading ? 3 : 2, [heading ? 'heading1' : 'text']: { elements: [{ text_run: { content } }] },
});

export function readVisualReview(file: string): VisualReviewReport {
  const report = JSON.parse(fs.readFileSync(file, 'utf8')) as VisualReviewReport;
  if (report.version !== 1 || !report.id || !report.runId || !report.scriptKey.startsWith('request-flow/') ||
      report.hash !== reviewHash(report)) throw new Error('视觉复核载荷或证据已变化，请重新生成、预览');
  if (new Set(report.items.map(i => i.key)).size !== report.items.length) throw new Error('复核项键重复');
  return report;
}

/** 仅新增明确的视觉复核表记录，不写旧验收表，不更新任何人工字段。 */
export async function publishVisualReview(
  report: VisualReviewReport, target: { app: string; table: string; origin: string },
  receiptFile: string, service: ReviewTransport,
): Promise<{ documentUrl: string; recordIds: string[] }> {
  const identity = JSON.stringify(target);
  const receipt: Receipt = fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile, 'utf8')) :
    { hash: report.hash, target: identity, blocks: {}, media: {}, records: {} };
  if (receipt.hash !== report.hash || receipt.target !== identity) throw new Error('回执与内容或目标不匹配，禁止覆盖');
  if (receipt.pending) throw new Error(`上次操作结果未知：${receipt.pending}。请人工核对远端后恢复回执，禁止自动重放。`);
  const save = () => {
    fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
    fs.writeFileSync(`${receiptFile}.tmp`, JSON.stringify(receipt, null, 2));
    fs.renameSync(`${receiptFile}.tmp`, receiptFile);
  };
  const root = `bitable/v1/apps/${target.app}/tables/${target.table}`;
  const fields = await service.api(`${root}/fields?page_size=100`);
  for (const [name, type] of Object.entries({ '复核项': 1, '复核状态': 3, '变化说明': 1, '证据图': 17,
    '处理角色': 1, '下一步': 1, '报告': 15, '运行批次': 1, '浏览器': 1, '环境': 1, '交付类型': 1, '样例键': 1 })) {
    if (!fields.items?.some(f => f.field_name === name && f.type === type)) throw new Error(`目标不是兼容的视觉复核表：${name}`);
  }
  // 非幂等写入先落 pending；超时或进程退出时停止，绝不悄悄再创建。
  const write = async <T>(key: string, action: () => Promise<T>, confirm: (result: T) => void) => {
    receipt.pending = key; save();
    const result = await action(); confirm(result); delete receipt.pending; save();
  };
  if (!receipt.documentId) await write('create-document',
    () => service.api('docx/v1/documents', 'POST', { title: report.title,
      ...(process.env.FEISHU_DOC_FOLDER_TOKEN ? { folder_token: process.env.FEISHU_DOC_FOLDER_TOKEN } : {}) }),
    data => { if (!data.document?.document_id) throw new Error('文档 ID 缺失'); receipt.documentId = data.document.document_id; });
  const doc = receipt.documentId!;
  const documentUrl = `${target.origin}/docx/${doc}`;
  const append = async (key: string, block: Block) => {
    if (!receipt.blocks[key]) await write(`append:${key}`,
      () => service.api(`docx/v1/documents/${doc}/blocks/${doc}/children`, 'POST', { children: [block], index: -1 }),
      data => { const id = data.children?.[0]?.block_id; if (!id) throw new Error('正文块 ID 缺失'); receipt.blocks[key] = id; });
    return receipt.blocks[key];
  };
  const upload = async (key: string, file: string, parentType: string, parent: string) => {
    if (!receipt.media[key]) {
      receipt.media[key] = await service.upload(file, parentType, parent); save();
    }
    return receipt.media[key];
  };
  await append('summary-title', text('复核摘要', true));
  await append('summary', text(`复核分组 ${report.items.length} 组，不代表缺陷数；尚未完成人工确认。红色表示变化，不等于缺陷。`));
  await append('review-next', text(`统一待办：${REVIEW_NEXT}`));
  await append('context', text(`${envLabelFromId(report.env)} · 运行批次 ${report.runId}`));
  for (const [index, item] of report.items.entries()) {
    await append(`${item.key}:title`, text(`${index + 1}｜${item.title}`, true));
    await append(`${item.key}:description`, text(item.description));
    if (item.next !== REVIEW_NEXT) await append(`${item.key}:next`, text(`待办：${item.next}`));
    const attachments: { file_token: string }[] = [];
    for (const [n, image] of item.images.entries()) {
      const key = `${item.key}:image:${n}`;
      await append(`${key}:caption`, text(image.label));
      const id = await append(key, { block_type: 27, image: {} });
      const token = await upload(`${key}:doc`, image.file, 'docx_image', id);
      const png = PNG.sync.read(fs.readFileSync(image.file));
      await service.api(`docx/v1/documents/${doc}/blocks/${id}`, 'PATCH', {
        replace_image: { token, width: png.width, height: png.height, align: 1 },
      });
      attachments.push({ file_token: await upload(`${key}:table`, image.file, 'bitable_image', target.app) });
    }
    if (!receipt.records[item.key]) {
      const found = await service.api(`${root}/records/search`, 'POST', {
        filter: { conjunction: 'and', conditions: [{ field_name: '样例键', operator: 'is', value: [item.key] }] },
      });
      if (found.items?.length) {
        if (found.items.length !== 1) throw new Error('远端复核键重复，请人工核对');
        receipt.records[item.key] = found.items[0].record_id; save();
      } else await write(`create-record:${item.key}`, () => service.api(`${root}/records`, 'POST', { fields: {
        '复核项': item.title, '复核状态': '待确认', '变化说明': item.description, '证据图': attachments,
        '处理角色': '测试 / 前端', '下一步': item.next, '环境': envLabelFromId(report.env),
        '报告': { text: report.title, link: documentUrl }, '运行批次': report.runId,
        '浏览器': item.browser, '交付类型': '自动视觉复核', '样例键': item.key,
      } }), data => {
        if (!data.record?.record_id) throw new Error('记录 ID 缺失'); receipt.records[item.key] = data.record.record_id;
      });
    }
    const link = `${target.origin}/base/${target.app}?table=${target.table}&record=${receipt.records[item.key]}`;
    await append(`${item.key}:link`, { block_type: 2, text: { elements: [{ text_run: {
      content: '填写复核结论', text_element_style: { link: { url: link } },
    } }] } });
  }
  await append('scope-title', text('检查范围', true));
  await append('scope', text(report.scope.join('；')));
  for (const [index, limitation] of report.limitations.entries()) await append(`limit:${index}`, text(limitation));
  const all: Block[] = [];
  let pageToken = '';
  do {
    const data = await service.api(`docx/v1/documents/${doc}/blocks?page_size=500${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`);
    all.push(...(data.items || [])); pageToken = data.has_more ? data.page_token || '' : '';
    if (data.has_more && !pageToken) throw new Error('文档分页数据不完整');
  } while (pageToken);
  for (const item of report.items) {
    for (const [index] of item.images.entries()) {
      const key = `${item.key}:image:${index}`;
      if (!all.some(b => b.block_id === receipt.blocks[key] && b.image?.token === receipt.media[`${key}:doc`])) {
        throw new Error(`文档图片回读失败：${key}`);
      }
    }
    const data = await service.api(`${root}/records/${receipt.records[item.key]}`);
    const fields = data.record?.fields;
    const images = fields?.['证据图'] as { file_token: string }[] | undefined;
    if ((fields?.['报告'] as { link?: string })?.link !== documentUrl ||
        images?.length !== item.images.length || !item.images.every((_, n) => images.some(
          im => im.file_token === receipt.media[`${item.key}:image:${n}:table`]))) throw new Error('记录附件或回链核验失败');
    const linkBlock = all.find(b => b.block_id === receipt.blocks[`${item.key}:link`]);
    if (!linkBlock?.text?.elements.some(e => e.text_run.text_element_style?.link?.url.includes(`record=${receipt.records[item.key]}`))) {
      throw new Error('文档记录链接核验失败');
    }
  }
  receipt.verified = true; save();
  return { documentUrl, recordIds: Object.values(receipt.records) };
}

async function main() {
  dotenv.config({ quiet: true });
  const args = process.argv.slice(2);
  const value = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const manifest = value('manifest');
  if (!manifest) throw new Error('需要 --manifest=.../visual-review.json；默认仅预览，--apply --approve-hash=... 才写入');
  const report = readVisualReview(manifest);
  if (!args.includes('--apply')) {
    console.log(`本地预览：${path.join(path.dirname(manifest), 'index.html')}\n待复核 ${report.items.length} 项\n审核哈希：${report.hash}`);
    return;
  }
  if (value('approve-hash') !== report.hash) throw new Error('请检查预览后通过 --approve-hash 明确批准当前内容');
  const app = process.env.FEISHU_VISUAL_REVIEW_APP_TOKEN?.trim();
  const table = process.env.FEISHU_VISUAL_REVIEW_TABLE_ID?.trim();
  const origin = process.env.FEISHU_VISUAL_REVIEW_ORIGIN?.trim();
  if (!app || !table || !origin || new URL(origin).protocol !== 'https:') throw new Error('请配置 FEISHU_VISUAL_REVIEW_APP_TOKEN / TABLE_ID / ORIGIN');
  const config = loadFeishuAppConfig(); if (!config) throw new Error('缺少飞书应用鉴权配置');
  const token = await getFeishuAccessToken(config);
  const api: ReviewTransport['api'] = async (route, method = 'GET', body) => {
    const res = await fetchWithRetry(`https://open.feishu.cn/open-apis/${route}`, {
      method, retries: 0, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await res.json() as { code: number; msg?: string; data: ApiData };
    if (!res.ok || result.code !== 0) throw new Error(`飞书 API 失败：${method} ${route} ${result.code} ${result.msg}`);
    return result.data;
  };
  const service: ReviewTransport = { api, upload: async (file, parentType, parent) => {
    const buffer = fs.readFileSync(file), form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), path.basename(file));
    for (const [k, v] of Object.entries({ file_name: path.basename(file), size: String(buffer.length), parent_type: parentType, parent_node: parent })) form.append(k, v);
    const res = await fetchWithRetry('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
      method: 'POST', retries: 0, headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    const data = await res.json() as { code: number; msg?: string; data?: { file_token?: string } };
    if (!res.ok || data.code !== 0 || !data.data?.file_token) throw new Error(`图片上传失败：${data.msg}`);
    return data.data.file_token;
  } };
  const target = { app, table, origin };
  const stateDir = path.resolve(process.env.FEISHU_VISUAL_REVIEW_STATE_DIR || 'results/visual-review-deliveries');
  fs.mkdirSync(stateDir, { recursive: true });
  const receipt = reviewReceiptPath(target, report.id, stateDir);
  // 同一目标共用锁，保护跨输出目录去重与固定入口历史顺序。
  const lock = path.join(stateDir, `${reviewTargetKey(target)}.lock`); const fd = fs.openSync(lock, 'wx');
  try {
    const legacy = path.join(path.dirname(manifest), 'feishu-receipt.json');
    if (!fs.existsSync(receipt) && fs.existsSync(legacy)) {
      fs.mkdirSync(path.dirname(receipt), { recursive: true }); fs.copyFileSync(legacy, receipt);
    }
    const result = await publishVisualReview(report, target, receipt, service);
    console.log('交付报告已核验：', result);
    const indexUrl = await updateVisualReviewIndex(target, { id: report.id, title: report.title, url: result.documentUrl }, stateDir, service);
    console.log('固定报告入口：', indexUrl);
  }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
