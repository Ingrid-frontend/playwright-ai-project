/**
 * Studio 录完保存后：校验 spec-meta + 可选批量执行
 *
 *   node scripts/verify/verify-spec-meta-flow.cjs
 *   node scripts/verify/verify-spec-meta-flow.cjs --run
 *   node scripts/verify/verify-spec-meta-flow.cjs --env=stage --run
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const specMeta = require("../../src/utils/spec-meta.cjs");
const { parseEnvFromSpecRel } = require("../../src/utils/test-env-path.cjs");

const repoRoot = process.cwd();
const shouldRun = process.argv.includes("--run");
const envFilter = (process.argv.find((a) => a.startsWith("--env=")) || "").split("=")[1] || null;

function walkOptimized(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkOptimized(full, out);
    else if (ent.name.endsWith(".optimized.spec.ts") && !/studio-unsaved-draft/.test(ent.name)) {
      out.push(path.relative(repoRoot, full).replace(/\\/g, "/"));
    }
  }
}

function readHeaderMeta(abs) {
  if (!fs.existsSync(abs)) return null;
  return specMeta.parseSpecMetaBlockFromCode(fs.readFileSync(abs, "utf8"));
}

function checkOne(rel) {
  const issues = [];
  const abs = path.join(repoRoot, rel);
  const sidecarRel = specMeta.specMetaPathForRel(rel);
  const sidecarAbs = sidecarRel ? path.join(repoRoot, sidecarRel) : null;
  const enriched = specMeta.enrichOptimizedSpecEntry(repoRoot, rel);
  const fileMeta = sidecarAbs && fs.existsSync(sidecarAbs) ? JSON.parse(fs.readFileSync(sidecarAbs, "utf8")) : null;
  const headerMeta = readHeaderMeta(abs);

  if (!sidecarAbs || !fs.existsSync(sidecarAbs)) {
    issues.push("缺少 sidecar *.optimized.spec-meta.json");
  }
  if (!headerMeta) {
    issues.push("缺少文件头 @spec-meta");
  }
  if (fileMeta && headerMeta) {
    if (fileMeta.accountProfile !== headerMeta.accountProfile) {
      issues.push(`sidecar/header accountProfile 不一致: ${fileMeta.accountProfile} vs ${headerMeta.accountProfile}`);
    }
    if (fileMeta.playwrightEnv !== headerMeta.playwrightEnv) {
      issues.push(`sidecar/header playwrightEnv 不一致: ${fileMeta.playwrightEnv} vs ${headerMeta.playwrightEnv}`);
    }
  }
  if (!enriched.hasMeta) {
    issues.push("hasMeta=false（accountProfile 可能为 unknown）");
  }
  if (enriched.accountProfile === specMeta.UNKNOWN_PROFILE) {
    issues.push("accountProfile=unknown");
  }
  if (fileMeta?.recordSource === "backfill") {
    issues.push("recordSource 仍为 backfill，可能未走 Studio 保存");
  }

  const rawRel = fileMeta?.rawOriginalRel;
  let rawOk = null;
  if (rawRel) {
    const rawSidecar = specMeta.specMetaPathForRel(rawRel);
    rawOk = rawSidecar && fs.existsSync(path.join(repoRoot, rawSidecar));
    if (!rawOk) issues.push(`raw sidecar 缺失: ${rawSidecar}`);
  }

  return { rel, enriched, fileMeta, headerMeta, rawOriginalRel: rawRel, rawMetaOk: rawOk, issues };
}

function runBatchForEnv(env) {
  const script = path.join(repoRoot, "scripts/verify/verify-batch-profile.cjs");
  console.log(`\n>>> 批量执行验证 env=${env}`);
  const r = spawnSync(process.execPath, [script, `--env=${env}`], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  return r.status ?? 1;
}

const rels = [];
walkOptimized(path.join(repoRoot, "tests/optimized"), rels);
const filtered = envFilter
  ? rels.filter((rel) => parseEnvFromSpecRel(rel, repoRoot) === envFilter)
  : rels;

console.log("\n=== spec-meta 校验 ===\n");
if (!filtered.length) {
  console.log("未找到正式 optimized 用例（已排除 studio-unsaved-draft）");
  console.log("请先在 Studio 完成：录制 → pipeline → 保存到项目");
  process.exit(2);
}

let failedMeta = 0;
const byEnv = new Map();
for (const rel of filtered.sort()) {
  const r = checkOne(rel);
  const env = parseEnvFromSpecRel(rel, repoRoot) || r.enriched.playwrightEnv || "?";
  if (!byEnv.has(env)) byEnv.set(env, []);
  byEnv.get(env).push(r);

  const ok = !r.issues.length;
  if (!ok) failedMeta++;
  console.log(`${ok ? "✓" : "✗"} ${rel}`);
  console.log(
    `    env=${r.enriched.playwrightEnv} profile=${r.enriched.accountProfile} login=${r.enriched.loginAccount || "—"} source=${r.fileMeta?.recordSource || "—"}`,
  );
  if (r.rawOriginalRel) console.log(`    raw=${r.rawOriginalRel} rawMeta=${r.rawMetaOk ? "yes" : "no"}`);
  if (r.issues.length) r.issues.forEach((i) => console.log(`    ⚠ ${i}`));
}

const allEntries = filtered.map((rel) => specMeta.enrichOptimizedSpecEntry(repoRoot, rel));
console.log("\n=== profile 分组 ===");
for (const [p, g] of specMeta.groupEntriesByAccountProfile(allEntries)) {
  console.log(`  [${p}] ${g.length} 个: ${g.map((x) => path.basename(x.rel)).join(", ")}`);
}
console.log("  counts:", specMeta.summarizeProfileCounts(allEntries));

if (failedMeta) {
  console.log(`\n❌ meta 校验失败 ${failedMeta}/${filtered.length}`);
  process.exit(1);
}
console.log(`\n✅ meta 校验通过 (${filtered.length} 个用例)`);

if (!shouldRun) {
  console.log("\n提示: 加 --run 将按 env 调用 verify-batch-profile 执行用例");
  process.exit(0);
}

let runFailed = 0;
for (const env of [...byEnv.keys()].sort()) {
  if (runBatchForEnv(env) !== 0) runFailed++;
}
process.exit(runFailed ? 1 : 0);
