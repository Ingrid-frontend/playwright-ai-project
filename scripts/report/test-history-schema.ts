export type TestHistoryError = {
  testFile: string;
  testName: string;
  error: string;
  isFlake: boolean;
};

export type TestHistoryEntry = {
  id: string;
  runAt: string;
  gitSha?: string;
  env: string;
  browserProjects?: string[];
  passed: boolean;
  failed: number;
  flakeFailed: number;
  durationMs: number;
  errors: TestHistoryError[];
  uiMetrics?: {
    blocker: number;
    warning: number;
    total: number;
  };
};

export type TestHistoryFile = {
  schemaVersion: 1;
  entries: TestHistoryEntry[];
};
