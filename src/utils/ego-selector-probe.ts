/**
 * 浏览器端选择器复算逻辑（注入 ego lite 页面执行）。
 *
 * 目标不是完整复刻 Playwright 引擎，而是回答体检问题：
 *   这条定位链在真实页面上匹配到 0 个（UI 漂移）、1 个（健康）还是多个（顺序依赖）元素？
 *
 * 因此 role / text 采用近似实现，并在结果里标注 approximate，避免过度自信。
 *
 * 执行方式：源码在「单个 frame」内运行，由 Node 侧通过 CDP 对主 frame 与
 * 各 iframe 分别注入 —— 这样跨域 iframe（contentDocument 取不到）也能覆盖。
 */
import type { SelectorPart } from './spec-selectors.js';

export type ProbeStepInput = {
  index: number;
  stepName: string;
  line: number;
  raw: string;
  inFrame: boolean;
  parts: SelectorPart[];
  optional: boolean;
};

export type ProbeStepResult = {
  index: number;
  stepName: string;
  line: number;
  raw: string;
  optional: boolean;
  total: number;
  visible: number;
  /** 链条在第几个片段上断掉（0 表示未断） */
  brokenAtPart: number;
  brokenPart?: string;
  /** 命中元素摘要，便于人工确认是否点到预期元素 */
  samples: string[];
  verdict: 'ok' | 'missing' | 'ambiguous' | 'invisible';
  /** 命中所在 frame 的 URL（多 frame 复算时用于定位） */
  frameUrl?: string;
};

export type FrameProbeOutput = {
  frameUrl: string;
  /** 该 frame 的可见文本片段，用于登录页等前置条件检测 */
  text: string;
  results: ProbeStepResult[];
};

/**
 * 返回一段自执行 JS 源码，在当前 frame 内对给定步骤逐条复算。
 */
export function buildProbeSource(steps: ProbeStepInput[]): string {
  const payload = JSON.stringify(steps);
  return `(() => {
  const steps = ${payload};

  const IMPLICIT_ROLES = {
    a: 'link', button: 'button', input: 'textbox', select: 'combobox',
    textarea: 'textbox', table: 'table', td: 'cell', th: 'columnheader',
    tr: 'row', ul: 'list', ol: 'list', li: 'listitem', img: 'img',
    form: 'form', nav: 'navigation', h1: 'heading', h2: 'heading',
    h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
  };

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }

  function textOf(el) {
    return (el.textContent || '').replace(/\\s+/g, ' ').trim();
  }

  function roleOf(el) {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit;
    return IMPLICIT_ROLES[el.tagName.toLowerCase()] || '';
  }

  function accName(el) {
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return aria.replace(/\\s+/g, ' ').trim();
    const title = el.getAttribute && el.getAttribute('title');
    if (title) return title.replace(/\\s+/g, ' ').trim();
    return textOf(el);
  }

  function matchStr(actual, expected, exact) {
    if (expected === '') return true;
    if (exact) return actual === expected;
    return actual.toLowerCase().includes(expected.toLowerCase());
  }

  function descendants(scope) {
    const root = scope.querySelectorAll ? scope : scope.ownerDocument;
    return Array.from(root.querySelectorAll('*'));
  }

  /** getByText 语义近似：只保留最内层匹配元素 */
  function byText(scope, value, exact) {
    const hits = descendants(scope).filter((el) => matchStr(textOf(el), value, exact));
    return hits.filter((el) => !hits.some((other) => other !== el && el.contains(other)));
  }

  function applyPart(scopes, part) {
    const out = [];
    for (const scope of scopes) {
      let found = [];
      try {
        if (part.kind === 'css') {
          found = Array.from(scope.querySelectorAll(part.value));
        } else if (part.kind === 'text') {
          found = byText(scope, part.value, part.exact);
        } else if (part.kind === 'role') {
          found = descendants(scope).filter((el) => {
            if (roleOf(el) !== part.role) return false;
            if (part.name == null) return true;
            return matchStr(accName(el), part.name, part.exact);
          });
        } else if (part.kind === 'label') {
          found = descendants(scope).filter((el) => {
            const aria = (el.getAttribute('aria-label') || '').trim();
            if (aria) return matchStr(aria, part.value, part.exact);
            const id = el.getAttribute('id');
            if (id) {
              const doc = el.ownerDocument;
              const label = doc.querySelector('label[for="' + id.replace(/"/g, '\\\\"') + '"]');
              if (label) return matchStr(textOf(label), part.value, part.exact);
            }
            return part.value === '' && el.hasAttribute('aria-label');
          });
        } else if (part.kind === 'placeholder') {
          found = descendants(scope).filter((el) =>
            matchStr((el.getAttribute('placeholder') || '').trim(), part.value, part.exact));
        } else if (part.kind === 'testid') {
          found = Array.from(scope.querySelectorAll('[data-testid="' + part.value.replace(/"/g, '\\\\"') + '"]'));
        }
      } catch (e) {
        found = [];
      }
      for (const el of found) if (!out.includes(el)) out.push(el);
    }
    return out;
  }

  function summarize(el) {
    const tag = el.tagName.toLowerCase();
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : '';
    const label = textOf(el).slice(0, 40) || (el.getAttribute('aria-label') || '');
    return tag + cls + (label ? ' :: "' + label + '"' : '');
  }

  const results = [];
  for (const step of steps) {
    let scopes = [document];
    let brokenAtPart = 0;
    let brokenPart;
    for (let i = 0; i < step.parts.length; i += 1) {
      const next = applyPart(scopes, step.parts[i]);
      if (next.length === 0) {
        brokenAtPart = i + 1;
        brokenPart = JSON.stringify(step.parts[i]);
        scopes = [];
        break;
      }
      scopes = next;
    }

    const visibleHits = scopes.filter(isVisible);
    let verdict = 'ok';
    if (scopes.length === 0) verdict = 'missing';
    else if (visibleHits.length === 0) verdict = 'invisible';
    else if (visibleHits.length > 1) verdict = 'ambiguous';

    results.push({
      index: step.index, stepName: step.stepName, line: step.line, raw: step.raw,
      optional: step.optional, total: scopes.length, visible: visibleHits.length,
      brokenAtPart: brokenAtPart, brokenPart: brokenPart,
      samples: (visibleHits.length ? visibleHits : scopes).slice(0, 3).map(summarize),
      verdict: verdict,
    });
  }

  return {
    frameUrl: location.href,
    text: ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').trim().slice(0, 600),
    results: results,
  };
})()`;
}

/**
 * 合并多个 frame 的复算结果：同一步骤取“最健康”的那个 frame 结论。
 * 这样无需猜 frameLocator 指向哪个 iframe，也能容忍应用把内容搬进/搬出 iframe。
 */
export function mergeFrameResults(
  steps: ProbeStepInput[],
  frames: FrameProbeOutput[],
): ProbeStepResult[] {
  const rank: Record<ProbeStepResult['verdict'], number> = {
    ok: 0,
    ambiguous: 1,
    invisible: 2,
    missing: 3,
  };

  return steps.map((step) => {
    const candidates: ProbeStepResult[] = [];
    for (const frame of frames) {
      const hit = frame.results.find((r) => r.index === step.index);
      if (hit) candidates.push({ ...hit, frameUrl: frame.frameUrl });
    }

    if (candidates.length === 0) {
      return {
        index: step.index,
        stepName: step.stepName,
        line: step.line,
        raw: step.raw,
        optional: step.optional,
        total: 0,
        visible: 0,
        brokenAtPart: 1,
        samples: [],
        verdict: 'missing',
      };
    }

    candidates.sort((a, b) => rank[a.verdict] - rank[b.verdict]);
    return candidates[0];
  });
}
