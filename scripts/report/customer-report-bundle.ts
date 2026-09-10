import type { ChangeNature } from './change-nature.js';
import type { CustomerIssueGroup, CustomerPageCard } from './customer-report-model.js';
import type { ImpactTier } from './coverage-stats.js';
import { regionZoneLabel } from './customer-report-naming.js';

/** 首屏展示项：单步问题，或同源公共布局合并为一条 */
export type CustomerRegressionDisplayItem =
  | { kind: 'single'; group: CustomerIssueGroup; anchorId: string }
  | {
      kind: 'shared';
      bundleKey: string;
      anchorId: string;
      title: string;
      reason: string;
      natureLabel: string;
      impactTier: ImpactTier;
      maxDifferenceLabel: string;
      affectedSteps: number;
      stepTitles: string[];
      groups: CustomerIssueGroup[];
    };

function topRegion(page: CustomerPageCard) {
  const card = page.browsers[0];
  if (!card) return null;
  return card.regions.find((r) => r.actionable) ?? card.regions[0] ?? null;
}

/** 左侧导航 / 顶栏等跨步骤共用的布局区，中部主内容区不归入 */
export function isChromeLayoutRegion(
  r: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): boolean {
  if (width <= 0 || height <= 0) return false;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const inMain =
    cx >= width * 0.28 && cx <= width * 0.72 && cy >= height * 0.22 && cy <= height * 0.78;
  if (inMain) return false;
  return cx < width * 0.32 || cy < height * 0.22;
}

export function sharedChromeKeyForPage(page: CustomerPageCard): string | null {
  if (page.worstStatus !== 'regress' || page.processOnly) return null;
  const region = topRegion(page);
  const card = page.browsers[0];
  if (!region || !card) return null;
  const w = card.imageWidth || 1280;
  const h = card.imageHeight || 720;
  if (!isChromeLayoutRegion(region, w, h)) return null;
  const zone = regionZoneLabel(region, w, h);
  const nature = (region.nature || 'content') as ChangeNature;
  return `${page.scriptKey}::chrome::${zone}::${nature}`;
}

function bundleTitle(zone: string): string {
  if (zone.includes('左侧') || zone.includes('上部')) return `公共布局变化（${zone}）`;
  return `公共布局变化（${zone}）`;
}

function pickRepresentativeGroup(groups: CustomerIssueGroup[]): CustomerIssueGroup {
  return [...groups].sort((a, b) => {
    const da = Math.max(a.representative.maxDifference, ...a.others.map((p) => p.maxDifference));
    const db = Math.max(b.representative.maxDifference, ...b.others.map((p) => p.maxDifference));
    if (db !== da) return db - da;
    return a.representative.stepNumber - b.representative.stepNumber;
  })[0]!;
}

export function buildRegressionDisplay(
  groups: CustomerIssueGroup[],
  pages: CustomerPageCard[],
): CustomerRegressionDisplayItem[] {
  const keyByPage = new Map(pages.map((p) => [p.pageKey, sharedChromeKeyForPage(p)]));
  const sharedBuckets = new Map<string, CustomerIssueGroup[]>();
  const singles: CustomerIssueGroup[] = [];

  for (const group of groups) {
    const key = keyByPage.get(group.representative.pageKey);
    if (!key) {
      singles.push(group);
      continue;
    }
    if (!sharedBuckets.has(key)) sharedBuckets.set(key, []);
    sharedBuckets.get(key)!.push(group);
  }

  const items: CustomerRegressionDisplayItem[] = [];

  for (const [bundleKey, members] of sharedBuckets) {
    if (members.length < 2) {
      singles.push(...members);
      continue;
    }
    const sorted = [...members].sort(
      (a, b) => a.representative.stepNumber - b.representative.stepNumber,
    );
    const rep = pickRepresentativeGroup(sorted);
    const region = topRegion(rep.representative);
    const w = rep.representative.browsers[0]?.imageWidth || 1280;
    const h = rep.representative.browsers[0]?.imageHeight || 720;
    const zone = region ? regionZoneLabel(region, w, h) : '页面布局区';
    const affectedSteps = sorted.reduce((sum, g) => sum + g.affectedSteps, 0);
    const impactTier = sorted.reduce<ImpactTier>((worst, g) => {
      const rank = { benign: 1, degraded: 2, blocking: 3 } as const;
      return rank[g.impactTier] > rank[worst] ? g.impactTier : worst;
    }, 'benign');
    items.push({
      kind: 'shared',
      bundleKey,
      anchorId: '',
      title: bundleTitle(zone),
      reason: rep.reason || '公共布局区域与验收基线不一致',
      natureLabel: rep.natureLabel,
      impactTier,
      maxDifferenceLabel: rep.maxDifferenceLabel,
      affectedSteps,
      stepTitles: sorted.map((g) => g.title),
      groups: sorted,
    });
  }

  for (const group of singles) {
    items.push({ kind: 'single', group, anchorId: group.anchorId });
  }

  const rank = { benign: 1, degraded: 2, blocking: 3 } as const;
  items.sort((a, b) => {
    const tierA = a.kind === 'shared' ? a.impactTier : a.group.impactTier;
    const tierB = b.kind === 'shared' ? b.impactTier : b.group.impactTier;
    if (rank[tierB] !== rank[tierA]) return rank[tierB] - rank[tierA];
    const da =
      a.kind === 'shared'
        ? parseFloat(a.maxDifferenceLabel)
        : parseFloat(a.group.maxDifferenceLabel);
    const db =
      b.kind === 'shared'
        ? parseFloat(b.maxDifferenceLabel)
        : parseFloat(b.group.maxDifferenceLabel);
    if (db !== da) return db - da;
    const stepsA = a.kind === 'shared' ? a.affectedSteps : a.group.affectedSteps;
    const stepsB = b.kind === 'shared' ? b.affectedSteps : b.group.affectedSteps;
    return stepsB - stepsA;
  });

  items.forEach((item, i) => {
    const id = `issue-${i + 1}`;
    if (item.kind === 'shared') {
      item.anchorId = id;
      item.groups.forEach((g, idx) => {
        g.anchorId = `${id}-s${idx + 1}`;
      });
    } else {
      item.group.anchorId = id;
      item.anchorId = id;
    }
  });

  return items;
}

export function regressionDisplayCount(items: CustomerRegressionDisplayItem[]): number {
  return items.length;
}
