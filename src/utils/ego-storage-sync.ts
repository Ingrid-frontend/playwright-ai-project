import fs from 'fs';
import path from 'path';
import { annotateStorageStateMeta } from './storage-state-meta.js';
import { runEgoJson } from './ego-browser.js';

type RawCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

type RawOriginState = {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
};

type ExportPayload = {
  pageUrl: string;
  cookies: RawCookie[];
  origins: RawOriginState[];
};

export async function exportStorageStateFromEgo(opts: {
  targetUrl: string;
  outPath: string;
  env?: string;
  loginAccount?: string;
  settleSec?: number;
}): Promise<{ outPath: string; pageUrl: string; cookieCount: number; originCount: number }> {
  const settleSec = Math.max(0, opts.settleSec || 2);
  const script = [
    `const task = await useOrCreateTaskSpace(${JSON.stringify(`export storage ${opts.env || 'default'}`)})`,
    `await openOrReuseTab(${JSON.stringify(opts.targetUrl)}, { wait: true, timeout: 45 })`,
    `await waitForNetworkIdle({ timeout: 15 }).catch(() => {})`,
    `await wait(${JSON.stringify(settleSec)})`,
    `await cdp('Network.enable').catch(() => {})`,
    `const info = await pageInfo()`,
    `const tree = await cdp('Page.getFrameTree').catch(() => null)`,
    `const frameIds = []`,
    `const walk = (node) => { if (!node || !node.frame) return; frameIds.push(node.frame.id); (node.childFrames || []).forEach(walk) }`,
    `if (tree && tree.frameTree) walk(tree.frameTree)`,
    `const origins = []`,
    `for (const frameId of frameIds) {`,
    `  try {`,
    `    const world = await cdp('Page.createIsolatedWorld', { frameId, worldName: 'ego-storage-export' })`,
    `    const evaluated = await cdp('Runtime.evaluate', {`,
    `      expression: "(() => { const origin = location.origin || ''; const localStorageItems = []; try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (!key) continue; localStorageItems.push({ name: key, value: String(localStorage.getItem(key) || '') }); } } catch {} return { origin, localStorage: localStorageItems }; })()",`,
    `      contextId: world.executionContextId,`,
    `      returnByValue: true,`,
    `      awaitPromise: false,`,
    `    })`,
    `    const value = evaluated && evaluated.result && evaluated.result.value`,
    `    if (value && value.origin) origins.push(value)`,
    `  } catch {}`,
    `}`,
    `const cookiesRes = await cdp('Network.getCookies', { urls: [info.url] }).catch(() => ({ cookies: [] }))`,
    `const uniq = []`,
    `const seen = new Set()`,
    `for (const item of origins) {`,
    `  const key = JSON.stringify([item.origin, item.localStorage])`,
    `  if (!seen.has(key)) { seen.add(key); uniq.push(item) }`,
    `}`,
    `const __result = { pageUrl: info.url || '', cookies: cookiesRes.cookies || [], origins: uniq }`,
  ].join('\n');

  const { data } = await runEgoJson<ExportPayload>(script, { timeoutMs: 180_000 });
  const state = {
    cookies: (data.cookies || []).map((item) => ({
      name: item.name,
      value: item.value,
      domain: item.domain,
      path: item.path,
      expires: typeof item.expires === 'number' ? item.expires : -1,
      httpOnly: Boolean(item.httpOnly),
      secure: Boolean(item.secure),
      sameSite: item.sameSite || 'Lax',
    })),
    origins: (data.origins || []).filter((item) => item.origin).map((item) => ({
      origin: item.origin,
      localStorage: Array.isArray(item.localStorage) ? item.localStorage : [],
    })),
  };

  const outPath = path.resolve(opts.outPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  annotateStorageStateMeta(outPath, {
    loginAccount: opts.loginAccount,
    env: opts.env,
    source: 'ego-sync-prototype',
  });
  return {
    outPath,
    pageUrl: data.pageUrl || opts.targetUrl,
    cookieCount: state.cookies.length,
    originCount: state.origins.length,
  };
}
