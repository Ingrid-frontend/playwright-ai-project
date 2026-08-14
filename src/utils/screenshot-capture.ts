import { Frame, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  loadUiRegressionConfig,
  resolveMaskSelectors,
  resolveSnapshotViewports,
  resolveStructureCheckItems,
  type SnapshotViewport,
  type StructureCheckItem,
} from '../../scripts/report/ui-regression-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCREENSHOT_SCALE: 'css' | 'device' = 'css';

function withViewportSuffix(filePath: string, vpName: string, isDefault: boolean): string {
  if (isDefault) return filePath;
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, '.png');
  return path.join(dir, `${base}__${vpName}.png`);
}

export async function lockViewportForSnapshot(page: Page, viewport: SnapshotViewport): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
}

let freezeAnimationsApplied = false;

const pageDiag = new WeakMap<Page, { consoleErrors: string[]; pageErrors: string[] }>();

function ensurePageDiag(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  let bag = pageDiag.get(page);
  if (bag) return bag;
  bag = { consoleErrors: [], pageErrors: [] };
  page.on('pageerror', err => bag!.pageErrors.push(String(err)));
  page.on('console', msg => {
    if (msg.type() === 'error') bag!.consoleErrors.push(msg.text());
  });
  pageDiag.set(page, bag);
  return bag;
}

function resetPageDiag(page: Page): void {
  const bag = ensurePageDiag(page);
  bag.consoleErrors.length = 0;
  bag.pageErrors.length = 0;
}

async function applyMaskSelectors(page: Page, scriptKey?: string): Promise<void> {
  const selectors = resolveMaskSelectors(scriptKey);
  if (!selectors.length) return;

  const applyIn = async (ctx: Page | Frame) => {
    await ctx.evaluate((sels) => {
      const styleId = 'ui-regression-mask-style';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent =
          `[data-ui-regression-mask]{background:#000!important;color:#000!important;border-color:#000!important;box-shadow:none!important}`;
        document.head.appendChild(style);
      }
      for (const sel of sels) {
        document.querySelectorAll(sel).forEach((el) => {
          (el as HTMLElement).setAttribute('data-ui-regression-mask', '1');
        });
      }
    }, selectors);
  };

  try {
    await applyIn(page);
  } catch {
    /* frame 可能已销毁 */
  }
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      await applyIn(frame);
    } catch {
      /* ignore */
    }
  }
}

type SelectorProbe = {
  exists: boolean;
  bbox?: { x: number; y: number; width: number; height: number };
  domHash?: string;
};

async function probeSelectorsInContext(
  ctx: Page | Frame,
  items: StructureCheckItem[],
  fnBody: string,
): Promise<Record<string, SelectorProbe>> {
  if (!items.length) return {};
  return ctx.evaluate(
    ({ list, body }) => {
      const fn = new Function('el', `return (${body})(el)`);
      const out: Record<string, SelectorProbe> = {};
      for (const item of list) {
        const el = document.querySelector(item.selector);
        if (!el) {
          out[item.key] = { exists: false };
          continue;
        }
        const r = el.getBoundingClientRect();
        out[item.key] = {
          exists: true,
          bbox: {
            x: Math.round(r.x),
            y: Math.round(r.y),
            width: Math.round(r.width),
            height: Math.round(r.height),
          },
          domHash: fn(el) as string,
        };
      }
      return out;
    },
    { list: items.map((i) => ({ key: i.key, selector: i.selector })), body: fnBody },
  );
}

async function writeStepDiagnostics(
  page: Page,
  screenshotPath: string,
  viewport: SnapshotViewport,
  scriptKey?: string,
): Promise<void> {
  if (process.env.SCREENSHOT_DIAGNOSTICS === '0') return;
  const bag = ensurePageDiag(page);
  let layout: { horizontalOverflow: boolean; scrollWidth: number; innerWidth: number } | undefined;
  try {
    layout = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
  } catch {
    layout = undefined;
  }

  let selectors: Record<
    string,
    { exists: boolean; bbox?: { x: number; y: number; width: number; height: number }; domHash?: string }
  > | undefined;
  let domHash: string | undefined;
  const cfg = loadUiRegressionConfig().structureChecks;
  const checkItems = resolveStructureCheckItems(scriptKey);

  const domFingerprintFn = `(function(el){
    var tag=el.tagName;
    var children=el.children?el.children.length:0;
    var cls=(el.className&&el.className.toString)?String(el.className).slice(0,120):'';
    var text=(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,240);
    return tag+'|'+children+'|'+cls+'|'+text;
  })`;

  if (cfg?.domHashRoot) {
    try {
      domHash = await page.evaluate(
        ({ root, fnBody }) => {
          const el = document.querySelector(root);
          if (!el) return '';
          const fn = new Function('el', `return (${fnBody})(el)`);
          return fn(el) as string;
        },
        { root: cfg.domHashRoot, fnBody: domFingerprintFn },
      );
    } catch {
      domHash = undefined;
    }
  }

  if (checkItems.length) {
    const mainItems = checkItems.filter((i) => (i.frame || 'main') === 'main');
    const frameItems = checkItems.filter((i) => i.frame === 'first');
    selectors = {};
    try {
      Object.assign(selectors, await probeSelectorsInContext(page, mainItems, domFingerprintFn));
    } catch {
      /* ignore */
    }
    if (frameItems.length) {
      const child = page.frames().find((f) => f !== page.mainFrame());
      if (child) {
        try {
          Object.assign(selectors, await probeSelectorsInContext(child, frameItems, domFingerprintFn));
        } catch {
          for (const item of frameItems) {
            selectors[item.key] = { exists: false };
          }
        }
      } else {
        for (const item of frameItems) {
          selectors[item.key] = { exists: false };
        }
      }
    }
  }

  const metaPath = screenshotPath.replace(/\.png$/i, '.meta.json');
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
        layout,
        domHash,
        selectors,
        consoleErrors: [...bag.consoleErrors],
        pageErrors: [...bag.pageErrors],
      },
      null,
      2,
    ),
    'utf-8',
  );
}

export function useFullPageByDefault(): boolean {
  return process.env.SCREENSHOT_FULL_PAGE === '1';
}

export async function captureScreenshotAtViewports(
  page: Page,
  filePath: string,
  opts: { fullPage?: boolean; scriptKey?: string },
): Promise<string> {
  const viewports = resolveSnapshotViewports();
  const fullPage = opts.fullPage ?? useFullPageByDefault();
  const defaultVp = viewports.find((v) => v.default) || viewports[0]!;
  let primaryPath = filePath;

  for (const vp of viewports) {
    const isDefault = !!vp.default || viewports.length === 1;
    const outPath = withViewportSuffix(filePath, vp.name, isDefault);
    resetPageDiag(page);
    await lockViewportForSnapshot(page, vp);
    await applyMaskSelectors(page, opts.scriptKey);
    await page.screenshot({ path: outPath, fullPage, scale: SCREENSHOT_SCALE });
    await writeStepDiagnostics(page, outPath, vp, opts.scriptKey);
    if (isDefault) primaryPath = outPath;
  }

  if (viewports.length > 1) {
    await lockViewportForSnapshot(page, defaultVp);
  }

  return primaryPath;
}

export async function applyScreenshotStabilityStyles(page: Page): Promise<void> {
  if (freezeAnimationsApplied) return;
  let enabled = process.env.SCREENSHOT_FREEZE_ANIMATIONS !== '0';
  try {
    const cfgPath = path.join(__dirname, '../../config/ui-regression.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as {
        screenshot?: { freezeAnimations?: boolean };
      };
      if (cfg.screenshot?.freezeAnimations === false) enabled = false;
      if (cfg.screenshot?.freezeAnimations === true) enabled = true;
    }
  } catch {
    /* use env default */
  }
  if (!enabled) return;
  try {
    await page.addStyleTag({
      content: `*, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }`,
    });
    freezeAnimationsApplied = true;
  } catch {
    /* frame 可能已销毁 */
  }
}
