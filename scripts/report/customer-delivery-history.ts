import fs from 'fs';
import path from 'path';
import type { DeliveryPayload } from './customer-delivery-payload.js';

const HISTORY_DIR = 'results/history';
const HISTORY_FILE = path.join(HISTORY_DIR, 'customer-delivery-history.json');
const MAX_ENTRIES_PER_ENV = 30;

export type DeliveryHistoryEntry = {
  generatedAt: string;
  deliveryId: string;
  envId: string;
  contentHash: string;
  stats: {
    expectedSteps: number;
    comparedSteps: number;
    passSteps: number;
    regressSteps: number;
    minorSteps: number;
    degradedSteps: number;
    benignSteps: number;
    coveragePct: number;
    passRate: number;
  };
  verdict: string;
  shipAdvice: string;
};

type HistoryStore = Record<string, DeliveryHistoryEntry[]>;

function readHistoryStore(): HistoryStore {
  const abs = path.resolve(HISTORY_FILE);
  if (!fs.existsSync(abs)) return {};
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8')) as HistoryStore;
  } catch {
    return {};
  }
}

function writeHistoryStore(store: HistoryStore): void {
  const abs = path.resolve(HISTORY_FILE);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(store, null, 2), 'utf-8');
}

export function appendDeliveryHistory(payload: DeliveryPayload): void {
  const envId = payload.envId || '_default';
  const store = readHistoryStore();
  const entries = store[envId] || [];

  const entry: DeliveryHistoryEntry = {
    generatedAt: payload.generatedAt,
    deliveryId: payload.deliveryId,
    envId: payload.envId || '',
    contentHash: payload.contentHash,
    stats: {
      expectedSteps: payload.stats.expectedSteps,
      comparedSteps: payload.stats.comparedSteps,
      passSteps: payload.stats.passSteps,
      regressSteps: payload.stats.regressSteps,
      minorSteps: payload.stats.minorSteps,
      degradedSteps: payload.stats.degradedSteps,
      benignSteps: payload.stats.benignSteps,
      coveragePct: payload.stats.coveragePct,
      passRate: payload.stats.passRate,
    },
    verdict: payload.headline,
    shipAdvice: payload.shipAdvice,
  };

  const deduped = entries.filter((e) => e.deliveryId !== entry.deliveryId);
  deduped.push(entry);
  deduped.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));

  if (deduped.length > MAX_ENTRIES_PER_ENV) {
    deduped.splice(0, deduped.length - MAX_ENTRIES_PER_ENV);
  }

  store[envId] = deduped;
  writeHistoryStore(store);
}

export function readDeliveryHistory(envId?: string): DeliveryHistoryEntry[] {
  const store = readHistoryStore();
  if (envId) return store[envId] || [];
  return Object.values(store).flat().sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
}

export type DeliveryTrendSummary = {
  entries: DeliveryHistoryEntry[];
  current: DeliveryHistoryEntry | null;
  previous: DeliveryHistoryEntry | null;
  regressDelta: number;
  passRateDelta: number;
  coverageDelta: number;
};

export function buildDeliveryTrend(envId?: string, lastN = 7): DeliveryTrendSummary {
  const all = readDeliveryHistory(envId);
  const entries = all.slice(-lastN);
  const current = entries.length > 0 ? entries[entries.length - 1]! : null;
  const previous = entries.length > 1 ? entries[entries.length - 2]! : null;

  return {
    entries,
    current,
    previous,
    regressDelta: current && previous ? current.stats.regressSteps - previous.stats.regressSteps : 0,
    passRateDelta: current && previous ? current.stats.passRate - previous.stats.passRate : 0,
    coverageDelta: current && previous ? current.stats.coveragePct - previous.stats.coveragePct : 0,
  };
}
