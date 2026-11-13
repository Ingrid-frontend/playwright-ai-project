import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import type { CoverageSlot } from './coverage-stats.js';
import { envLabelFromId } from './customer-report-naming.js';

type Crop = { x: number; y: number; w: number; h: number };
export function reviewStepLabel(step: string): string {
  return ({
    'request-list': '申请单列表',
    'request-search': '搜索步骤截图',
    'request-filter': '筛选展开截图',
    'request-search-result': '单号搜索结果',
    'request-filter-result': '事由筛选结果',
    'request-detail': '申请单详情',
  } as Record<string, string>)[step] || step;
}

function browserLabel(browser: string): string {
  return ({ chrome: 'Chrome', chromium: 'Chrome', webkit: 'Safari', firefox: 'Firefox' } as Record<string, string>)[browser] || browser;
}
function cropImage(image: PNG, crop: Crop): PNG {
  const out = new PNG({ width: crop.w, height: crop.h });
  PNG.bitblt(image, out, crop.x, crop.y, crop.w, crop.h, 0, 0);
  return out;
}

/** 只有坐标、基线与当前像素均相同才复用，不按整页相似度合并。 */
export function reviewRegions(slot: CoverageSlot, baseline: PNG, current: PNG): { crop: Crop; signature: string }[] {
  const width = Math.min(baseline.width, current.width), height = Math.min(baseline.height, current.height);
  return [...(slot.regions || [])].sort((a, b) =>
    Number(b.nature === 'content') - Number(a.nature === 'content') || b.pixels - a.pixels,
  ).flatMap(region => {
    const x = Math.max(0, Math.floor(region.x - 16)), y = Math.max(0, Math.floor(region.y - 16));
    const crop = { x, y, w: Math.min(width - x, Math.ceil(region.w + 32)), h: Math.min(height - y, Math.ceil(region.h + 32)) };
    if (crop.w <= 0 || crop.h <= 0) return [];
    const signature = createHash('sha256').update(JSON.stringify(crop))
      .update(cropImage(baseline, crop).data).update(cropImage(current, crop).data).digest('hex');
    return [{ crop, signature }];
  });
}

export type ReviewImage = { label: string; file: string };
export type ReviewItem = {
  key: string; title: string; browser: string; account: string; description: string;
  next: string; images: ReviewImage[];
};
export type VisualReviewReport = {
  version: 1; id: string; hash: string; env: string; runId: string; scriptKey: string;
  title: string; scope: string[]; limitations: string[]; items: ReviewItem[];
};

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const REVIEW_NEXT = '查看差异与前后对比，确认预期变化或记录缺陷依据。';

export function reviewHash(report: VisualReviewReport): string {
  // 证据绑定文件内容而非本机输出目录，同一交付搬动目录不应变成新内容。
  const snapshot = { ...report, hash: '', items: report.items.map(item => ({
    ...item, images: item.images.map(image => ({ ...image, file: path.basename(image.file) })),
  })) };
  return createHash('sha256').update(JSON.stringify(snapshot))
    .update(Buffer.concat(report.items.flatMap(i => i.images.map(image => fs.readFileSync(image.file)))))
    .digest('hex');
}

export function validateReviewScope(slots: CoverageSlot[], scriptKey: string, runId: string): string {
  const match = /^request-flow\/([^/]+)\/golden-regression\/by-account\/([^/]+)$/.exec(scriptKey);
  if (!match || !runId || !slots.length) throw new Error('视觉复核目前仅支持显式绑定申请单单账号 Golden 运行');
  for (const slot of slots) {
    const segments = slot.currentPath?.replace(/\\/g, '/').split('/') || [];
    const index = segments.indexOf('by-account');
    if (slot.scriptKey !== scriptKey || index < 0 || segments[index + 1] !== match[2] ||
        segments[index + 3] !== runId || !segments.join('/').includes(`/${scriptKey}/`)) {
      throw new Error(`截图与选定运行不匹配：${slot.stepName}`);
    }
  }
  return match[1];
}

export async function generateVisualReviewReport(
  slots: CoverageSlot[], scriptKey: string, runId: string, sourceHtml: string, outputDir: string,
): Promise<string> {
  const env = validateReviewScope(slots, scriptKey, runId);
  const dir = path.resolve(outputDir);
  fs.mkdirSync(dir, { recursive: true });
  const report: VisualReviewReport = {
    version: 1, id: createHash('sha256').update(`${scriptKey}|${runId}`).digest('hex').slice(0, 24),
    hash: '', env, runId, scriptKey, title: `申请单视觉复核报告 · ${envLabelFromId(env)} · ${runId}`,
    scope: slots.map(s => `${reviewStepLabel(s.stepName)} · ${browserLabel(s.browser)}${s.processOnly ? '（过程截图）' : ''}`),
    limitations: [
      '红色表示像素变化，不等于缺陷。变化项统一待确认，不自动决定发布。',
      '仅覆盖列出的截图状态；未列出的操作、视口与首屏外内容未验证。',
      '产品版本、权限角色及基线审批需人工核对。局部图按差异区域自动裁剪，不代表根因。',
      '截图未脱敏，仅供内部复核。工具检查异常尚未纳入本清单。',
    ], items: [],
  };
  const resolveImage = (file: string) => path.resolve(path.dirname(sourceHtml), file);
  const candidates = slots.filter(s => !s.processOnly && (s.status !== 'pass' || Boolean(s.difference && s.difference > 0)));
  const sources = candidates.map(slot => {
    const baseline = slot.baselinePath ? PNG.sync.read(fs.readFileSync(resolveImage(slot.baselinePath))) : undefined;
    const current = slot.currentPath ? PNG.sync.read(fs.readFileSync(resolveImage(slot.currentPath))) : undefined;
    return { slot, baseline, current, regions: baseline && current ? reviewRegions(slot, baseline, current) : [] };
  });
  const occurrences = new Map<string, Set<string>>();
  for (const source of sources) for (const region of source.regions) {
    const states = occurrences.get(region.signature) || new Set<string>();
    states.add(`${source.slot.stepNumber}:${source.slot.browser}`); occurrences.set(region.signature, states);
  }
  const sharedSignatures = new Set([...occurrences].filter(([, states]) => states.size > 1).map(([signature]) => signature));
  const shared: ReviewItem = {
    key: `${report.id}:shared`, title: '公共区域变化', browser: [...new Set(candidates.map(s => s.browser))].join(' / '),
    account: scriptKey.split('/').at(-1)!, description: '',
    next: '确认公共区域变化是否符合预期；各状态完整证据见下方。', images: [],
  };
  const sharedShown = new Set<string>();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const source of sources) {
      const { slot, baseline, current } = source;
      const key = `${report.id}:${slot.stepNumber}:${slot.browser}`;
      const prefix = createHash('sha256').update(key).digest('hex').slice(0, 16);
      const item: ReviewItem = {
        key, title: `${reviewStepLabel(slot.stepName)}｜${slot.status === 'uncovered' ? '待补证据' : '页面变化待确认'}`,
        browser: slot.browser, account: scriptKey.split('/').at(-1)!,
        description: slot.status === 'uncovered' ? '缺少可比基线，不能给出视觉结论。' :
          `${slot.difference === undefined ? '存在截图变化' : `变化像素占 ${(slot.difference * 100).toFixed(2)}%`}。${source.regions.some(r => sharedSignatures.has(r.signature)) ? '与其他页面相同的局部变化见上方对比。' : ''}`,
        next: slot.status === 'uncovered' ? '核对截图状态并补充经审核的基线。' : REVIEW_NEXT,
        images: [],
      };
      const copy = (file: string, label: string, suffix: string) => {
        const target = path.join(dir, `${prefix}-${suffix}.png`);
        fs.copyFileSync(resolveImage(file), target); item.images.push({ label, file: target });
      };
      if (slot.overlayPath) copy(slot.overlayPath, '01-差异位置（红色）', 'diff');
      if (baseline && current) {
        const pair = async (label: string, suffix: string, crop?: Crop, owner = item) => {
          const data = [baseline, current].map(png => {
            if (!crop) return PNG.sync.write(png);
            return PNG.sync.write(cropImage(png, crop));
          });
          await page.setViewportSize({ width: 1280, height: 900 });
          const sideWidth = crop ? Math.min(624, Math.max(260, crop.w)) : 624;
          await page.setContent(`<style>body{margin:0;background:white;font:20px sans-serif}.pair{display:flex;width:max-content;gap:16px;padding:8px}.side{width:${sideWidth}px}header{background:#edf2fa;padding:14px;color:#24344c;font-weight:bold}img{display:block;max-width:100%;height:auto;margin:auto}</style><div class="pair">${data.map((b, n) => `<div class="side"><header>${n ? '当前 · ' + escapeHtml(runId.split('T')[0]) : '基线'}</header><img src="data:image/png;base64,${b.toString('base64')}"></div>`).join('')}</div>`);
          await page.locator('img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
          const file = path.join(dir, `${prefix}-${suffix}.png`);
          await page.locator('.pair').screenshot({ path: file });
          owner.images.push({ label, file });
        };
        await pair('02-整页对比', 'pair');
        for (const region of source.regions) {
          if (!sharedSignatures.has(region.signature) || sharedShown.has(region.signature) || sharedShown.size >= 3) continue;
          sharedShown.add(region.signature);
          await pair(`共同变化 · 细节 ${sharedShown.size}`, `shared-${sharedShown.size}`, region.crop, shared);
        }
        const unique = source.regions.filter(r => !sharedSignatures.has(r.signature)).slice(0, 2);
        for (const [index, region] of unique.entries()) {
          await pair(`0${index + 3}-本状态局部对比`, `crop-${index}`, region.crop);
        }
      } else if (slot.currentPath) copy(slot.currentPath, '01-当前截图', 'current');
      report.items.push(item);
    }
  } finally { await browser.close(); }
  if (shared.images.length) {
    const affected = [...new Set(sources.filter(s => s.regions.some(r => sharedShown.has(r.signature)))
      .map(s => reviewStepLabel(s.slot.stepName)))];
    shared.title = '多个页面中出现的共同变化';
    shared.description = `涉及：${affected.join('、')}。相同的局部变化只展示一次；各页面的完整对比见下方。`;
    report.items.unshift(shared);
  }
  report.hash = reviewHash(report);
  const manifest = path.join(dir, 'visual-review.json');
  fs.writeFileSync(manifest, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, 'index.html'), renderVisualReview(report));
  return manifest;
}

export function renderVisualReview(report: VisualReviewReport): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(report.title)}</title><style>body{max-width:1040px;margin:40px auto;padding:0 24px;font:16px/1.7 sans-serif;color:#24344c;overflow-wrap:anywhere}section{border-top:1px solid #ddd;margin-top:32px;padding-top:20px}img{max-width:100%;height:auto}h3{margin-bottom:8px}</style><h1>${escapeHtml(report.title)}</h1><p>复核分组 ${report.items.length} 组（含公共区域与状态证据，不代表缺陷数）；尚未完成人工确认。</p><p>统一待办：${escapeHtml(REVIEW_NEXT)}</p>${report.items.map((i, n) => `<section><h2>${n + 1}｜${escapeHtml(i.title)}</h2><p>${escapeHtml(i.description)}</p>${i.next === REVIEW_NEXT ? '' : `<p>待办：${escapeHtml(i.next)}</p>`}${i.images.map(im => `<h3>${escapeHtml(im.label)}</h3><img src="${escapeHtml(path.basename(im.file))}">`).join('')}</section>`).join('')}<section><h2>检查范围</h2><p>${report.scope.map(escapeHtml).join('；')}</p>${report.limitations.map(l => `<p>${escapeHtml(l)}</p>`).join('')}</section></html>`;
}
