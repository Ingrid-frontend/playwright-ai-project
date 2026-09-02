/**
 * 同步远程前端仓库到本地缓存（SSH 或 HTTPS），供 build-ui-contract 索引。
 *
 * 用法：
 *   npx tsx scripts/index-frontend/sync-frontend-repo.ts --url=git@host:org/repo.git
 * 环境变量：
 *   FRONTEND_REPO_SSH_URL / FRONTEND_REPO_URL / FRONTEND_REPO_BRANCH
 *   FRONTEND_REPO_TOKEN（仅 HTTPS 私有仓库需要）
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env") });

/** Playwright 环境 → 前端仓库分支 */
const ENV_BRANCH_MAP: Record<string, string> = {
  dev: "hly-deploy",
  uat: "hly-dev",
  stage9084: "hly-release",
  stage: "hly-release",
};

export function resolveFrontendRepoBranch(playwrightEnv?: string): string {
  const override = String(process.env.FRONTEND_REPO_BRANCH || "").trim();
  if (override) return override;
  const envId = String(playwrightEnv || process.env.PLAYWRIGHT_ENV || "").trim();
  return ENV_BRANCH_MAP[envId] || "main";
}

export type SyncResult = {
  ok: boolean;
  localPath: string;
  action: "clone" | "pull" | "skip";
  branch: string;
  error?: string;
};

function getArg(name: string, fallback = ""): string {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function resolvePlaywrightRoot(): string {
  const fromEnv = process.env.PLAYWRIGHT_REPO_ROOT?.trim();
  if (fromEnv && fs.existsSync(path.join(fromEnv, "playwright.config.ts"))) {
    return path.resolve(fromEnv);
  }
  let dir = path.resolve(process.cwd());
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "playwright.config.ts"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd());
}

/** scp 风格：gogsio@host:org/repo.git 或 git@host:org/repo.git */
const SSH_SCP_URL_RE = /^[^@\s/]+@[^@\s]+:[^\s]+$/;

export function isSshRepoUrl(url: string): boolean {
  const s = String(url || "").trim();
  return s.startsWith("ssh://") || SSH_SCP_URL_RE.test(s);
}

export function isHttpsRepoUrl(url: string): boolean {
  return String(url || "").trim().startsWith("https://");
}

export function isRemoteRepoUrl(url: string): boolean {
  return isSshRepoUrl(url) || isHttpsRepoUrl(url);
}

export function redactRepoUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username) u.username = "***";
    return u.toString();
  } catch {
    return String(url || "").replace(/:[^/@]+@/, ":***@");
  }
}

export function withAuthToken(httpsUrl: string, token: string): string {
  const u = new URL(httpsUrl);
  if (u.protocol !== "https:") {
    throw new Error(`仅 HTTPS 支持 token 认证: ${redactRepoUrl(httpsUrl)}`);
  }
  u.username = u.hostname.includes("github.com") ? "x-access-token" : "oauth2";
  u.password = token;
  return u.toString();
}

function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): { ok: boolean; out: string } {
  const gitEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    GIT_TERMINAL_PROMPT: "0",
  };
  const sshCmd = String(process.env.FRONTEND_REPO_SSH_COMMAND || "").trim();
  if (sshCmd) gitEnv.GIT_SSH_COMMAND = sshCmd;

  const proc = spawnSync("git", args, {
    cwd,
    env: gitEnv,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const out = `${proc.stdout || ""}${proc.stderr || ""}`.trim();
  return { ok: proc.status === 0, out };
}

function isGitRepo(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git"));
}

function hasPackageJson(dir: string): boolean {
  return fs.existsSync(path.join(dir, "package.json"));
}

function resolveAuthUrl(url: string, token: string): string {
  if (isSshRepoUrl(url)) return url;
  if (isHttpsRepoUrl(url) && token) return withAuthToken(url, token);
  return url;
}

function cloneRepo(remoteUrl: string, cacheDir: string, branch: string): { ok: boolean; out: string } {
  const clone = runGit(process.cwd(), ["clone", "--depth", "1", "-b", branch, remoteUrl, cacheDir]);
  if (clone.ok) return clone;
  return runGit(process.cwd(), ["clone", "--depth", "1", remoteUrl, cacheDir]);
}

function pullRepo(cacheDir: string, remoteUrl: string, branch: string): { ok: boolean; out: string } {
  runGit(cacheDir, ["remote", "set-url", "origin", remoteUrl]);
  const fetch = runGit(cacheDir, [
    "fetch",
    "origin",
    `refs/heads/${branch}:refs/remotes/origin/${branch}`,
    "--depth",
    "1",
    "--force",
  ]);
  if (!fetch.ok) return fetch;
  const checkout = runGit(cacheDir, ["checkout", "-B", branch, `origin/${branch}`]);
  if (!checkout.ok) return checkout;
  return runGit(cacheDir, ["reset", "--hard", `origin/${branch}`]);
}

export function syncFrontendRepo(opts: {
  url: string;
  cacheDir: string;
  branch?: string;
  token?: string;
}): SyncResult {
  const url = String(opts.url || "").trim();
  const cacheDir = path.resolve(opts.cacheDir);
  const branch = String(opts.branch || resolveFrontendRepoBranch()).trim() || "main";
  const token = String(opts.token || process.env.FRONTEND_REPO_TOKEN || "").trim();

  if (!url) {
    return { ok: false, localPath: cacheDir, action: "skip", branch, error: "未配置远程仓库地址" };
  }
  if (!isRemoteRepoUrl(url)) {
    return {
      ok: false,
      localPath: cacheDir,
      action: "skip",
      branch,
      error: `不支持的远程地址（需 git@ 或 https://）: ${url}`,
    };
  }
  if (isHttpsRepoUrl(url) && !token) {
    // 公开 HTTPS 仓库仍可匿名拉取
  }

  const remoteUrl = resolveAuthUrl(url, token);
  fs.mkdirSync(path.dirname(cacheDir), { recursive: true });

  if (!isGitRepo(cacheDir)) {
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
    const cloned = cloneRepo(remoteUrl, cacheDir, branch);
    if (!cloned.ok) {
      return {
        ok: false,
        localPath: cacheDir,
        action: "clone",
        branch,
        error: redactSecrets(cloned.out || "git clone 失败"),
      };
    }
    if (!hasPackageJson(cacheDir)) {
      return { ok: false, localPath: cacheDir, action: "clone", branch, error: "克隆完成但缺少 package.json" };
    }
    return { ok: true, localPath: cacheDir, action: "clone", branch };
  }

  const pulled = pullRepo(cacheDir, remoteUrl, branch);
  if (!pulled.ok) {
    return {
      ok: false,
      localPath: cacheDir,
      action: "pull",
      branch,
      error: redactSecrets(pulled.out || "git pull 失败"),
    };
  }
  if (!hasPackageJson(cacheDir)) {
    return { ok: false, localPath: cacheDir, action: "pull", branch, error: "同步完成但缺少 package.json" };
  }
  return { ok: true, localPath: cacheDir, action: "pull", branch };
}

function redactSecrets(text: string): string {
  return text.replace(/x-access-token:[^@\s]+/gi, "x-access-token:***").replace(/oauth2:[^@\s]+/gi, "oauth2:***");
}

function resolveRepoUrlFromEnv(): string {
  return (
    String(process.env.FRONTEND_REPO_SSH_URL || "").trim() ||
    String(process.env.FRONTEND_REPO_URL || "").trim()
  );
}

function main(): void {
  const pwRoot = resolvePlaywrightRoot();
  const url = getArg("url", resolveRepoUrlFromEnv());
  const cacheDir = getArg("cache", path.join(pwRoot, ".cache/frontend-repo"));
  const branch = getArg("branch", resolveFrontendRepoBranch(getArg("env")));
  const result = syncFrontendRepo({ url, cacheDir, branch });
  if (!result.ok) {
    console.error(result.error || "同步失败");
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      ok: true,
      localPath: result.localPath,
      action: result.action,
      branch: result.branch,
      url: redactRepoUrl(url),
      transport: isSshRepoUrl(url) ? "ssh" : "https",
    }),
  );
}

const isDirectRun = process.argv[1]?.replace(/\\/g, "/").includes("sync-frontend-repo");
if (isDirectRun) main();
