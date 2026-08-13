/**
 * 验证：回填 meta + 按 accountProfile 分组批量执行
 *
 *   node scripts/verify/verify-batch-profile.cjs
 *   node scripts/verify/verify-batch-profile.cjs --env=stage
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const specMeta = require("../../src/utils/spec-meta.cjs");
const { parseEnvFromSpecRel } = require("../../src/utils/test-env-path.cjs");

const repoRoot = process.cwd();
const envFilter = (process.argv.find((a) => a.startsWith("--env=")) || "").split("=")[1] || "stage";

function walkOptimized(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkOptimized(full, out);
    else if (ent.name.endsWith(".optimized.spec.ts") && !/(?:studio-auto(?:_[^/]*)?|studio-unsaved-draft)/.test(ent.name)) {
      out.push(path.relative(repoRoot, full).replace(/\\/g, "/"));
    }
  }
}

function listSpecsForEnv(env) {
  const all = [];
  walkOptimized(path.join(repoRoot, "tests/optimized"), all);
  return all.filter((rel) => parseEnvFromSpecRel(rel, repoRoot) === env);
}

function runSpec(specRel, env, profile) {
  const envVars = {
    ...process.env,
    PLAYWRIGHT_ENV: env,
    PLAYWRIGHT_ACCOUNT: profile,
  };
  console.log(`\n  → ${specRel}`);
  console.log(`    PLAYWRIGHT_ENV=${env} PLAYWRIGHT_ACCOUNT=${profile}`);
  const cli = path.join(repoRoot, "node_modules/@playwright/test/cli.js");
  const r = spawnSync(process.execPath, [cli, "test", specRel, "--project=optimized", "--reporter=line"], {
    cwd: repoRoot,
    env: envVars,
    encoding: "utf8",
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.status ?? 1;
}

console.log(`\n=== 1. 回填 meta 检查 (env=${envFilter}) ===`);
const specs = listSpecsForEnv(envFilter);
if (!specs.length) {
  console.log("未找到该环境下的 optimized 用例，跳过执行验证");
  process.exit(0);
}

const entries = specs.map((rel) => specMeta.enrichOptimizedSpecEntry(repoRoot, rel));
for (const e of entries) {
  const metaRel = specMeta.specMetaPathForRel(e.rel);
  const hasFile = metaRel && fs.existsSync(path.join(repoRoot, metaRel));
  console.log(`  ${e.rel}`);
  console.log(`    profile=${e.accountProfile} hasMeta=${e.hasMeta} sidecar=${hasFile ? "yes" : "no"}`);
}

console.log(`\n=== 2. 按 profile 分组 ===`);
const groups = specMeta.groupEntriesByAccountProfile(entries);
for (const [profile, group] of groups) {
  console.log(`  [${profile}] ${group.length} 个: ${group.map((g) => path.basename(g.rel)).join(", ")}`);
}

console.log(`\n=== 3. 分组批量执行 (env=${envFilter}) ===`);
const results = [];
for (const [profile, group] of groups) {
  console.log(`\n[batch] 账号组 ${profile}（${group.length} 个用例）`);
  for (const entry of group) {
    const code = runSpec(entry.rel, envFilter, profile);
    results.push({ spec: entry.rel, profile, exitCode: code });
  }
}

console.log("\n=== 4. 结果汇总 ===");
let failed = 0;
for (const r of results) {
  const ok = r.exitCode === 0;
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} [${r.profile}] ${r.spec} (exit ${r.exitCode})`);
}

if (process.argv.includes("--multi-profile-demo")) {
  console.log("\n=== 5. 多 profile 分组演示（内存模拟，不写文件） ===");
  const demoEntries = [
    ...entries,
    {
      ...entries[0],
      rel: entries[0].rel + " (sim-admin)",
      accountProfile: "admin",
    },
  ];
  for (const [profile, group] of specMeta.groupEntriesByAccountProfile(demoEntries)) {
    console.log(`  [${profile}] ${group.length} 个用例`);
  }
  console.log("  → Studio 批量执行会按上述分组依次 login + 执行");
}

process.exit(failed ? 1 : 0);
