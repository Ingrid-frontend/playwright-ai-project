import fs from 'fs';
import path from 'path';
import { isLoginLikeText, isLoginLikeUrl } from './login-detection.js';

export type ScreenshotMeta = {
  domHash?: string;
  selectors?: Record<string, { exists?: boolean; domHash?: string }>;
  url?: string;
  title?: string;
  pageText?: string;
};

export type BaselineQualityIssue = {
  file: string;
  reason: string;
};

const EMPTY_DOM_HASH = /^BODY\|1\|\|$/i;
const MIN_PAYLOAD_LEN = 8;

/** 主 domHash 去掉前缀后的有效载荷长度 */
export function domHashPayloadLen(domHash: string): number {
  const raw = String(domHash || '').trim();
  if (!raw) return 0;
  const parts = raw.split('|');
  const payload = parts.length >= 3 ? parts.slice(2).join('|') : raw;
  return payload.trim().length;
}

export function isEmptyShellDomHash(domHash: string | undefined): boolean {
  if (!domHash || !String(domHash).trim()) return true;
  if (EMPTY_DOM_HASH.test(domHash.trim())) return true;
  return domHashPayloadLen(domHash) < MIN_PAYLOAD_LEN;
}

export function evaluateMetaQuality(meta: ScreenshotMeta, fileLabel = 'meta'): BaselineQualityIssue | null {
  if (isEmptyShellDomHash(meta.domHash)) {
    return {
      file: fileLabel,
      reason: `domHash 为空壳（${meta.domHash || '(空)'}），疑似登录失效/未渲染页面`,
    };
  }

  const selectors = meta.selectors || {};
  const keys = Object.keys(selectors);
  const existing = keys.filter((k) => selectors[k]?.exists === true);
  // 仅当 domHash 已合格时：若有多个 selector 且全部不存在 → 拒
  if (keys.length > 1 && existing.length === 0) {
    return { file: fileLabel, reason: 'selectors 全部 exists=false' };
  }

  if (meta.url && isLoginLikeUrl(meta.url)) {
    return { file: fileLabel, reason: `url 像登录页: ${meta.url}` };
  }
  const textBlob = [meta.title, meta.pageText].filter(Boolean).join('\n');
  if (textBlob && isLoginLikeText(textBlob)) {
    return { file: fileLabel, reason: 'title/pageText 像登录页文案' };
  }

  return null;
}

export function assertRunEligibleForGolden(runDir: string): void {
  if (!fs.existsSync(runDir)) {
    throw new Error(`源运行目录不存在: ${runDir}`);
  }

  const metas = fs
    .readdirSync(runDir)
    .filter((f) => f.endsWith('.meta.json') && f.startsWith('step-'))
    // skipped 步骤截图不参与晋升质量判定
    .filter((f) => !/-skipped/i.test(f));

  if (metas.length === 0) {
    const pngs = fs.readdirSync(runDir).filter((f) => f.endsWith('.png') && f.startsWith('step-'));
    if (pngs.length === 0) {
      throw new Error(`拒绝晋升：${runDir} 无 step 截图`);
    }
    throw new Error(
      `拒绝晋升：${runDir} 有 ${pngs.length} 张 PNG 但无 .meta.json，无法校验页面是否真渲染`,
    );
  }

  const issues: BaselineQualityIssue[] = [];
  for (const file of metas) {
    const abs = path.join(runDir, file);
    let meta: ScreenshotMeta;
    try {
      meta = JSON.parse(fs.readFileSync(abs, 'utf-8')) as ScreenshotMeta;
    } catch {
      issues.push({ file, reason: 'meta JSON 解析失败' });
      continue;
    }
    const issue = evaluateMetaQuality(meta, file);
    if (issue) issues.push(issue);
  }

  // 半数以上 meta 不合格则整次拒绝（避免个别 skipped 步骤拖垮）
  const badRatio = issues.length / metas.length;
  if (issues.length === metas.length || badRatio >= 0.5) {
    const sample = issues
      .slice(0, 5)
      .map((i) => `  - ${i.file}: ${i.reason}`)
      .join('\n');
    throw new Error(
      `拒绝晋升：疑似登录失效空壳或未渲染页面（${issues.length}/${metas.length} 份 meta 不合格）。\n${sample}`,
    );
  }
}
