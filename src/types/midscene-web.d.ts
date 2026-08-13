declare module '@midscene/web/playwright' {
  import type { Page } from 'playwright';

  export class PlaywrightAgent {
    constructor(page: Page, opts?: { waitForNetworkIdleTimeout?: number });
    aiTap(prompt: string): Promise<void>;
    aiInput(prompt: string, opt: { value: string | number }): Promise<void>;
    aiAssert(assertion: string): Promise<unknown>;
    aiAct(task: string): Promise<string | undefined>;
    aiQuery<T = unknown>(demand: string): Promise<T>;
  }
}
