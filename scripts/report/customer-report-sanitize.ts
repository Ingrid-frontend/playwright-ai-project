/**
 * 客户报告 HTML 脱敏清洗器
 *
 * 客户版报告从截图树（screenshots/flows/.../golden-regression/by-account/<账号>/run-chromium-*）
 * 直接引用图片与脚本标识，会把内部账号、测试目录、run-chromium 等内部串带进成品 HTML。
 * 本模块在写盘前对成品 HTML 做两层处理：
 *
 * 1. 资产中立化：把所有 <img src / data-screenshot> 引用的真实图片复制到
 *    results/<slug>-assets/ 下，统一命名为 img-1.png / img-2.png ...，HTML 引用改为相对该目录；
 *    源文件不存在时统一指向 missing.png（透明占位），避免内部路径残留。
 * 2. 脚本标识令牌化：把 data-script-key / data-script 里的完整脚本路径（含账号/目录结构）
 *    替换为 k0 / k1 ...，并把「令牌 → 真实 scriptKey」的映射写入 <slug>.report-keys.json，
 *    供手动反馈链路（/api/manual-feedback）回解后落库，保证内部可追溯但不外泄。
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

/** 输出 HTML 中允许保留的引用形态（http/data/blob 或空串不动） */
const IGNORED_REF = /^(?:https?:|data:|blob:|#|\/)/i;

function htmlSlug(outputPath: string): string {
  const base = path.basename(outputPath).replace(/\.html?$/i, '');
  const slug = base.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
  return slug || 'report';
}

/** 按源路径哈希得到稳定文件名：同一截图重复引用只复制一份，覆写保证内容新鲜 */
function assetNameFor(ref: string): string {
  const digest = createHash('sha1').update(ref).digest('hex').slice(0, 12);
  const ext = /^\.[a-z0-9]{1,5}$/i.test(path.extname(ref)) ? path.extname(ref).toLowerCase() : '.png';
  return `img-${digest}${ext}`;
}

function collectRefs(html: string): string[] {
  const refs = new Set<string>();
  const re = /(?:src|data-screenshot)="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const ref = m[1]!.trim();
    if (ref && !IGNORED_REF.test(ref)) refs.add(ref);
  }
  return [...refs].sort((a, b) => b.length - a.length);
}

function collectScriptKeys(html: string): string[] {
  const keys = new Set<string>();
  const re = /(?:data-script-key|data-script)="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const k = m[1]!.trim();
    if (k && !/^k\d+$/.test(k)) keys.add(k);
  }
  return [...keys].sort((a, b) => b.length - a.length);
}

const MISSING_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function sanitizeCustomerReportHtml(
  html: string,
  outputPath: string,
): { html: string; scriptKeyMap: Record<string, string>; copied: number } {
  const htmlAbs = path.resolve(outputPath);
  const htmlDir = path.dirname(htmlAbs);
  const slug = htmlSlug(outputPath);
  const assetsDir = path.join(htmlDir, `${slug}-assets`);
  const sidecarPath = path.join(htmlDir, `${slug}.report-keys.json`);

  // 1) 图片资产复制 + 引用替换（先替换长串，避免子串误伤）
  const refs = collectRefs(html);
  const refMap = new Map<string, string>();
  let copied = 0;
  fs.mkdirSync(assetsDir, { recursive: true });
  // 上轮生成的多余文件（本次不再引用的）逐个清理；不使用整目录递归删除，避免触发批量删除保护
  const manifestPath = path.join(assetsDir, 'manifest.json');
  const previous: string[] = [];
  try {
    const prevJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { files?: string[] };
    if (Array.isArray(prevJson.files)) previous.push(...prevJson.files);
  } catch {
    /* 无上轮 manifest */
  }
  for (const ref of refs) {
    const srcAbs = path.resolve(htmlDir, ref);
    const targetName = assetNameFor(ref);
    const rel = `${slug}-assets/${targetName}`;
    if (fs.existsSync(srcAbs) && fs.statSync(srcAbs).isFile()) {
      try {
        fs.copyFileSync(srcAbs, path.join(assetsDir, targetName));
        copied++;
        refMap.set(ref, rel);
        continue;
      } catch {
        /* 复制失败落回占位 */
      }
    }
    // 源不存在/不可读：指向透明占位，避免内部路径残留在 HTML 中
    refMap.set(ref, `${slug}-assets/missing.png`);
  }
  if (refMap.size > 0 && !fs.existsSync(path.join(assetsDir, 'missing.png'))) {
    fs.writeFileSync(path.join(assetsDir, 'missing.png'), Buffer.from(MISSING_PNG_BASE64, 'base64'));
  }
  const currentFiles = [...new Set([...refMap.values()].map((r) => path.basename(r)))];
  for (const old of previous) {
    if (currentFiles.includes(old) || old === 'missing.png' || old === 'manifest.json') continue;
    try {
      fs.unlinkSync(path.join(assetsDir, old));
    } catch {
      /* 单个清理失败不阻塞 */
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ files: currentFiles.sort() }), 'utf8');
  let out = html;
  for (const [oldRef, newRef] of refMap) {
    if (out.includes(oldRef)) out = out.split(oldRef).join(newRef);
  }

  // 2) 脚本标识令牌化（data-script-key / data-script 属性值）
  const scriptKeyMap: Record<string, string> = {};
  const scriptKeys = collectScriptKeys(out);
  scriptKeys.forEach((k, i) => {
    const token = `k${i}`;
    scriptKeyMap[token] = k;
    if (out.includes(k)) out = out.split(k).join(token);
  });

  if (Object.keys(scriptKeyMap).length > 0) {
    fs.writeFileSync(
      sidecarPath,
      JSON.stringify({ updatedAt: new Date().toISOString(), html: path.basename(htmlAbs), keys: scriptKeyMap }, null, 2),
      'utf-8',
    );
  } else if (fs.existsSync(sidecarPath)) {
    // 无泄漏标识时移除过期 sidecar，避免陈旧映射误导反馈回解
    try {
      fs.unlinkSync(sidecarPath);
    } catch {
      /* ignore */
    }
  }

  return { html: out, scriptKeyMap, copied };
}
