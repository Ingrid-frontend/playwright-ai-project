/**
 * ego lite (ego-browser) CLI 封装
 *
 * ego lite 是 Chromium 内核浏览器，Agent 在独立 task space 中操作，
 * 默认继承当前用户的登录态 —— 因此可以在不跑 `npm run login`、
 * 不依赖 storage/loginState/*.json 的情况下直接访问已登录页面。
 *
 * 这里只做一件事：把 JS 片段交给 `ego-browser nodejs`（stdin），
 * 并通过约定前缀把结构化结果取回 Node 侧。
 */
import { spawn } from 'child_process';

/** 结构化结果标记：脚本内用 cliLog(EGO_RESULT_PREFIX + JSON.stringify(x)) 回传 */
export const EGO_RESULT_PREFIX = '__EGO_JSON__';

export type EgoRunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export class EgoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EgoUnavailableError';
  }
}

export class EgoUserControllingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EgoUserControllingError';
  }
}

const INSTALL_HINT = [
  '未能连接 ego lite。请确认：',
  '  1. 已安装并启动 ego lite',
  '  2. `ego-browser` 在 PATH 中（默认 ~/.local/bin/ego-browser）',
  '  3. 当前进程不在沙箱内（沙箱会阻断 ego_cli bootstrap）',
].join('\n');

function detectFailureKind(output: string): 'unavailable' | 'user-controlling' | null {
  if (/command not found|Failed to connect to ego_cli|ENOENT/i.test(output)) return 'unavailable';
  if (/user is controlling|not assigned to an agent/i.test(output)) return 'user-controlling';
  return null;
}

/** 执行一段 ego-browser nodejs 脚本，返回原始 stdout/stderr */
export function runEgoScript(script: string, timeoutMs = 120_000): Promise<EgoRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`ego-browser 执行超时（${Math.round(timeoutMs / 1000)}s）`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      reject(new EgoUnavailableError(`${message}\n${INSTALL_HINT}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });

    child.stdin.end(script);
  });
}

/**
 * 执行脚本并取回第一个 EGO_RESULT_PREFIX 结果。
 * 其它 cliLog 输出原样保留在 logs 中，便于排查。
 */
export async function runEgoJson<T>(
  script: string,
  options: { timeoutMs?: number } = {},
): Promise<{ data: T; logs: string }> {
  const { code, stdout, stderr } = await runEgoScript(script, options.timeoutMs);
  const combined = `${stdout}\n${stderr}`;
  const kind = detectFailureKind(combined);
  if (kind === 'unavailable') {
    throw new EgoUnavailableError(`${INSTALL_HINT}\n\n原始输出:\n${combined.trim()}`);
  }
  if (kind === 'user-controlling') {
    throw new EgoUserControllingError(
      `ego lite task space 当前由用户控制或已失效，请在浏览器中把控制权交还 Agent 后重试。\n\n原始输出:\n${combined.trim()}`,
    );
  }

  // ego CLI 可能把 cliLog 输出写到 stdout 或 stderr，两边都找
  const line = `${stdout}\n${stderr}`.split('\n').find((l) => l.includes(EGO_RESULT_PREFIX));
  if (!line) {
    throw new Error(
      `ego-browser 未返回结构化结果（exit=${code}）。原始输出:\n${combined.trim().slice(0, 2000)}`,
    );
  }

  const json = line.slice(line.indexOf(EGO_RESULT_PREFIX) + EGO_RESULT_PREFIX.length).trim();
  try {
    return { data: JSON.parse(json) as T, logs: combined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`ego-browser 结果解析失败: ${message}\n${json.slice(0, 500)}`);
  }
}
