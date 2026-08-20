#!/usr/bin/env tsx
/**
 * 用例挖掘骨架：从失败包 / 自愈记录归纳「建议补断言」草稿。
 * 不调用 LLM；不自动入库。
 */
import fs from 'fs';
import path from 'path';

type MineItem = {
  source: string;
  planName?: string;
  stepId?: string;
  actionType?: string;
  error?: string;
  suggestion: string;
};

function getArgValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const prefix = `--${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === `--${name}` && i + 1 < args.length) return args[i + 1];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).some((arg) => arg === `--${name}`);
}

function walkFailureBundles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        stack.push(full);
      } else if (ent.name === 'failure-bundle.json') {
        out.push(full);
      }
    }
  }
  return out;
}

function mineFromBundle(file: string): MineItem[] {
  try {
    const bundle = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      planName?: string;
      failedStep?: { id?: string; error?: string; actionType?: string };
      steps?: Array<{ id: string; passed: boolean; error?: string; actionType?: string }>;
      healLogs?: Array<{ stepId: string; accepted?: boolean }>;
    };
    const items: MineItem[] = [];
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');

    if (bundle.failedStep?.actionType === 'assert') {
      items.push({
        source: rel,
        planName: bundle.planName,
        stepId: bundle.failedStep.id,
        actionType: 'assert',
        error: bundle.failedStep.error,
        suggestion: '核对 assert.expect 是否仍为人定可见原文；勿用实际值覆盖期望',
      });
    }

    for (const step of bundle.steps || []) {
      if (step.passed || step.actionType !== 'assert') continue;
      items.push({
        source: rel,
        planName: bundle.planName,
        stepId: step.id,
        actionType: 'assert',
        error: step.error,
        suggestion: `补强或修正断言步骤 ${step.id}（人定 expect）`,
      });
    }

    const healAccepted = (bundle.healLogs || []).filter((h) => h.accepted).length;
    if (healAccepted >= 2) {
      items.push({
        source: rel,
        planName: bundle.planName,
        suggestion: `本跑自愈采纳 ${healAccepted} 次：考虑加 data-testid / 收紧语义描述，并跑 heal:suggest`,
      });
    }

    return items;
  } catch {
    return [];
  }
}

function formatMd(items: MineItem[]): string {
  const lines = [
    '## 用例挖掘建议（骨架）',
    '',
    '来源：failure-bundle 扫描。**不会自动写入 definitions**。',
    '边界见 docs/ai-test-boundaries.md。',
    '',
  ];
  if (!items.length) {
    lines.push('_暂无建议_');
    return lines.join('\n');
  }
  for (const item of items.slice(0, 80)) {
    lines.push(`### ${item.planName || item.source}`);
    lines.push(`- 来源: \`${item.source}\``);
    if (item.stepId) lines.push(`- 步骤: ${item.stepId}${item.actionType ? ` (${item.actionType})` : ''}`);
    if (item.error) lines.push(`- 错误: ${item.error.split('\n')[0].slice(0, 120)}`);
    lines.push(`- 建议: ${item.suggestion}`);
    lines.push('');
  }
  return lines.join('\n');
}

function main(): void {
  if (hasFlag('help') || hasFlag('h')) {
    console.log(`用法: npm run mine:cases [-- --root=results/intent-runs]

扫描失败包，输出 results/mined-cases/suggestions.md
`);
    return;
  }

  const root = path.resolve(getArgValue('root') || 'results/intent-runs');
  const files = walkFailureBundles(root);
  const items = files.flatMap(mineFromBundle);
  const md = formatMd(items);
  const outDir = path.join('results', 'mined-cases');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'suggestions.md');
  fs.writeFileSync(outFile, `${md}\n`, 'utf-8');
  fs.writeFileSync(path.join(outDir, 'suggestions.json'), `${JSON.stringify({ items }, null, 2)}\n`, 'utf-8');
  console.log(md);
  console.log(`\n📁 ${outFile}（${items.length} 条，扫描 ${files.length} 个失败包）`);
}

main();
