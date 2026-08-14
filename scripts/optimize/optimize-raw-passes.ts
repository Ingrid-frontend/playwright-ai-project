export interface OptimizeOptions {
  removeIframe: boolean;
  deduplicate: boolean;
  removeNoise: boolean;
  mergeFill: boolean;
  waitLoad: boolean;
  addVisible: boolean;
  addTimeout: boolean;
  simplifyCheck: boolean;
}

export interface OptimizeMetrics {
  removedNoise: number;
  removedDedup: number;
  removedFillMerge: number;
  removedUncheck: number;
  addedAsserts: number;
  totalRemoved: number;
}

export function parseLine(line: string): { indent: string; expr: string } | null {
  const m = line.match(/^(\s*)(await\s+.+);?\s*$/);
  if (!m) return null;
  return { indent: m[1], expr: m[2].trim() };
}

export function extractLocator(expr: string): string {
  const body = expr.replace(/^await\s+/, '');
  const m = body.match(/^(.*?)\.(click|fill|check|uncheck|select|type|press|tap|hover|focus|blur|clear|dblclick|dispatchEvent|waitFor|selectOption)\(.*\)$/);
  if (m) return m[1];
  return body;
}

export function extractAction(expr: string): { name: string; args: string } | null {
  const body = expr.replace(/^await\s+/, '');
  const m = body.match(/\.([a-zA-Z]+)\(([^)]*)\)$/);
  if (m) return { name: m[1], args: m[2] };
  return null;
}

export function isNoiseLine(line: string): boolean {
  const hasTextMatch = line.match(/hasText:\s*['"](.+?)['"]/);
  if (hasTextMatch) {
    if (hasTextMatch[1].length > 15) return true;
  }

  const getByTextMatch = line.match(/getByText\(['"]([^'"]+)['"]\)/);
  if (getByTextMatch) {
    if (getByTextMatch[1].length > 15) return true;
  }

  const nthMatch = line.match(/\.nth\((\d+)\)/);
  if (nthMatch) {
    const n = parseInt(nthMatch[1], 10);
    if (n > 5) return true;
  }

  return false;
}

export function isRedundantClickBeforeFill(lines: string[], idx: number): boolean {
  const curr = lines[idx];
  const next = lines[idx + 1];
  if (!curr || !next) return false;
  const currParsed = parseLine(curr);
  const nextParsed = parseLine(next);
  if (!currParsed || !nextParsed) return false;

  const currAction = extractAction(currParsed.expr);
  const nextAction = extractAction(nextParsed.expr);

  if (!currAction || !nextAction) return false;
  if (currAction.name !== 'click') return false;
  if (nextAction.name !== 'fill') return false;

  const currLoc = extractLocator(currParsed.expr);
  const nextLoc = extractLocator(nextParsed.expr);

  return currLoc === nextLoc;
}

export function isKeyAction(expr: string): boolean {
  return /\.(click|fill|check|uncheck|selectOption)\(/.test(expr);
}

export function optimizeScript(source: string, options: OptimizeOptions): string {
  const lines = source.split('\n');
  const metrics: OptimizeMetrics = {
    removedNoise: 0,
    removedDedup: 0,
    removedFillMerge: 0,
    removedUncheck: 0,
    addedAsserts: 0,
    totalRemoved: 0
  };

  let workingLines = lines.slice();

  if (options.removeNoise) {
    workingLines = workingLines.filter(line => {
      if (isNoiseLine(line) && /\.click\(\)/.test(line)) {
        metrics.removedNoise++;
        return false;
      }
      return true;
    });
  }

  if (options.simplifyCheck) {
    const filteredLines = [];
    for (let i = 0; i < workingLines.length; i++) {
      const curr = workingLines[i];
      const next = workingLines[i + 1];
      if (curr && next) {
        const cParsed = parseLine(curr);
        const nParsed = parseLine(next);
        if (cParsed && nParsed) {
          const cA = extractAction(cParsed.expr);
          const nA = extractAction(nParsed.expr);
          if (cA && nA && cA.name === 'uncheck' && nA.name === 'check') {
            const cL = extractLocator(cParsed.expr);
            const nL = extractLocator(nParsed.expr);
            if (cL === nL) {
              metrics.removedUncheck++;
              i++;
              filteredLines.push(next);
              continue;
            }
          }
        }
      }
      filteredLines.push(curr);
    }
    workingLines = filteredLines;
  }

  if (options.deduplicate) {
    const filteredLines = [];
    for (let i = 0; i < workingLines.length; i++) {
      const curr = workingLines[i].trim();
      const prev = filteredLines.length > 0 ? filteredLines[filteredLines.length - 1].trim() : '';
      if (curr === prev && curr.startsWith('await ')) {
        metrics.removedDedup++;
        continue;
      }
      filteredLines.push(workingLines[i]);
    }
    workingLines = filteredLines;
  }

  if (options.mergeFill) {
    const filteredLines = [];
    for (let i = 0; i < workingLines.length; i++) {
      if (isRedundantClickBeforeFill(workingLines, i)) {
        metrics.removedFillMerge++;
        continue;
      }
      filteredLines.push(workingLines[i]);
    }
    workingLines = filteredLines;
  }

  metrics.totalRemoved = metrics.removedNoise + metrics.removedDedup + metrics.removedFillMerge + metrics.removedUncheck;

  console.log(`🔍 优化统计: 移除 ${metrics.totalRemoved} 个步骤`);
  console.log(`   - 噪声点击: ${metrics.removedNoise}`);
  console.log(`   - 重复操作: ${metrics.removedDedup}`);
  console.log(`   - 合并填充: ${metrics.removedFillMerge}`);
  console.log(`   - 简化勾选: ${metrics.removedUncheck}`);

  return workingLines.join('\n');
}
