import { Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

export async function screenshotWhenStable(page: Page, filePath: string): Promise<{ path: string, route: string }> {
  await page.waitForTimeout(1000);
  await page.screenshot({ path: filePath, fullPage: true });
  const route = await page.url();
  return { path: filePath, route };
}