import fs from 'fs';
import path from 'path';

const TEST_RUNS_DIR = path.join('results', 'history', 'test-runs');

export type FlakeDayPoint = {
  date: string;
  runs: number;
  failed: number;
  flakeFailed: number;
  flakeRate: number;
};

export type FlakeDashboard = {
  trend: FlakeDayPoint[];
  latest: FlakeDayPoint | null;
  previous: FlakeDayPoint | null;
};

type HistoryFile = {
  entries?: Array<{
    passed?: boolean;
    failed?: number;
    flakeFailed?: number;
  }>;
};

function readJson(file: string): HistoryFile | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as HistoryFile;
  } catch {
    return null;
  }
}

export function loadFlakeHistory(dir = TEST_RUNS_DIR): FlakeDashboard {
  if (!fs.existsSync(dir)) {
    return { trend: [], latest: null, previous: null };
  }
  const trend = fs
    .readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .map((name) => {
      const date = name.slice(0, 10);
      const file = readJson(path.join(dir, name));
      const entries = file?.entries || [];
      const runs = entries.length;
      const failed = entries.reduce((sum, e) => sum + (Number(e.failed) || 0), 0);
      const flakeFailed = entries.reduce((sum, e) => sum + (Number(e.flakeFailed) || 0), 0);
      const flakeRate = failed > 0 ? flakeFailed / failed : 0;
      return { date, runs, failed, flakeFailed, flakeRate };
    });
  const latest = trend[trend.length - 1] ?? null;
  const previous = trend.length > 1 ? trend[trend.length - 2]! : null;
  return { trend, latest, previous };
}
