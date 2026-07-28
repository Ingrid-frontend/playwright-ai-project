import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type { UiIssuesReport } from '../report/ui-issues.js';
import { writeQualityDashboard } from '../report/generate-quality-dashboard.js';
import { getFeishuAccessToken, loadFeishuAppConfig, uploadMessageImage } from './feishu-app.js';

const ISSUES_FILE = path.join('results', 'ui-issues.json');
const DASHBOARD_HTML = path.join('results', 'quality-dashboard.html');
const DASHBOARD_PNG = path.join('results', 'feishu-dashboard.png');
const VIEWPORT = { width: 1100, height: 900 };

export type ChartCardHeader = {
  title: string;
  template: 'blue' | 'green' | 'red' | 'orange';
};

export type ChartCardBuildResult = {
  header: ChartCardHeader;
  elements: Array<Record<string, unknown>>;
};

function readIssuesReport(): UiIssuesReport | null {
  if (!fs.existsSync(ISSUES_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(ISSUES_FILE, 'utf-8')) as UiIssuesReport;
  } catch {
    return null;
  }
}

function buildChartHeader(): ChartCardHeader {
  const report = readIssuesReport();
  const blocker = report?.summary?.blocker ?? 0;
  const warning = report?.summary?.warning ?? 0;
  const pending = blocker + warning;

  if (pending > 0) {
    return { title: `待处理 UI 回归问题（${pending}）`, template: 'red' };
  }
  if ((report?.summary?.total ?? 0) === 0) {
    return { title: 'UI 回归检查通过', template: 'blue' };
  }
  return { title: 'UI 回归结果', template: 'green' };
}

function buildSummaryMarkdown(): string {
  const report = readIssuesReport();
  const blocker = report?.summary?.blocker ?? 0;
  const warning = report?.summary?.warning ?? 0;
  const total = report?.summary?.total ?? 0;
  const review = report?.summary?.review;
  const env = process.env.PLAYWRIGHT_ENV || 'stage';
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const lines = [
    `**环境**：${env} · **生成时间**：${now}`,
    `**严重** ${blocker} · **轻微** ${warning} · **共** ${total} 项`,
  ];
  if (review && review.reviewed > 0) {
    lines.push(
      `**UI 判定**：疑似问题 ${review.uiBug} · 需人工 ${review.needsHuman} · 不稳定 ${review.unstable} · 噪声 ${review.likelyNoise}`,
    );
  }
  return lines.join('\n');
}

async function screenshotDashboardPng(): Promise<Buffer> {
  const htmlPath = writeQualityDashboard(DASHBOARD_HTML);
  const absHtml = path.resolve(htmlPath);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(pathToFileURL(absHtml).href, { waitUntil: 'load', timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 200));
    const target = page.locator('.page').first();
    const png =
      (await target.count()) > 0
        ? Buffer.from(await target.screenshot({ type: 'png' }))
        : Buffer.from(await page.screenshot({ type: 'png', fullPage: true }));
    fs.mkdirSync(path.dirname(DASHBOARD_PNG), { recursive: true });
    fs.writeFileSync(DASHBOARD_PNG, png);
    return png;
  } finally {
    await browser.close();
  }
}

function imgElement(imgKey: string, title: string): Record<string, unknown> {
  return {
    tag: 'img',
    title: { tag: 'plain_text', content: title },
    img_key: imgKey,
    mode: 'fit_horizontal',
    alt: { tag: 'plain_text', content: title },
    preview: true,
  };
}

export function isChartCardEnabled(): boolean {
  if (process.env.FEISHU_CARD_CHARTS === '0') return false;
  return loadFeishuAppConfig() !== null;
}

export async function buildChartCardElements(): Promise<ChartCardBuildResult | null> {
  const config = loadFeishuAppConfig();
  if (!config) return null;

  try {
    const token = await getFeishuAccessToken(config);
    const dashboardPng = await screenshotDashboardPng();
    const imgKey = await uploadMessageImage(token, dashboardPng, 'ui-dashboard.png');

    const elements: Array<Record<string, unknown>> = [
      imgElement(imgKey, '质量仪表盘'),
      { tag: 'div', text: { tag: 'lark_md', content: buildSummaryMarkdown() } },
    ];

    return { header: buildChartHeader(), elements };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`⚠️  飞书仪表盘截图卡片生成失败，降级为文本卡片: ${msg.slice(0, 120)}`);
    return null;
  }
}
