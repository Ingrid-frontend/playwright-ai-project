function numEnv(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadGenWait() {
  return {
    testTimeoutMs: numEnv('GEN_WAIT_TEST_TIMEOUT_MS', 90_000),
    networkIdleGotoMs: numEnv('GEN_WAIT_NETWORK_IDLE_GOTO_MS', 5_000),
    networkIdleAfterMs: numEnv('GEN_WAIT_NETWORK_IDLE_AFTER_MS', 5_000),
    skipGuardVisibleMs: numEnv('GEN_WAIT_SKIP_GUARD_VISIBLE_MS', 4_000),
    iframeAttachedMs: numEnv('GEN_WAIT_IFRAME_ATTACHED_MS', 12_000),
    expectVisibleIframeMs: numEnv('GEN_WAIT_EXPECT_VISIBLE_IFRAME_MS', 12_000),
    expectVisibleMs: numEnv('GEN_WAIT_EXPECT_VISIBLE_MS', 8_000),
    locatorVisibleIframeMs: numEnv('GEN_WAIT_LOCATOR_VISIBLE_IFRAME_MS', 12_000),
    locatorVisibleMs: numEnv('GEN_WAIT_LOCATOR_VISIBLE_MS', 6_000),
  };
}

let GEN_WAIT = loadGenWait();

export function getGenWait(): typeof GEN_WAIT {
  return GEN_WAIT;
}

export function reloadGenWait(): void {
  GEN_WAIT = loadGenWait();
}

export function getScreenshotMode(): 'after-only' | 'both' {
  const v = (process.env.OPTIMIZE_SCREENSHOT || process.argv.find((a) => a.startsWith('--screenshot='))?.slice('--screenshot='.length) || 'both').toLowerCase();
  return v === 'after-only' ? 'after-only' : 'both';
}
