import { test as base } from '@playwright/test';

/** 与 compare-screenshots 扫描规则一致：目录名需含 `-chromium-` / `-webkit-` 等片段。 */
function screenshotRunSegmentForBrowser(browserName: string): string {
  if (browserName === 'webkit') return 'run-webkit-optimized';
  if (browserName === 'chromium') return 'run-chromium-optimized';
  return `run-${browserName}-optimized`;
}

type OptimizedFixtures = {
  _optimizedScreenshotRunSegment: void;
};

export const test = base.extend<OptimizedFixtures>({
  _optimizedScreenshotRunSegment: [
    async ({ browserName }, use) => {
      const prev = process.env.PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT;
      const explicit = prev?.trim();
      if (!explicit) {
        process.env.PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT = screenshotRunSegmentForBrowser(browserName);
      }
      await use();
      if (!explicit) {
        if (prev === undefined) delete process.env.PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT;
        else process.env.PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT = prev;
      }
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
