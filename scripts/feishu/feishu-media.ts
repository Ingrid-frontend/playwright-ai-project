import fs from 'fs';
import path from 'path';
import { fetchWithRetry } from './feishu-utils.js';

export const FEISHU_MEDIA_CACHE_FILE = 'results/feishu-media-cache.json';

type MediaCacheEntry = {
  fileToken: string;
  uploadedAt: string;
  signature: string;
};

type MediaCache = {
  version: 1;
  entries: Record<string, MediaCacheEntry>;
};

/** 文件内容指纹：大小 + 修改时间，够用于判断「同一张图是否已传过」 */
export function fileSignature(absPath: string): string {
  const st = fs.statSync(absPath);
  return `${st.size}-${Math.floor(st.mtimeMs)}`;
}

export function loadMediaCache(file = FEISHU_MEDIA_CACHE_FILE): MediaCache {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) return { version: 1, entries: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf-8')) as MediaCache;
    if (parsed?.version !== 1 || typeof parsed.entries !== 'object') return { version: 1, entries: {} };
    return parsed;
  } catch {
    return { version: 1, entries: {} };
  }
}

export function saveMediaCache(cache: MediaCache, file = FEISHU_MEDIA_CACHE_FILE): void {
  const abs = path.resolve(file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(cache, null, 2), 'utf-8');
}

type UploadAllResponse = {
  code: number;
  msg?: string;
  data?: { file_token?: string; file?: { token?: string } };
};

/**
 * 上传单张图片到飞书云空间，返回 file_token。
 * 兼容新旧两种响应结构（file_token 与 file.token）。
 */
export async function uploadImageToDrive(
  token: string,
  absPath: string,
  fileName?: string,
): Promise<string> {
  const buffer = fs.readFileSync(absPath);
  const name = fileName || path.basename(absPath);
  const ext = path.extname(name).toLowerCase();
  const mimeType =
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : 'image/png';

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), name);
  form.append('file_type', 'image');
  form.append('file_name', name);

  const res = await fetchWithRetry(
    `https://open.feishu.cn/open-apis/drive/v1/medias/upload_all?size=${buffer.length}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const data = (await res.json()) as UploadAllResponse;
  const fileToken = data.data?.file_token ?? data.data?.file?.token;
  if (data.code !== 0 || !fileToken) {
    throw new Error(`上传图片失败（${name}）: ${data.msg || `code=${data.code}`}`);
  }
  return fileToken;
}

export type UploadBatchResult = {
  /** 绝对路径 → file_token */
  tokens: Map<string, string>;
  uploaded: number;
  reused: number;
  failed: Array<{ absPath: string; error: string }>;
};

type IndexedResult<R> = { index: number; value?: R; error?: unknown };

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<IndexedResult<R>[]> {
  const results: IndexedResult<R>[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results.push({ index: i, value: await fn(items[i]!) });
      } catch (error) {
        results.push({ index: i, error });
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export type UploaderOptions = {
  concurrency?: number;
  cacheFile?: string;
  onProgress?: (done: number, total: number) => void;
};

/**
 * 批量上传图片：命中缓存直接复用 file_token，未命中的并发上传后写回缓存。
 * 单张失败不影响整体，失败项会记录到 failed 里由调用方决定降级策略。
 */
export async function uploadImages(
  token: string,
  absPaths: string[],
  opts: UploaderOptions = {},
): Promise<UploadBatchResult> {
  const unique = [...new Set(absPaths)].filter((p) => fs.existsSync(p));
  const cache = loadMediaCache(opts.cacheFile);
  const tokens = new Map<string, string>();
  const pending: string[] = [];
  let reused = 0;

  for (const abs of unique) {
    const key = path.resolve(abs);
    const sig = fileSignature(key);
    const hit = cache.entries[key];
    if (hit && hit.signature === sig && hit.fileToken) {
      tokens.set(key, hit.fileToken);
      reused += 1;
    } else {
      pending.push(key);
    }
  }

  const failed: Array<{ absPath: string; error: string }> = [];
  const limit = Math.max(1, opts.concurrency ?? 4);
  const settled = await mapWithConcurrency(pending, limit, async (abs) => {
    const fileToken = await uploadImageToDrive(token, abs);
    return { abs, fileToken };
  });

  for (const r of settled) {
    const abs = pending[r.index]!;
    if (r.error) {
      failed.push({ absPath: abs, error: (r.error as Error)?.message || String(r.error) });
      continue;
    }
    const { fileToken } = r.value!;
    tokens.set(abs, fileToken);
    cache.entries[abs] = {
      fileToken,
      uploadedAt: new Date().toISOString(),
      signature: fileSignature(abs),
    };
  }

  if (pending.length > 0) saveMediaCache(cache, opts.cacheFile);

  return { tokens, uploaded: tokens.size - reused, reused, failed };
}
