#!/usr/bin/env tsx
// 独立离线验证：只注入 fake fetch，不启动浏览器、不读取 .env、不接入 smoke。
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import {
  AiBudgetExceededError,
  completeJson,
  completeText,
  createAiBudget,
  rethrowAiControlError,
} from '../../src/ai/llm-client.js';

const envKeys = ['AI_TEST_PROVIDER', 'AI_TEST_OPENAI_API_KEY', 'AI_TEST_OPENAI_BASE_URL', 'AI_TEST_TIMEOUT_MS', 'AI_TEST_RETRIES'] as const;
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const signals: AbortSignal[] = [];
let checks = 0;

function fakeFetch(handler: (attempt: number, signal: AbortSignal) => Response | Promise<Response>) {
  let calls = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    assert.ok(init?.signal, 'every HTTP attempt must have a signal');
    const signal = init.signal;
    signals.push(signal);
    calls++;
    return handler(calls, signal);
  };
  return { fetchImpl, get calls() { return calls; } };
}

function ok(content = '{"ok":true}'): Response {
  return Response.json({ choices: [{ message: { content } }] });
}

function hangingBody(status = 200): Response {
  return new Response(new ReadableStream<Uint8Array>(), { status });
}

function budgetError(kind: 'deadline' | 'maxCalls') {
  return (error: unknown) => error instanceof AiBudgetExceededError && error.kind === kind;
}

async function verify(name: string, work: () => Promise<void>): Promise<void> {
  process.env.AI_TEST_TIMEOUT_MS = '1000';
  process.env.AI_TEST_RETRIES = '2';
  const startedAt = Date.now();
  const activeTimers = () => process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout').length;
  const timersBefore = activeTimers();
  await work();
  for (const signal of signals.splice(0)) {
    assert.equal(getEventListeners(signal, 'abort').length, 0, 'attempt listeners must be removed');
  }
  assert.equal(activeTimers(), timersBefore, 'request/deadline/backoff timers must be removed');
  checks++;
  console.log(`PASS ${name} (${Date.now() - startedAt}ms)`);
}

async function main(): Promise<void> {
  process.env.AI_TEST_PROVIDER = 'openai';
  process.env.AI_TEST_OPENAI_API_KEY = 'offline-only';
  process.env.AI_TEST_OPENAI_BASE_URL = 'https://offline.invalid';
  globalThis.fetch = async () => { throw new Error('Network forbidden: missing fake fetch injection'); };

  await verify('fast headers / stalled success and error bodies remain timed', async () => {
    process.env.AI_TEST_TIMEOUT_MS = '30';
    process.env.AI_TEST_RETRIES = '0';
    for (const status of [200, 429, 503, 400]) {
      const fake = fakeFetch(() => hangingBody(status));
      const startedAt = Date.now();
      await assert.rejects(completeText('body', fake), { name: 'TimeoutError' });
      assert.equal(fake.calls, 1);
      assert.ok(Date.now() - startedAt < 1000, 'body timeout must not wait 120s');
      assert.equal(signals.at(-1)?.aborted, true);
    }
  });

  await verify('429 backoff abort preserves reason and removes listeners', async () => {
    const controller = new AbortController();
    const reason = new Error('caller cancelled backoff');
    let abortTask: ReturnType<typeof setImmediate> | undefined;
    let disposedBeforeAbort = false;
    const fake = fakeFetch((_attempt, signal) => {
      abortTask = setImmediate(() => {
        disposedBeforeAbort = getEventListeners(signal, 'abort').length === 0 && !signal.aborted;
        controller.abort(reason);
      });
      return new Response('rate limited', { status: 429, headers: { 'retry-after': '30' } });
    });
    try {
      await assert.rejects(completeText('cancel backoff', { ...fake, signal: controller.signal }), (error) => error === reason);
      assert.ok(disposedBeforeAbort, 'cancellation must occur after request scope disposal, during backoff');
      assert.equal(fake.calls, 1);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    } finally {
      clearImmediate(abortTask);
    }
  });

  await verify('external abort escapes fetch, json, safeText and heal guards', async () => {
    for (const phase of ['fetch', 'json', 'text'] as const) {
      const controller = new AbortController();
      const reason = new Error(`cancel ${phase}`);
      let abortTask: ReturnType<typeof setImmediate> | undefined;
      const fake = fakeFetch(() => {
        abortTask = setImmediate(() => controller.abort(reason));
        if (phase === 'fetch') return new Promise<Response>(() => undefined);
        return hangingBody(phase === 'json' ? 200 : 503);
      });
      const budget = createAiBudget({ signal: controller.signal });
      try {
        await assert.rejects(completeJson('cancel', { ...fake, budget }), (error) => {
          assert.throws(() => rethrowAiControlError(error, { budget }), (caught) => caught === reason);
          return error === reason;
        });
        assert.equal(fake.calls, 1);
        assert.equal(budget.callsUsed, 1);
        assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
      } finally {
        clearImmediate(abortTask);
      }
    }
    const controller = new AbortController();
    controller.abort('pre-aborted');
    const fake = fakeFetch(() => ok());
    const budget = createAiBudget();
    await assert.rejects(completeText('cancel', { ...fake, budget, signal: controller.signal }), (error) => error === 'pre-aborted');
    assert.equal(fake.calls, 0);
    assert.equal(budget.callsUsed, 0);
  });

  await verify('4xx and malformed response/model JSON are not retried', async () => {
    for (const status of [400, 401, 403, 404, 408, 422]) {
      const fake = fakeFetch(() => new Response('bad request', { status }));
      await assert.rejects(completeText('4xx', fake), new RegExp(`API ${status}`));
      assert.equal(fake.calls, 1);
    }
    const invalid = fakeFetch(() => new Response('{invalid json'));
    await assert.rejects(completeText('invalid envelope', invalid), SyntaxError);
    assert.equal(invalid.calls, 1);
    const malformed = fakeFetch(() => ok('{invalid model json'));
    await assert.rejects(completeJson('invalid model JSON', malformed), /不是合法 JSON/);
    assert.equal(malformed.calls, 1);
    process.env.AI_TEST_TIMEOUT_MS = '20';
    const stalled4xx = fakeFetch(() => hangingBody(403));
    await assert.rejects(completeText('403 stalled error body', stalled4xx), { name: 'TimeoutError' });
    assert.equal(stalled4xx.calls, 1);
  });

  await verify('default two retries, retry quota and eventual success', async () => {
    delete process.env.AI_TEST_TIMEOUT_MS; // 保留生产默认 120s，不实际等待
    delete process.env.AI_TEST_RETRIES;
    const exhausted = fakeFetch(() => new Response('unavailable', { status: 503, headers: { 'retry-after': '0.001' } }));
    const budget = createAiBudget({ maxCalls: 10 });
    await assert.rejects(completeText('retries', { ...exhausted, budget }), /API 503/);
    assert.equal(exhausted.calls, 3);
    assert.equal(budget.callsUsed, 3);
    const recovering = fakeFetch((attempt) => attempt < 3
      ? new Response('busy', { status: 429, headers: { 'retry-after': '0.001' } }) : ok());
    assert.deepEqual(await completeJson('recover', recovering), { ok: true });
    assert.equal(recovering.calls, 3);
  });

  await verify('network and single-attempt timeout remain retryable', async () => {
    const network = fakeFetch((attempt) => {
      if (attempt === 1) throw new TypeError('fetch failed');
      return ok();
    });
    assert.equal(await completeText('network retry', network), '{"ok":true}');
    assert.equal(network.calls, 2);
    process.env.AI_TEST_TIMEOUT_MS = '25';
    const timeout = fakeFetch((attempt) => attempt === 1
      ? new Response(new ReadableStream<Uint8Array>(), { status: 503, headers: { 'retry-after': '0.001' } })
      : ok());
    assert.equal(await completeText('timeout retry', timeout), '{"ok":true}');
    assert.equal(timeout.calls, 2);
  });

  await verify('deadline prevents initial calls and unaffordable backoff', async () => {
    const untouched = fakeFetch(() => ok());
    await assert.rejects(completeText('expired', { ...untouched, deadline: Date.now() - 1 }), budgetError('deadline'));
    assert.equal(untouched.calls, 0);
    const budget = createAiBudget({ deadline: Date.now() - 1 });
    await assert.rejects(completeText('expired budget', { ...untouched, budget }), budgetError('deadline'));
    assert.equal(budget.callsUsed, 0);
    const limited = fakeFetch(() => new Response('limited', { status: 429, headers: { 'retry-after': '30' } }));
    const startedAt = Date.now();
    await assert.rejects(completeText('no time for backoff', { ...limited, deadline: Date.now() + 5000 }), budgetError('deadline'));
    assert.equal(limited.calls, 1);
    assert.ok(Date.now() - startedAt < 1000, 'reject before waiting');
  });

  await verify('earliest total deadline caps body across request timeout', async () => {
    for (const early of ['option', 'budget'] as const) {
      const fake = fakeFetch(() => hangingBody());
      const budget = createAiBudget({ deadline: Date.now() + (early === 'budget' ? 25 : 5000) });
      await assert.rejects(completeText('deadline body', {
        ...fake, budget, deadline: Date.now() + (early === 'option' ? 25 : 5000),
      }), budgetError('deadline'));
      assert.equal(fake.calls, 1);
      assert.equal(budget.callsUsed, 1);
      assert.equal(signals.at(-1)?.aborted, true);
    }
  });

  await verify('same-round parsing/healing share quota; independent rounds do not', async () => {
    const fake = fakeFetch(() => ok());
    const budget = createAiBudget({ maxCalls: 2 });
    await completeJson('resolve', { ...fake, budget });
    await completeJson('heal', { ...fake, budget });
    await assert.rejects(completeJson('resolve healed action', { ...fake, budget }), budgetError('maxCalls'));
    assert.equal(fake.calls, 2);
    assert.equal(budget.callsUsed, 2);
    const separate = createAiBudget({ maxCalls: 1 });
    await completeJson('independent round', { ...fake, budget: separate });
    assert.equal(separate.callsUsed, 1);
    assert.equal(budget.callsUsed, 2);
    const zero = createAiBudget({ maxCalls: 0 });
    await assert.rejects(completeText('zero quota', { ...fake, budget: zero }), budgetError('maxCalls'));
    assert.equal(fake.calls, 3);
    const failing = fakeFetch(() => new Response('busy', { status: 503, headers: { 'retry-after': '30' } }));
    const one = createAiBudget({ maxCalls: 1 });
    const startedAt = Date.now();
    await assert.rejects(completeText('quota before wait', { ...failing, budget: one }), budgetError('maxCalls'));
    assert.equal(failing.calls, 1);
    assert.ok(Date.now() - startedAt < 1000);
    assert.throws(() => rethrowAiControlError(new AiBudgetExceededError('maxCalls'), { budget }), budgetError('maxCalls'));
  });

  await verify('concurrent consumers cannot overspend a shared quota', async () => {
    const fake = fakeFetch(() => ok());
    const budget = createAiBudget({ maxCalls: 1 });
    const results = await Promise.allSettled([
      completeText('a', { ...fake, budget }), completeText('b', { ...fake, budget }),
    ]);
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(fake.calls, 1);
    assert.equal(budget.callsUsed, 1);
  });

  console.log(`LLM budget: ${checks} offline checks passed`);
}

const watchdog = setTimeout(() => {
  console.error('Offline verification exceeded 15s');
  process.exit(1);
}, 15_000);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (process.exitCode) watchdog.unref(); // 失败且泄漏计时器时仍保留兜底，不阻止正常退出
  else clearTimeout(watchdog);
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
