import { Frame, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import {
  loadUiRegressionConfig,
  resolveMaskSelectors,
  resolveSnapshotViewports,
  resolveScreenshotFullPage,
  resolveStructureCheckItems,
  resolveStyleCheckItems,
  resolveChangeDetectionSections,
  enrichStructureItemsWithFingerprints,
  filterCheckItemsBySnapshot,
  type SnapshotViewport,
  type StructureCheckItem,
} from '../../scripts/report/ui-regression-config.js';
import { collectStyleFingerprint, type StyleFingerprint } from './style-fingerprint.js';
import {
  BROWSER_COLLECT_SECTIONS,
  BROWSER_COLLECT_SELECTORS,
  LEGACY_DOM_FINGERPRINT,
  finalizeSection,
  finalizeSelectorProbe,
  finalizeTextSection,
  buildLegacyDomHash,
  type SectionFingerprint,
  type TextSection,
  type SectionRaw,
  type SelectorProbeRaw,
} from './dom-fingerprint.js';

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

function bandIsLetterbox(png: PNG, y0: number, y1: number): boolean {
  const w = png.width;
  const h = Math.min(y1, png.height);
  if (y0 >= h) return true;
  let non = 0;
  const total = w * (h - y0);
  if (total <= 0) return true;
  for (let y = y0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (w * y + x) * 4;
      if (png.data[i] < 250 || png.data[i + 1] < 250 || png.data[i + 2] < 250) non++;
    }
  }
  return non / total < 0.01;
}

/**
 * 部分环境下 page.screenshot 会产出大于 CSS 视口的画布，真实页面只在左上角
 *（如 1600×900 / 2560×1440 中仅 1280×720 有内容）。统一裁到约定 CSS 尺寸。
 */
export function normalizeScreenshotToCssViewport(
  filePath: string,
  viewport: SnapshotViewport,
  fullPage: boolean,
): { width: number; height: number; cropped: boolean } {
  if (!fs.existsSync(filePath)) {
    return { width: 0, height: 0, cropped: false };
  }
  let png = PNG.sync.read(fs.readFileSync(filePath));
  const wantW = viewport.width;
  const wantH = viewport.height;
  let cropped = false;

  if (png.width > wantW && png.height >= wantH) {
    const out = new PNG({ width: wantW, height: png.height });
    PNG.bitblt(png, out, 0, 0, wantW, png.height, 0, 0);
    png = out;
    cropped = true;
  }

  const shouldCropHeight =
    png.width === wantW &&
    png.height > wantH &&
    (!fullPage || bandIsLetterbox(png, wantH, png.height));

  if (shouldCropHeight) {
    const out = new PNG({ width: wantW, height: wantH });
    PNG.bitblt(png, out, 0, 0, wantW, wantH, 0, 0);
    png = out;
    cropped = true;
  }

  if (cropped) {
    fs.writeFileSync(filePath, PNG.sync.write(png));
  }
  return { width: png.width, height: png.height, cropped };
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
  structureHash?: string;
  textHash?: string;
  resolvedBy?: string;
};

async function probeSelectorsInContext(
  ctx: Page | Frame,
  items: StructureCheckItem[],
): Promise<Record<string, SelectorProbe>> {
  if (!items.length) return {};
  const raw = await ctx.evaluate(
    ({ list, body }) => {
      const fn = new Function(`return (${body})`)() as (
        items: { key: string; selector: string; fingerprint?: unknown }[],
      ) => Record<string, SelectorProbeRaw>;
      return fn(list);
    },
    {
      list: items.map((i) => ({
        key: i.key,
        selector: i.selector,
        fingerprint: i.fingerprint,
      })),
      body: BROWSER_COLLECT_SELECTORS,
    },
  );
  const out: Record<string, SelectorProbe> = {};
  for (const [key, probe] of Object.entries(raw)) {
    out[key] = finalizeSelectorProbe(probe as SelectorProbeRaw);
  }
  return out;
}

async function collectSectionsInContext(
  ctx: Page | Frame,
  items: StructureCheckItem[],
): Promise<SectionFingerprint[]> {
  if (!items.length) return [];
  const raw = await ctx.evaluate(
    ({ list, body }) => {
      const fn = new Function(`return (${body})`)() as (
        items: { key: string; selector: string }[],
      ) => SectionRaw[];
      return fn(list);
    },
    { list: items.map((i) => ({ key: i.key, selector: i.selector })), body: BROWSER_COLLECT_SECTIONS },
  );
  return (raw as SectionRaw[]).map(finalizeSection);
}

async function writeStepDiagnostics(
  page: Page,
  screenshotPath: string,
  viewport: SnapshotViewport,
  scriptKey?: string,
  snapshot?: { snapshotName?: string; state?: string },
  imageSize?: { width: number; height: number },
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

  let selectors: Record<string, SelectorProbe> | undefined;
  let sections: SectionFingerprint[] | undefined;
  let textSections: TextSection[] | undefined;
  let domHash: string | undefined;
  const cfg = loadUiRegressionConfig().structureChecks;
  const snapCtx = snapshot?.snapshotName
    ? { snapshotName: snapshot.snapshotName, state: snapshot.state || 'normal' }
    : undefined;
  const checkItems = enrichStructureItemsWithFingerprints(
    scriptKey,
    filterCheckItemsBySnapshot(resolveStructureCheckItems(scriptKey), snapCtx),
  );
  const changeSectionItems: StructureCheckItem[] = resolveChangeDetectionSections().map((s) => ({
    key: s.key,
    selector: s.selector,
  }));

  if (checkItems.length || changeSectionItems.length) {
    const mainItems = checkItems.filter((i) => (i.frame || 'main') === 'main');
    const frameItems = checkItems.filter((i) => i.frame === 'first');
    selectors = {};
    sections = [];
    textSections = [];
    try {
      if (mainItems.length) {
        Object.assign(selectors, await probeSelectorsInContext(page, mainItems));
      }
      const mainSectionKeys = new Set(mainItems.map((i) => i.key));
      const mainSections = [
        ...mainItems,
        ...changeSectionItems.filter((s) => !mainSectionKeys.has(s.key)),
      ];
      if (mainSections.length) {
        sections.push(...(await collectSectionsInContext(page, mainSections)));
      }
    } catch {
      /* ignore */
    }
    if (frameItems.length) {
      const child = page.frames().find((f) => f !== page.mainFrame());
      if (child) {
        try {
          Object.assign(selectors, await probeSelectorsInContext(child, frameItems));
          sections.push(...(await collectSectionsInContext(child, frameItems)));
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
    const sectionSource = [...checkItems, ...changeSectionItems];
    for (const sec of sections) {
      const item = sectionSource.find((i) => i.key === sec.key);
      if (!item) continue;
      const raw = await page
        .evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return '';
          return ((el as HTMLElement).innerText || el.textContent || '').trim().slice(0, 500);
        }, item.selector)
        .catch(() => '');
      if (raw) textSections.push(finalizeTextSection(sec.key, raw));
    }
    if (!Object.keys(selectors).length) selectors = undefined;
    if (!sections.length) sections = undefined;
    if (!textSections.length) textSections = undefined;
  }

  if (cfg?.domHashRoot) {
    try {
      domHash = await page.evaluate(
        ({ root, fnBody }) => {
          const el = document.querySelector(root);
          if (!el) return '';
          const fn = new Function('el', `return (${fnBody})(el)`);
          return fn(el) as string;
        },
        { root: cfg.domHashRoot, fnBody: LEGACY_DOM_FINGERPRINT },
      );
    } catch {
      domHash = undefined;
    }
  }

  const pageSection = sections?.find((s) => s.key === 'page') || sections?.[0];
  if (pageSection?.structureHash) {
    domHash = buildLegacyDomHash(pageSection.structureHash) || domHash;
  }

  let styleFingerprint: StyleFingerprint | undefined;
  const styleItems = filterCheckItemsBySnapshot(resolveStyleCheckItems(scriptKey), snapCtx);
  if (styleItems.length) {
    try {
      styleFingerprint = await collectStyleFingerprint(page, styleItems);
    } catch {
      styleFingerprint = undefined;
    }
  }

  const metaPath = screenshotPath.replace(/\.png$/i, '.meta.json');
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        // scale:'css' → 图像像素 = CSS 视口；deviceScaleFactor 固定记 1 供晋升闸门校验
        viewport: {
          name: viewport.name,
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
        },
        ...(imageSize && imageSize.width > 0
          ? { imageWidth: imageSize.width, imageHeight: imageSize.height }
          : {}),
        layout,
        domHash,
        sections,
        textSections,
        selectors,
        styleFingerprint,
        consoleErrors: [...bag.consoleErrors],
        pageErrors: [...bag.pageErrors],
        ...(snapshot?.snapshotName ? { snapshotName: snapshot.snapshotName } : {}),
        ...(snapshot?.state ? { state: snapshot.state } : {}),
      },
      null,
      2,
    ),
    'utf-8',
  );
}

export function useFullPageByDefault(): boolean {
  return resolveScreenshotFullPage();
}

export async function captureScreenshotAtViewports(
  page: Page,
  filePath: string,
  opts: { fullPage?: boolean; scriptKey?: string; snapshotName?: string; state?: string },
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
    const imageSize = normalizeScreenshotToCssViewport(outPath, vp, fullPage);
    if (imageSize.cropped) {
      console.log(
        `✂️  截图已裁至 CSS 视口 ${vp.width}x${vp.height}: ${path.basename(outPath)}`,
      );
    }
    await writeStepDiagnostics(
      page,
      outPath,
      vp,
      opts.scriptKey,
      {
        snapshotName: opts.snapshotName,
        state: opts.state,
      },
      imageSize,
    );
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
