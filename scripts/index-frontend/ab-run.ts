/**
 * A/B 实跑：把生成的动作代码套进 page 上下文重复执行，统计通过率。
 *
 * 用法：
 *   npx tsx scripts/index-frontend/ab-run.ts --file=/tmp/x.ts --env=stage --entry=/main/approve --runs=5
 */
import fs from 'fs';
import path from 'path';
import { chromium, expect, type Page } from '@playwright/test';

function getArg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

/**
 * 生成代码里会调用 studioOpenFirstListRow，这里给出与运行器一致的实现：
 * 在表格 body 中找首个可见数据行并点击。
 */
async function studioOpenFirstListRow(page: Page): Promise<void> {
  const candidates = [
    page.locator('.ant-table-tbody tr').filter({ visible: true }).first(),
    page.locator('[class*="virtual"] [class*="row"]').filter({ visible: true }).first(),
    page.getByRole('row').filter({ visible: true }).nth(1),
  ];
  for (const locator of candidates) {
    if ((await locator.count().catch(() => 0)) > 0) {
      await locator.click({ timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(2500);
      return;
    }
  }
  throw new Error('studioOpenFirstListRow: 未找到可点击的数据行');
}

async function main(): Promise<void> {
  const file = getArg('file');
  const envName = getArg('env', 'stage')!;
  const entry = getArg('entry', '/main/approve')!;
  const runs = Number(getArg('runs', '3'));
  if (!file || !fs.existsSync(file)) throw new Error('--file 必填且需存在');

  const actionCode = fs.readFileSync(file, 'utf8');
  const baseConfig = JSON.parse(fs.readFileSync(path.resolve('datasource/base-config.json'), 'utf8'));
  const envConfig = baseConfig[envName];

  // 动作代码可能带 TS 语法（如 let x: any），所以落成临时模块交给 tsx 转译，
  // 而不是用 new Function 直接 eval。
  const tmpDir = path.resolve('.tmp-ab');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `${path.basename(file, path.extname(file))}-${Date.now()}.ts`);
  fs.writeFileSync(
    tmpFile,
    [
      `import type { Page } from '@playwright/test';`,
      `type Expect = typeof import('@playwright/test').expect;`,
      `export default async function run(page: Page, expect: Expect, studioOpenFirstListRow: (p: Page) => Promise<void>) {`,
      actionCode,
      `}`,
      ``,
    ].join('\n'),
    'utf8',
  );
  const runner = (await import(tmpFile)).default as (
    p: Page,
    e: typeof expect,
    h: typeof studioOpenFirstListRow,
  ) => Promise<void>;

  const results: { ok: boolean; ms: number; error?: string }[] = [];

  for (let i = 0; i < runs; i += 1) {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      baseURL: envConfig.baseURL,
      storageState: fs.existsSync(envConfig.storageState) ? envConfig.storageState : undefined,
    });
    const page = await context.newPage();
    const started = Date.now();
    try {
      await page.goto(entry, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await runner(page, expect, studioOpenFirstListRow);
      results.push({ ok: true, ms: Date.now() - started });
      console.log(`run ${i + 1}/${runs}: PASS (${Date.now() - started}ms)`);
    } catch (err) {
      const message = String(err).split('\n')[0].slice(0, 160);
      results.push({ ok: false, ms: Date.now() - started, error: message });
      console.log(`run ${i + 1}/${runs}: FAIL (${Date.now() - started}ms) ${message}`);
    } finally {
      await browser.close();
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const avg = Math.round(results.reduce((sum, r) => sum + r.ms, 0) / results.length);
  console.log(`\n=== ${path.basename(file)} ===`);
  console.log(`通过 ${passed}/${runs}，平均耗时 ${avg}ms`);
  for (const r of results.filter((x) => !x.ok)) console.log(`  失败: ${r.error}`);
  fs.rmSync(tmpFile, { force: true });
}

main();
