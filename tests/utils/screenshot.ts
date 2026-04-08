import { Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

export async function screenshotWhenStable(page: Page, filePath: string): Promise<void> {
  await page.waitForTimeout(1000);
  await page.screenshot({ path: filePath, fullPage: true });
}