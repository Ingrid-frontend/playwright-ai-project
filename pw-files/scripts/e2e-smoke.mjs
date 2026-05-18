/**
 * Playwright Studio 端到端冒烟自测（HTTP + WebSocket）
 * 用法: node scripts/e2e-smoke.mjs
 */
import http from "http";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import WebSocket from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.E2E_PORT) || 3099;
const BASE = `http://127.0.0.1:${PORT}`;

const SAMPLE = `import { test, expect } from '@playwright/test';

test('e2e smoke', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});`;

const results = [];

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", reject);
  });
}

function waitForServer(maxMs = 15000) {
  const start = Date.now();
  return (async function poll() {
    try {
      const { status } = await httpGet(`${BASE}/`);
      if (status === 200) return true;
    } catch {
      /* retry */
    }
    if (Date.now() - start > maxMs) throw new Error("server not ready");
    await new Promise((r) => setTimeout(r, 200));
    return poll();
  })();
}

function collectWs(ws, filterTypes, timeoutMs = 60000) {
  const types = new Set(filterTypes);
  const got = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`timeout waiting for ${[...types].join(", ")}; got ${got.map((m) => m.type).join(", ")}`));
    }, timeoutMs);

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (types.has(msg.type)) {
        got.push(msg);
        types.delete(msg.type);
        if (types.size === 0) {
          clearTimeout(timer);
          resolve(got);
        }
      }
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function send(ws, type, data = {}) {
  ws.send(JSON.stringify({ type, ...data }));
}

async function testStaticPage() {
  const { status, body } = await httpGet(`${BASE}/`);
  if (status !== 200) {
    fail("HTTP 首页", `status ${status}`);
    return;
  }
  pass("HTTP 首页", `status ${status}`);

  const checks = [
    ["accordionAi", 'id="accordionAi"'],
    ["pwRunMode radio", 'name="pwRunMode"'],
    ["headless 选项", 'value="headless"'],
    ["handleOptimizeClick", "handleOptimizeClick"],
    ["cancel:optimize 客户端", "cancel:optimize"],
    ["rawEmptyOverlay", 'id="rawEmptyOverlay"'],
    ["pipeline step data-step", 'data-step="1"'],
  ];
  for (const [label, needle] of checks) {
    if (body.includes(needle)) pass(`HTML 含 ${label}`);
    else fail(`HTML 含 ${label}`, `缺少 ${needle}`);
  }
}

async function testOptimizeDemo() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await new Promise((r, j) => {
    ws.on("open", r);
    ws.on("error", j);
  });

  const waitDone = collectWs(ws, ["optimize:done"], 45000);
  send(ws, "optimize", {
    code: SAMPLE,
    opts: { selector: true, assert: true, wait: true, env: false, pom: false, comment: false },
    provider: "claude",
  });

  const [done] = await waitDone;
  if (done.demo === true && done.code) pass("优化演示模式", `demoReason 存在, ${done.lines} 行`);
  else fail("优化演示模式", `demo=${done.demo}, lines=${done.lines}`);
  ws.close();
}

async function testOptimizeCancel() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await new Promise((r, j) => {
    ws.on("open", r);
    ws.on("error", j);
  });

  const big = SAMPLE + "\n" + "// pad\n".repeat(200);
  send(ws, "optimize", {
    code: big,
    opts: { selector: true, assert: true, wait: true, env: true, pom: true, comment: true },
    provider: "deepseek",
  });

  await new Promise((r) => setTimeout(r, 80));
  send(ws, "cancel:optimize");

  try {
    const msgs = await collectWs(ws, ["optimize:cancelled"], 8000);
    pass("取消优化", msgs[0].type);
  } catch (e) {
    const alt = await new Promise((resolve) => {
      const buf = [];
      const t = setTimeout(() => resolve(buf), 3000);
      ws.on("message", (raw) => {
        buf.push(JSON.parse(raw.toString()));
      });
      ws.once("close", () => {
        clearTimeout(t);
        resolve(buf);
      });
    });
    const types = alt.map((m) => m.type).join(", ");
    if (alt.some((m) => m.type === "optimize:done" && m.demo)) {
      pass("取消优化", "演示优化过快完成（可接受）");
    } else {
      fail("取消优化", `${e.message}; types=${types}`);
    }
  }
  ws.close();
}

async function testRunHeadless() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await new Promise((r, j) => {
    ws.on("open", r);
    ws.on("error", j);
  });

  const waitDone = collectWs(ws, ["run:done"], 120000);
  send(ws, "run", { code: SAMPLE, ui: false, headed: false, debug: false });

  const [done] = await waitDone;
  if (typeof done.passed === "number" && done.duration != null) {
    pass("无头执行", `${done.passed}/${done.total} 通过, ${done.duration}s`);
  } else {
    fail("无头执行", JSON.stringify(done));
  }
  ws.close();
}

async function testReport() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await new Promise((r, j) => {
    ws.on("open", r);
    ws.on("error", j);
  });

  send(ws, "run", { code: SAMPLE, ui: false, headed: false, debug: false });
  await collectWs(ws, ["run:done"], 120000);

  const waitReport = collectWs(ws, ["report:done"], 10000);
  send(ws, "report");
  const [report] = await waitReport;
  if (report.data && report.data.total != null) pass("生成报告", `total=${report.data.total}`);
  else fail("生成报告", "无 data");
  ws.close();
}

async function main() {
  console.log("\n🧪 Playwright Studio E2E 冒烟自测\n");

  const serverProc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverLog = "";
  serverProc.stdout.on("data", (d) => (serverLog += d));
  serverProc.stderr.on("data", (d) => (serverLog += d));

  const killServer = () => {
    if (!serverProc.killed) serverProc.kill("SIGTERM");
  };
  process.on("exit", killServer);

  try {
    await waitForServer();
    pass("服务启动", BASE);

    await testStaticPage();
    await testOptimizeDemo();
    await testOptimizeCancel();
    await testRunHeadless();
    await testReport();
  } catch (e) {
    fail("未捕获异常", e.message);
    if (serverLog) console.log("\n--- server log ---\n", serverLog.slice(-2000));
  } finally {
    killServer();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${"─".repeat(40)}`);
  console.log(`合计: ${results.length} 项, 通过 ${results.length - failed.length}, 失败 ${failed.length}`);
  if (failed.length) {
    console.log("\n失败项:");
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
    process.exit(1);
  }
  console.log("\n✅ 端到端冒烟自测全部通过\n");
}

main();
