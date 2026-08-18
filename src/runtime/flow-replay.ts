import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export type FlowFrame = { abs: string; label: string };

export function toStudioPublicPath(abs: string, cwd = process.cwd()): string {
  const rel = path.relative(cwd, abs).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return '';
  return `/${rel}`;
}

export function toRepoRel(abs: string, cwd = process.cwd()): string | undefined {
  const rel = path.relative(cwd, abs).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return undefined;
  return rel;
}

function ffmpegBin(): string | null {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(cmd, ['ffmpeg'], { encoding: 'utf8' });
  const line = String(r.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  return r.status === 0 && line ? line : null;
}

export function tryEncodePngsToWebm(frames: FlowFrame[], destAbs: string): boolean {
  const pngs = frames.filter((f) => fs.existsSync(f.abs));
  const bin = ffmpegBin();
  if (!bin || pngs.length === 0) return false;
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  const listPath = `${destAbs}.ffconcat.txt`;
  const lines: string[] = ['ffconcat version 1.0'];
  for (const frame of pngs) {
    lines.push(`file ${JSON.stringify(frame.abs)}`);
    lines.push('duration 1.2');
  }
  lines.push(`file ${JSON.stringify(pngs[pngs.length - 1].abs)}`);
  fs.writeFileSync(listPath, `${lines.join('\n')}\n`);
  const r = spawnSync(
    bin,
    ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-pix_fmt', 'yuv420p', destAbs],
    { encoding: 'utf8' },
  );
  try {
    fs.unlinkSync(listPath);
  } catch {
    /* ignore */
  }
  return r.status === 0 && fs.existsSync(destAbs) && fs.statSync(destAbs).size > 0;
}

export async function savePlaywrightVideo(
  video: { path: () => Promise<string> } | null | undefined,
  destAbs: string,
): Promise<string | undefined> {
  if (!video) return undefined;
  try {
    const src = await video.path();
    if (!src || !fs.existsSync(src)) return undefined;
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.copyFileSync(src, destAbs);
    return destAbs;
  } catch {
    return undefined;
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function writeFlowReplay(opts: {
  outputDir: string;
  title: string;
  videoAbs?: string;
  frames?: FlowFrame[];
}): { videoRel?: string; replayRel?: string } {
  const outputDir = path.resolve(opts.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const frames = (opts.frames || []).filter((f) => f.abs && fs.existsSync(f.abs));
  let videoAbs = opts.videoAbs && fs.existsSync(opts.videoAbs) ? opts.videoAbs : undefined;
  if (!videoAbs && frames.length > 0) {
    const encoded = path.join(outputDir, 'flow.webm');
    if (tryEncodePngsToWebm(frames, encoded)) videoAbs = encoded;
  }

  const videoRel = videoAbs ? toRepoRel(videoAbs) : undefined;
  const videoSrc = videoAbs ? (path.dirname(videoAbs) === outputDir ? './flow.webm' : toStudioPublicPath(videoAbs)) : '';
  const frameTags = frames
    .map((f, i) => {
      const src = toStudioPublicPath(f.abs);
      if (!src) return '';
      return `<figure data-i="${i}"${i === 0 ? ' class="on"' : ''}><img src="${escHtml(src)}" alt=""><figcaption>${escHtml(f.label || `步骤 ${i + 1}`)}</figcaption></figure>`;
    })
    .filter(Boolean)
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(opts.title || '流程回放')}</title>
<style>
  body { margin: 0; background: #0a0c10; color: #eef2f8; font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; }
  header { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,.08); }
  h1 { margin: 0; font-size: 15px; font-weight: 650; }
  .hint { color: #8899b2; margin-top: 4px; }
  video { display: block; width: 100%; max-height: 70vh; background: #000; }
  .slides { position: relative; min-height: 240px; }
  figure { display: none; margin: 0; }
  figure.on { display: block; }
  img { display: block; width: 100%; max-height: 70vh; object-fit: contain; background: #000; }
  figcaption { padding: 8px 14px; color: #a8b6cc; }
  .nav { padding: 8px 14px 16px; display: flex; gap: 8px; align-items: center; }
  button { background: #1c2230; color: #eef2f8; border: 1px solid rgba(255,255,255,.12); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
</style>
</head>
<body>
<header>
  <h1>${escHtml(opts.title || '流程回放')}</h1>
  <div class="hint">${videoSrc ? '全程录像' : frames.length ? '按步骤截图回放' : '本次没有可回放内容'}</div>
</header>
${videoSrc ? `<video src="${escHtml(videoSrc)}" controls autoplay></video>` : ''}
${frameTags ? `<div class="slides" id="slides">${frameTags}</div>
<div class="nav">
  <button type="button" id="prev">上一张</button>
  <button type="button" id="play">自动播放</button>
  <button type="button" id="next">下一张</button>
  <span id="pos"></span>
</div>
<script>
const figs = Array.from(document.querySelectorAll('#slides figure'));
let i = 0, timer = null;
function show(n) {
  if (!figs.length) return;
  i = (n + figs.length) % figs.length;
  figs.forEach((f, k) => f.classList.toggle('on', k === i));
  document.getElementById('pos').textContent = (i + 1) + ' / ' + figs.length;
}
function play() {
  if (timer) { clearInterval(timer); timer = null; document.getElementById('play').textContent = '自动播放'; return; }
  timer = setInterval(() => show(i + 1), 1200);
  document.getElementById('play').textContent = '暂停';
}
document.getElementById('prev').onclick = () => show(i - 1);
document.getElementById('next').onclick = () => show(i + 1);
document.getElementById('play').onclick = play;
show(0);
if (!document.querySelector('video')) play();
</script>` : ''}
</body>
</html>
`;
  const htmlAbs = path.join(outputDir, 'flow.html');
  fs.writeFileSync(htmlAbs, html);
  return { videoRel, replayRel: toRepoRel(htmlAbs) };
}

export function framesFromStepScreenshots(
  steps: Array<{ id?: string; screenshot?: string }>,
): FlowFrame[] {
  const out: FlowFrame[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    const abs = step.screenshot ? path.resolve(step.screenshot) : '';
    if (!abs || !fs.existsSync(abs) || seen.has(abs)) continue;
    seen.add(abs);
    out.push({ abs, label: step.id || path.basename(abs) });
  }
  return out;
}
