import fs from "fs";
import path from "path";
import { isDateCategoryDirSegment } from "./date-category.js";
import { parseOptimizedRel, buildScreenshotDir, getLegacyEnvDefault } from "./test-env-path.js";

const RUN_SEGMENT_RE = /^run-(chromium|webkit|firefox|safari|edge)-optimized$/i;
/** 同一次 Job（Chrome + WebKit 串跑）内 timestamp 目录的最大时间差 */
const LATEST_RUN_WINDOW_MS = 5 * 60 * 1000;

function resolveScreenshotDirRel(repoRoot?: any, specRel?: any) {
  const abs = path.join(repoRoot, specRel);
  if (fs.existsSync(abs)) {
    const code = fs.readFileSync(abs, "utf8");
    const m = code.match(/withScreenshotRunSegment\(['"]([^'"]+)['"]\)/);
    if (m && m[1] && !m[1].includes("..")) {
      return m[1].replace(/\\/g, "/");
    }
  }

  const parsed = parseOptimizedRel(specRel, repoRoot);
  if (!parsed) return null;

  const stem = parsed.fileName.replace(/\.optimized\.spec\.ts$/, "");
  const dateCategory = parsed.segments.filter((s) => isDateCategoryDirSegment(s)).pop() || "";
  return buildScreenshotDir({
    playwrightEnv: parsed.env || getLegacyEnvDefault(repoRoot),
    dateCategory,
    fileName: stem,
    repoRoot,
  });
}

function assertSafeScreenshotDirRel(repoRoot?: any, dirRel?: any) {
  const norm = String(dirRel || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!norm.startsWith("screenshots/") || norm.includes("..")) {
    throw new Error("截图目录非法");
  }
  const abs = path.resolve(repoRoot, norm);
  const base = path.resolve(repoRoot, "screenshots");
  if (!abs.startsWith(base + path.sep)) {
    throw new Error("截图目录超出允许范围");
  }
  return { abs, rel: norm };
}

function resolveDiffsDirRel(screenshotDirRel?: any) {
  const suffix = screenshotDirRel.replace(/^screenshots\//, "");
  return `results/diffs/${suffix}`;
}

function toRepoRel(repoRoot?: any, absPath?: any) {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

function listRunTimestampEntries(screenshotDirAbs?: any) {
  const entries: any[] = [];
  if (!fs.existsSync(screenshotDirAbs)) return entries;

  for (const seg of fs.readdirSync(screenshotDirAbs, { withFileTypes: true })) {
    if (!seg.isDirectory() || !RUN_SEGMENT_RE.test(seg.name)) continue;
    const segPath = path.join(screenshotDirAbs, seg.name);
    let tsEnts;
    try {
      tsEnts = fs.readdirSync(segPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ts of tsEnts) {
      if (!ts.isDirectory()) continue;
      const full = path.join(segPath, ts.name);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      entries.push({
        segment: seg.name,
        timestamp: ts.name,
        path: full,
        mtime: st.mtimeMs,
      });
    }
  }
  return entries;
}

function pickLatestRunEntries(entries?: any, windowMs: any = LATEST_RUN_WINDOW_MS) {
  if (!entries.length) return [];
  const sorted = [...entries].sort((a, b) => b.mtime - a.mtime);
  const latest = sorted[0].mtime;
  return sorted.filter((e) => latest - e.mtime <= windowMs);
}

/**
 * @param {'all'|'latest'} mode
 * @param {{ cleanDiffs?: boolean, latestRunWindowMs?: number }} opts
 */
function cleanSpecScreenshots(repoRoot?: any, specRel?: any, opts: any = {}) {
  const mode = opts.mode === "latest" ? "latest" : "all";
  const cleanDiffs = opts.cleanDiffs !== false;
  const windowMs = opts.latestRunWindowMs ?? LATEST_RUN_WINDOW_MS;

  const screenshotDirRel = resolveScreenshotDirRel(repoRoot, specRel);
  if (!screenshotDirRel) {
    return {
      specRel,
      screenshotDir: null,
      mode,
      removed: [],
      removedRuns: 0,
      message: "未能解析截图目录",
    };
  }

  const { abs: screenshotDirAbs, rel: screenshotDir } = assertSafeScreenshotDirRel(
    repoRoot,
    screenshotDirRel,
  );

  const removed = [];
  let removedRuns = 0;

  if (mode === "all") {
    if (fs.existsSync(screenshotDirAbs)) {
      fs.rmSync(screenshotDirAbs, { recursive: true, force: true });
      removed.push(screenshotDir);
    }
  } else {
    const entries = listRunTimestampEntries(screenshotDirAbs);
    const targets = pickLatestRunEntries(entries, windowMs);
    for (const t of targets) {
      fs.rmSync(t.path, { recursive: true, force: true });
      removed.push(toRepoRel(repoRoot, t.path));
      removedRuns++;
    }
  }

  const diffsRel = resolveDiffsDirRel(screenshotDir);
  const diffsAbs = path.join(repoRoot, diffsRel);
  if (cleanDiffs && removed.length > 0 && fs.existsSync(diffsAbs)) {
    fs.rmSync(diffsAbs, { recursive: true, force: true });
    removed.push(diffsRel);
  }

  return {
    specRel,
    screenshotDir,
    mode,
    removed,
    removedRuns,
    message:
      removed.length === 0
        ? mode === "latest"
          ? "未找到可清理的 run 目录"
          : "截图目录不存在或已为空"
        : undefined,
  };
}

export {
  RUN_SEGMENT_RE, LATEST_RUN_WINDOW_MS, resolveScreenshotDirRel, assertSafeScreenshotDirRel, resolveDiffsDirRel, listRunTimestampEntries, pickLatestRunEntries, cleanSpecScreenshots,
};
