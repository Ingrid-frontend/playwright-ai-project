#!/usr/bin/env tsx
/**
 * 从申请单/审批流程步骤截图生成 flow.html 回放页。
 */
import fs from 'fs';
import path from 'path';
import { writeFlowReplay } from '../../src/runtime/flow-replay.js';
import {
  flowLabel,
  flowRunsDir,
  flowScreenshotRoot,
  screenshotRunSegment,
  specSlug,
  type FlowId,
} from '../../src/utils/flow-run-report.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (key: string) => {
    const hit = args.find((a) => a.startsWith(`--${key}=`));
    return hit ? hit.split('=').slice(1).join('=').trim() : '';
  };
  return {
    flowId: (get('flow') || 'request-flow') as FlowId,
    runId: get('run'),
    env: get('env') || 'dev',
    spec: get('spec') || 'request/full-flow.spec.ts',
    roleSlug: get('role'),
    title: get('title'),
  };
}

function stepLabel(filename: string): string {
  const m = filename.match(/^step-(\d+)-(.+?)__/);
  if (!m) return filename.replace(/\.png$/, '');
  return `步骤 ${m[1]} · ${m[2].replace(/-/g, ' ')}`;
}

function collectFrames(runDir: string) {
  if (!fs.existsSync(runDir)) return [];
  const files = fs.readdirSync(runDir).filter((f) => /^step-\d+/.test(f) && f.endsWith('.png'));
  const byStep = new Map<number, string>();
  for (const f of files) {
    const m = f.match(/^step-(\d+)/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    const isNormal = f.includes('__normal');
    const prev = byStep.get(n);
    if (!prev || (isNormal && !prev.includes('__normal'))) byStep.set(n, f);
  }
  return [...byStep.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, f]) => ({
      abs: path.join(runDir, f),
      label: stepLabel(f),
    }))
    .filter((f) => fs.existsSync(f.abs));
}

function resolveRunDir(root: string, runId: string): string {
  const seg = screenshotRunSegment();
  const direct = path.join(root, seg, runId);
  if (fs.existsSync(direct)) return direct;
  if (!fs.existsSync(root)) return direct;
  for (const name of fs.readdirSync(root)) {
    if (!name.startsWith('run-')) continue;
    const p = path.join(root, name, runId);
    if (fs.existsSync(p)) return p;
  }
  return direct;
}

function main() {
  const opts = parseArgs();
  if (!opts.runId) {
    console.error('缺少 --run');
    process.exit(1);
  }

  const outDir = path.join(flowRunsDir(opts.flowId), opts.runId);
  fs.mkdirSync(outDir, { recursive: true });
  const videoAbs = path.join(outDir, 'flow.webm');
  const hasVideo = fs.existsSync(videoAbs);

  const root = flowScreenshotRoot(opts.flowId, opts.env, opts.spec, opts.roleSlug || undefined);
  const runDir = resolveRunDir(root, opts.runId);
  const frames = collectFrames(runDir);
  if (!frames.length && !hasVideo) {
    console.log('无步骤截图或录像，跳过回放生成');
    process.exit(0);
  }

  const title = opts.title || `${flowLabel(opts.flowId)} · ${specSlug(opts.spec)}`;
  const { replayRel, videoRel } = writeFlowReplay({
    outputDir: outDir,
    title,
    frames: hasVideo ? [] : frames,
    videoAbs: hasVideo ? videoAbs : undefined,
  });
  if (videoRel) console.log(`已关联录像: ${videoRel}`);
  if (replayRel) console.log(`已生成回放: ${replayRel}`);
}

main();
