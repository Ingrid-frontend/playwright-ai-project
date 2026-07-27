import fs from 'fs';
import path from 'path';
import { isKnownEnv } from '../../src/utils/test-env-path.js';
import { countResolvedSpecs, type AccountProfileFilter } from './job-utils.js';

export type { AccountProfileFilter };

export type FeishuMode = 'interactive' | 'text' | 'links' | 'none';
export type NotifyOn = 'success' | 'failure';
export type JobSpecs = 'all' | string[];

export type JobSteps = {
  login: boolean;
  compare: boolean;
  compareGate: boolean;
  recordLastGreen: boolean;
  feishuNotify: boolean;
  createFeishuDoc: boolean;
  writeFeishuBitable: boolean;
  refreshLogin: boolean;
};

export type TestJobDefaults = {
  playwrightEnv: string;
  projects: string[];
  optimizedDir: string;
  stopOnTestFailure: boolean;
  stopOnCompareGate: boolean;
  runCompareAfterAbort: boolean;
  feishuMode: FeishuMode;
  notifyOn: NotifyOn[];
  steps: JobSteps;
};

export type TestJobDefinition = {
  id: string;
  enabled: boolean;
  description?: string;
  schedule: string | null;
  timezone?: string;
  playwrightEnv?: string;
  projects?: string[];
  optimizedDir?: string;
  specs?: JobSpecs;
  /** 仅执行指定账号档案的用例；不传则跑全部并按 meta 分组 login */
  accountProfile?: AccountProfileFilter;
  stopOnTestFailure?: boolean;
  stopOnCompareGate?: boolean;
  runCompareAfterAbort?: boolean;
  feishuMode?: FeishuMode;
  notifyOn?: NotifyOn[];
  steps?: Partial<JobSteps>;
};

export type TestJobsConfig = {
  version: number;
  defaults: TestJobDefaults;
  jobs: TestJobDefinition[];
};

export type ResolvedTestJob = TestJobDefaults & {
  id: string;
  enabled: boolean;
  description: string;
  schedule: string | null;
  timezone: string;
  specs: JobSpecs;
  accountProfile: AccountProfileFilter;
};

const CONFIG_PATH = path.join(process.cwd(), 'config/test-jobs.json');

const DEFAULT_STEPS: JobSteps = {
  login: true,
  compare: true,
  compareGate: false,
  recordLastGreen: true,
  feishuNotify: true,
  createFeishuDoc: false,
  writeFeishuBitable: false,
  refreshLogin: false,
};

const DEFAULT_CONFIG: TestJobsConfig = {
  version: 1,
  defaults: {
    playwrightEnv: 'stage',
    projects: ['optimized', 'optimized-webkit', 'optimized-firefox'],
    optimizedDir: 'tests/optimized',
    stopOnTestFailure: true,
    stopOnCompareGate: true,
    runCompareAfterAbort: false,
    feishuMode: 'interactive',
    notifyOn: ['failure', 'success'],
    steps: { ...DEFAULT_STEPS },
  },
  jobs: [],
};

let cached: TestJobsConfig | null = null;

function isFeishuMode(v: unknown): v is FeishuMode {
  return v === 'interactive' || v === 'text' || v === 'links' || v === 'none';
}

function mergeSteps(base: JobSteps, patch?: Partial<JobSteps>): JobSteps {
  return { ...base, ...patch };
}

export function loadTestJobsConfig(forceReload = false): TestJobsConfig {
  if (cached && !forceReload) return cached;

  if (!fs.existsSync(CONFIG_PATH)) {
    cached = { ...DEFAULT_CONFIG, defaults: { ...DEFAULT_CONFIG.defaults, steps: { ...DEFAULT_STEPS } } };
    return cached;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Partial<TestJobsConfig>;
    const defaults: Partial<TestJobDefaults> = raw.defaults ?? {};
    cached = {
      version: raw.version ?? 1,
      defaults: {
        ...DEFAULT_CONFIG.defaults,
        ...defaults,
        steps: mergeSteps(DEFAULT_STEPS, defaults.steps),
      },
      jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
    };
  } catch (e) {
    console.warn(`⚠️  无法解析 ${CONFIG_PATH}，使用默认配置`, e);
    cached = { ...DEFAULT_CONFIG, defaults: { ...DEFAULT_CONFIG.defaults, steps: { ...DEFAULT_STEPS } } };
  }

  return cached;
}

export function resolveJob(jobId: string): ResolvedTestJob {
  const config = loadTestJobsConfig();
  const job = config.jobs.find((j) => j.id === jobId);
  if (!job) {
    throw new Error(`未找到 Job: ${jobId}（请检查 config/test-jobs.json）`);
  }

  const d = config.defaults;
  const feishuMode = job.feishuMode ?? d.feishuMode;
  if (!isFeishuMode(feishuMode)) {
    throw new Error(`Job「${jobId}」feishuMode 无效: ${String(feishuMode)}`);
  }

  return {
    id: job.id,
    enabled: job.enabled !== false,
    description: job.description ?? '',
    schedule: job.schedule ?? null,
    timezone: job.timezone ?? 'Asia/Shanghai',
    playwrightEnv: job.playwrightEnv ?? d.playwrightEnv,
    projects: job.projects?.length ? [...job.projects] : [...d.projects],
    optimizedDir: job.optimizedDir ?? d.optimizedDir,
    specs: job.specs ?? 'all',
    accountProfile: job.accountProfile ?? null,
    stopOnTestFailure: job.stopOnTestFailure ?? d.stopOnTestFailure,
    stopOnCompareGate: job.stopOnCompareGate ?? d.stopOnCompareGate,
    runCompareAfterAbort: job.runCompareAfterAbort ?? d.runCompareAfterAbort,
    feishuMode,
    notifyOn: job.notifyOn?.length ? [...job.notifyOn] : [...d.notifyOn],
    steps: mergeSteps(d.steps, job.steps),
  };
}

export function listJobs(): ResolvedTestJob[] {
  const config = loadTestJobsConfig();
  return config.jobs.map((j) => resolveJob(j.id));
}

export function resolveJobRunEnv(job: ResolvedTestJob, override?: string): string {
  const env = String(override ?? job.playwrightEnv ?? 'stage').trim();
  if (!isKnownEnv(env)) {
    throw new Error(`未知环境: ${env}（请在 datasource/base-config.json 中配置）`);
  }
  return env;
}

export function countJobSpecsForEnv(
  job: ResolvedTestJob,
  playwrightEnv: string,
  accountProfile?: AccountProfileFilter,
): number {
  const filter = accountProfile ?? job.accountProfile;
  return countResolvedSpecs(job.specs, job.optimizedDir, playwrightEnv, filter);
}

export function countJobSpecs(job: ResolvedTestJob, accountProfile?: AccountProfileFilter): number {
  const filter = accountProfile ?? job.accountProfile;
  return countResolvedSpecs(job.specs, job.optimizedDir, job.playwrightEnv, filter);
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
