import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { promoteStepsToGolden } from './baseline-manager.js';

export const VISUAL_REVIEW_PATH = 'results/visual-review.json';

export type VisualReviewVerdict = 'approved' | 'rejected';

export interface VisualReviewDecision {
  issueId: string;
  verdict: VisualReviewVerdict;
  scriptKey: string;
  stepFileName: string;
  browser: string;
  runTimestamp: string;
  decidedAt: string;
}

export interface VisualReviewFile {
  generatedAt: string;
  decisions: VisualReviewDecision[];
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export function loadVisualReview(filePath = VISUAL_REVIEW_PATH): VisualReviewFile {
  return readJson<VisualReviewFile>(filePath, { generatedAt: new Date().toISOString(), decisions: [] });
}

export function saveVisualReview(file: VisualReviewFile, filePath = VISUAL_REVIEW_PATH): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  file.generatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(file, null, 2), 'utf-8');
}

export function upsertDecision(decision: Omit<VisualReviewDecision, 'decidedAt'>): VisualReviewDecision {
  const file = loadVisualReview();
  const next: VisualReviewDecision = { ...decision, decidedAt: new Date().toISOString() };
  file.decisions = file.decisions.filter((d) => d.issueId !== next.issueId);
  file.decisions.push(next);
  saveVisualReview(file);
  return next;
}

export function applyDecision(decision: Omit<VisualReviewDecision, 'decidedAt'>): {
  decision: VisualReviewDecision;
  copied?: number;
  goldenDir?: string;
} {
  const saved = upsertDecision(decision);
  if (saved.verdict !== 'approved') {
    return { decision: saved };
  }
  const { copied, goldenDir } = promoteStepsToGolden({
    scriptKey: saved.scriptKey,
    sourceRunTimestamp: saved.runTimestamp,
    browser: saved.browser,
    stepFileNames: [saved.stepFileName],
  });
  return { decision: saved, copied, goldenDir };
}

function printHelp(): void {
  console.log(`用法: npm run visual-review -- [选项]

选项:
  --verdict=approved|rejected
  --script=<scriptKey>
  --run=<timestamp>
  --step=<file.png>
  --browser=chrome|webkit
  --issueId=<id>
`);
}

function parseArgs(argv: string[]): {
  verdict?: VisualReviewVerdict;
  script?: string;
  run?: string;
  step?: string;
  browser: string;
  issueId?: string;
} {
  let verdict: VisualReviewVerdict | undefined;
  let script: string | undefined;
  let run: string | undefined;
  let step: string | undefined;
  let browser = 'chrome';
  let issueId: string | undefined;

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith('--verdict=')) {
      const v = arg.slice('--verdict='.length).trim();
      if (v === 'approved' || v === 'rejected') verdict = v;
      continue;
    }
    if (arg.startsWith('--script=')) {
      script = arg.slice('--script='.length).trim();
      continue;
    }
    if (arg.startsWith('--run=')) {
      run = arg.slice('--run='.length).trim();
      continue;
    }
    if (arg.startsWith('--step=')) {
      step = arg.slice('--step='.length).trim();
      continue;
    }
    if (arg.startsWith('--browser=')) {
      browser = arg.slice('--browser='.length).trim().toLowerCase();
      continue;
    }
    if (arg.startsWith('--issueId=')) {
      issueId = arg.slice('--issueId='.length).trim();
      continue;
    }
  }

  return { verdict, script, run, step, browser, issueId };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.verdict || !opts.script || !opts.run || !opts.step) {
    console.error('❌ 需要 --verdict --script --run --step');
    printHelp();
    process.exit(1);
  }

  const result = applyDecision({
    issueId: opts.issueId || `${opts.script}|${opts.step}|${opts.browser}`,
    verdict: opts.verdict,
    scriptKey: opts.script,
    stepFileName: path.basename(opts.step),
    browser: opts.browser,
    runTimestamp: opts.run,
  });

  console.log(`✅ Visual Review: ${result.decision.verdict} · ${result.decision.stepFileName}`);
  if (result.copied != null) {
    console.log(`   Golden 已更新 ${result.copied} 张 → ${result.goldenDir}`);
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === thisFile) {
  main();
}
