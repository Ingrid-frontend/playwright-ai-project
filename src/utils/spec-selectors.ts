/**
 * 从 optimized spec 中提取每个步骤使用的定位链，
 * 转成可在浏览器端复算的描述（供 ego lite 体检使用）。
 *
 * 只覆盖 pipeline 实际产出的几种形态：
 *   baseContext.getByText('X').filter({ visible: true }).first()
 *   baseContext.getByRole('cell', { name: '1', exact: true })...
 *   page.locator('.foo > .bar')...
 *   ...getByLabel('', { exact: true }) 等链式收窄
 */
import fs from 'fs';

export type SelectorPart =
  | { kind: 'css'; value: string }
  | { kind: 'text'; value: string; exact: boolean }
  | { kind: 'role'; role: string; name?: string; exact: boolean }
  | { kind: 'label'; value: string; exact: boolean }
  | { kind: 'placeholder'; value: string; exact: boolean }
  | { kind: 'testid'; value: string };

export type SpecStepSelector = {
  /** 步骤序号（从 1 开始，按 spec 中出现顺序） */
  index: number;
  /** step('...') 的名称 */
  stepName: string;
  /** spec 中 locator 声明所在行号 */
  line: number;
  /** 原始定位表达式 */
  raw: string;
  /** 是否在 iframe（frameLocator）内 */
  inFrame: boolean;
  /** 解析后的链式片段 */
  parts: SelectorPart[];
  /** 该步骤是否为可跳过步骤（spec 里用 try/catch 包住可见性断言） */
  optional: boolean;
};

export type SpecSelectorScan = {
  file: string;
  /** spec 里 page.goto 的目标（相对 baseURL） */
  gotoTargets: string[];
  steps: SpecStepSelector[];
  /** 解析失败、需要人工确认的定位表达式 */
  unparsed: { line: number; raw: string; stepName: string }[];
};

const STEP_RE = /await\s+step\(\s*(['"`])([\s\S]*?)\1/;
const LOCATOR_DECL_RE = /const\s+locator\s*=\s*(.+?);\s*$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^['"`]/.test(trimmed) && trimmed.endsWith(trimmed[0])) {
    return trimmed.slice(1, -1).replace(/\\(['"`\\])/g, '$1');
  }
  return trimmed;
}

/** 提取一个调用的参数串（处理嵌套括号与引号） */
function readArgs(source: string, openIndex: number): { args: string; end: number } | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { args: source.slice(openIndex + 1, i), end: i };
    }
  }
  return null;
}

/** 拆分顶层逗号（引号/括号内的逗号不算） */
function splitTopLevel(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += args[i + 1] ?? '';
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    if (ch === ')' || ch === '}' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out.map((s) => s.trim());
}

function readOption(optionsArg: string | undefined, key: string): string | undefined {
  if (!optionsArg) return undefined;
  const re = new RegExp(`${key}\\s*:\\s*(['"\`][^'"\`]*['"\`]|true|false)`);
  const m = optionsArg.match(re);
  return m ? m[1] : undefined;
}

/** 把一条定位表达式解析成链式片段；返回 null 表示形态不支持 */
export function parseLocatorExpression(expr: string): SelectorPart[] | null {
  const parts: SelectorPart[] = [];
  let cursor = 0;
  let matchedAny = false;

  while (cursor < expr.length) {
    const rest = expr.slice(cursor);
    const call = rest.match(/^\.?\s*(getByText|getByRole|getByLabel|getByPlaceholder|getByTestId|locator)\s*\(/);
    if (!call) {
      const skip = rest.match(/^\.?\s*[A-Za-z]+\s*\(/);
      if (!skip) {
        const dot = rest.indexOf('.');
        if (dot === -1) break;
        cursor += dot + 1;
        continue;
      }
      // 跳过 filter/first/nth 之类的收窄调用（体检时按“全部匹配数”统计）
      const argRange = readArgs(expr, cursor + skip[0].length - 1);
      if (!argRange) break;
      cursor = argRange.end + 1;
      continue;
    }

    const openIndex = cursor + call[0].length - 1;
    const argRange = readArgs(expr, openIndex);
    if (!argRange) return null;
    const args = splitTopLevel(argRange.args);
    const primary = args[0] ? unquote(args[0]) : '';
    const options = args[1];
    const exact = readOption(options, 'exact') === 'true';

    switch (call[1]) {
      case 'locator':
        if (!primary) return null;
        parts.push({ kind: 'css', value: primary });
        break;
      case 'getByText':
        parts.push({ kind: 'text', value: primary, exact });
        break;
      case 'getByRole': {
        const nameRaw = readOption(options, 'name');
        parts.push({
          kind: 'role',
          role: primary,
          name: nameRaw ? unquote(nameRaw) : undefined,
          exact,
        });
        break;
      }
      case 'getByLabel':
        parts.push({ kind: 'label', value: primary, exact });
        break;
      case 'getByPlaceholder':
        parts.push({ kind: 'placeholder', value: primary, exact });
        break;
      case 'getByTestId':
        parts.push({ kind: 'testid', value: primary });
        break;
    }
    matchedAny = true;
    cursor = argRange.end + 1;
  }

  if (!matchedAny || parts.length === 0) return null;
  return parts;
}

export function scanSpecSelectors(specPath: string): SpecSelectorScan {
  const source = fs.readFileSync(specPath, 'utf8');
  const lines = source.split('\n');
  const steps: SpecStepSelector[] = [];
  const unparsed: SpecSelectorScan['unparsed'] = [];
  const gotoTargets: string[] = [];

  let currentStep = '(unknown)';
  let index = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const gotoMatch = line.match(/page\.goto\(\s*(['"`])([^'"`]*)\1/);
    if (gotoMatch) gotoTargets.push(gotoMatch[2]);

    const stepMatch = line.match(STEP_RE);
    if (stepMatch) {
      currentStep = stepMatch[2];
      continue;
    }

    const declMatch = line.match(LOCATOR_DECL_RE);
    if (declMatch) {
      const raw = declMatch[1].trim();
      const parts = parseLocatorExpression(raw);
      if (!parts) {
        unparsed.push({ line: i + 1, raw, stepName: currentStep });
        continue;
      }

      const lookahead = lines.slice(i + 1, i + 4).join('\n');
      const optional = /try\s*\{/.test(lookahead);

      index += 1;
      steps.push({
        index,
        stepName: currentStep,
        line: i + 1,
        raw,
        inFrame: /baseContext|frameLocator/.test(raw) || /frameLocator/.test(lines.slice(Math.max(0, i - 5), i).join('\n')),
        parts,
        optional,
      });
      continue;
    }

    const awaitMatch = line.match(
      /await\s+((?:page|frame|[\w$]+)\.(?:getByText|getByRole|getByLabel|getByPlaceholder|getByTestId|locator)\([^;]+)/,
    );
    if (!awaitMatch) continue;

    let raw = awaitMatch[1].trim().replace(/[,;]\s*$/, '');
    raw = raw.replace(
      /\.(?:click|fill|check|uncheck|selectOption|press|hover|focus|blur|type|setInputFiles|waitFor|toBeVisible|toHaveText|toContainText|count|isVisible)\s*\([\s\S]*$/,
      '',
    );
    const exprForParse = raw.replace(/^(?:page|frame|[\w$]+)/, '');
    const parsed = parseLocatorExpression(exprForParse.startsWith('.') ? exprForParse : `.${exprForParse}`);
    if (!parsed) {
      unparsed.push({
        line: i + 1,
        raw,
        stepName: currentStep === '(unknown)' ? `line-${i + 1}` : currentStep,
      });
      continue;
    }

    index += 1;
    steps.push({
      index,
      stepName: currentStep === '(unknown)' ? `action-${index}` : currentStep,
      line: i + 1,
      raw,
      inFrame: /\bframe\b|frameLocator/.test(raw),
      parts: parsed,
      optional: false,
    });
  }

  return { file: specPath, gotoTargets, steps, unparsed };
}
