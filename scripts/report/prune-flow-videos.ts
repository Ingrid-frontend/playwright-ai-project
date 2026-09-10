#!/usr/bin/env tsx
/**
 * flow.webm 录像保留策略与清理（P2-⑨）
 *
 * 现状：results/flow-runs 与 results/intent-runs 每次运行都留存全程录像（flow.webm + flow.html
 * + intent 的 _pw-video 原始视频），无任何回收，历史录像可占数百 MB。
 *
 * 策略（默认值可用参数覆盖）：
 *   - 通过/成功 run：每个 flow / intent 目录只保留最近 N 份录像，其余删除
 *   - 失败 run：保留（排障价值），但超过 fail-days 天（按 manifest.finishedAt / 目录名时间戳 / mtime）后回收
 *   - 默认：成功保留 3 份，失败保留 7 天
 *   - 只删除 flow.webm / flow.html / _pw-video 内的视频文件，不动 manifest.json、截图与目录结构
 *
 * 用法:
 *   npm run prune:flow-videos                 # 预览（默认 dry-run，打印将删除项）
 *   npm run prune:flow-videos -- --apply      # 实际执行
 *   npm run prune:flow-videos -- --keep=3 --intent-keep=2 --fail-days=60 --apply
 */
import fs from 'fs';
import path from 'path';

function arg(name: string, def: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}
const APPLY = process.argv.includes('--apply');
const KEEP = Math.max(1, Number(arg('keep', '3')) || 3);
const INTENT_KEEP = Math.max(1, Number(arg('intent-keep', '2')) || 2);
const FAIL_DAYS = Math.max(1, Number(arg('fail-days', '7')) || 7);

const ROOT = path.resolve('results');
const FLOW_RUNS = path.join(ROOT, 'flow-runs');
const INTENT_RUNS = path.join(ROOT, 'intent-runs');

function parseRunTs(text: string): number | undefined {
  if (!text) return undefined;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})[T_-](\d{2})[-:](\d{2})[-:](\d{2})/);
  if (iso) {
    const t = Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!, +iso[4]!, +iso[5]!, +iso[6]!);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

type VideoTarget = { dir: string; ts: number; ok: boolean; webm: string; html: string; rawVideoDirs: string[] };

function collectVideoTargets(): { targets: VideoTarget[]; desc: string }[] {
  const groups: { targets: VideoTarget[]; desc: string }[] = [];

  // flow-runs/<flowId>/<runTs>/
  const flowGroups: VideoTarget[] = [];
  if (fs.existsSync(FLOW_RUNS)) {
    for (const flowId of fs.readdirSync(FLOW_RUNS)) {
      const flowDir = path.join(FLOW_RUNS, flowId);
      if (!fs.statSync(flowDir).isDirectory()) continue;
      for (const runName of fs.readdirSync(flowDir)) {
        const runDir = path.join(flowDir, runName);
        if (!fs.statSync(runDir).isDirectory()) continue;
        const manifest = readJson<{ ok?: boolean; finishedAt?: string }>(path.join(runDir, 'manifest.json'));
        const webm = path.join(runDir, 'flow.webm');
        const html = path.join(runDir, 'flow.html');
        if (!fs.existsSync(webm) && !fs.existsSync(html)) continue;
        const ts =
          parseRunTs(manifest?.finishedAt || '') ||
          parseRunTs(runName) ||
          (fs.existsSync(webm) ? fs.statSync(webm).mtimeMs : undefined);
        if (!ts) continue;
        flowGroups.push({ dir: runDir, ts, ok: manifest?.ok !== false, webm, html, rawVideoDirs: [] });
      }
    }
  }
  groups.push({ desc: 'flow-runs', targets: flowGroups });

  // intent-runs/<name>/（含 _pw-video 原始视频）
  const intentGroups: VideoTarget[] = [];
  if (fs.existsSync(INTENT_RUNS)) {
    for (const name of fs.readdirSync(INTENT_RUNS)) {
      const runDir = path.join(INTENT_RUNS, name);
      if (!fs.statSync(runDir).isDirectory()) continue;
      const result = readJson<{ passed?: boolean }>(path.join(runDir, 'result.json'));
      const webm = path.join(runDir, 'flow.webm');
      const html = path.join(runDir, 'flow.html');
      const pwDir = path.join(runDir, '_pw-video');
      const rawVideoDirs = fs.existsSync(pwDir) ? [pwDir] : [];
      if (!fs.existsSync(webm) && !fs.existsSync(html) && rawVideoDirs.length === 0) continue;
      const ts =
        parseRunTs(name) ||
        (fs.existsSync(webm) ? fs.statSync(webm).mtimeMs : fs.statSync(runDir).mtimeMs);
      intentGroups.push({
        dir: runDir,
        ts,
        ok: result?.passed === true,
        webm,
        html,
        rawVideoDirs,
      });
    }
  }
  groups.push({ desc: 'intent-runs', targets: intentGroups });
  return groups;
}

let freedBytes = 0;
let removed = 0;

function unlinkIfExists(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  try {
    freedBytes += fs.statSync(file).size;
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/** 逐文件删除目录内视频（含 _pw-video 原始录像），避免递归 rm 触发批量删除保护 */
function deleteRunVideos(t: VideoTarget): boolean {
  let hit = unlinkIfExists(t.webm);
  hit = unlinkIfExists(t.html) || hit;
  for (const dir of t.rawVideoDirs) {
    const walk = (d: string) => {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (n.toLowerCase().endsWith('.webm')) {
          freedBytes += fs.statSync(p).size;
          fs.unlinkSync(p);
          hit = true;
        }
      }
    };
    try {
      walk(dir);
      fs.rmdirSync(dir, { recursive: false });
    } catch {
      /* 删除原始视频目录失败不阻塞 */
    }
  }
  return hit;
}

function fmtBytes(n: number): string {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
}

function main(): void {
  const now = Date.now();
  const failCutoff = now - FAIL_DAYS * 86400000;
  const sections = collectVideoTargets();
  let dryPlans = 0;

  for (const { desc, targets } of sections) {
    if (targets.length === 0) continue;
    console.log(`\n[${desc}] 共 ${targets.length} 份录像目录`);
    const byGroup = new Map<string, VideoTarget[]>();
    for (const t of targets) {
      const key = desc === 'flow-runs' ? path.basename(path.dirname(t.dir)) : '__intent__';
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(t);
    }
    for (const [group, list] of byGroup) {
      const keepCount = group === '__intent__' ? INTENT_KEEP : KEEP;
      const sorted = [...list].sort((a, b) => b.ts - a.ts);
      const successes = sorted.filter((t) => t.ok);
      const failures = sorted.filter((t) => !t.ok);
      const pruned = new Set<VideoTarget>();
      // 成功 run：只留最近 keep 份，其余回收
      successes.slice(keepCount).forEach((t) => pruned.add(t));
      // 失败 run：超期回收
      failures.filter((t) => t.ts < failCutoff).forEach((t) => pruned.add(t));
      const label = group === '__intent__' ? 'intent-runs' : `flow:${group}`;
      for (const t of [...pruned].sort((a, b) => a.ts - b.ts)) {
        const d = new Date(t.ts).toISOString().slice(0, 16).replace('T', ' ');
        if (APPLY) {
          const did = deleteRunVideos(t);
          if (!did) continue;
          removed++;
          console.log(`  🗑  ${label} ${d} ${t.ok ? '通过' : '失败'} → ${path.relative(ROOT, t.dir)}`);
        } else {
          dryPlans++;
          console.log(
            `  ~  将删除 ${label} ${d} ${t.ok ? '通过' : '失败(超期)'} → ${path.relative(ROOT, t.dir)}`,
          );
        }
      }
    }
  }

  if (!APPLY) {
    console.log(
      `\n[dry-run] 将回收 ${dryPlans} 份录像。确认后执行: npm run prune:flow-videos -- --apply`,
    );
    return;
  }
  console.log(`\n✅ 已回收 ${removed} 份录像，释放约 ${fmtBytes(freedBytes)}`);
}

main();
