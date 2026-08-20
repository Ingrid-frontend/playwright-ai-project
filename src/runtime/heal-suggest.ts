import fs from 'fs';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { HealLogEntry } from './failure-bundle.js';

export const HEAL_SUGGEST_VERSION = 1 as const;

export type HealPatchField = 'description' | 'value' | 'locatorHint';

export interface HealSuggestPatch {
  stepId: string;
  engine?: 'pw' | 'ego';
  accepted: boolean;
  fields: Partial<Record<HealPatchField, string>>;
  error?: string;
  note?: string;
}

export interface HealSuggestReport {
  version: typeof HEAL_SUGGEST_VERSION;
  generatedAt: string;
  intentPath?: string;
  patches: HealSuggestPatch[];
  skipped: Array<{ stepId: string; reason: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t || undefined;
}

/** 从单条 heal log 抽出可写回字段；assert / 跳过类不产出补丁 */
export function extractHealPatch(entry: HealLogEntry): {
  patch?: HealSuggestPatch;
  skip?: { stepId: string; reason: string };
} {
  const out = entry.output;
  if (!isRecord(out)) {
    return { skip: { stepId: entry.stepId, reason: '无 output' } };
  }

  if (out.shouldSkip === true) {
    return { skip: { stepId: entry.stepId, reason: '模型建议跳过，不写回 YAML' } };
  }

  const correctedStep = isRecord(out.correctedStep) ? out.correctedStep : undefined;
  const correctedAction = correctedStep && isRecord(correctedStep.action) ? correctedStep.action : undefined;

  if (correctedAction && pickString(correctedAction.type) === 'assert') {
    return { skip: { stepId: entry.stepId, reason: '禁止写回 assert' } };
  }

  const fields: Partial<Record<HealPatchField, string>> = {};

  const desc =
    pickString(out.correctedDescription) ||
    (correctedAction ? pickString(correctedAction.description) : undefined);
  const value =
    pickString(out.correctedValue) ||
    (correctedAction ? pickString(correctedAction.value) : undefined);
  const locatorHint = correctedAction ? pickString(correctedAction.locatorHint) : undefined;

  if (desc) fields.description = desc;
  if (value) fields.value = value;
  if (locatorHint) fields.locatorHint = locatorHint;

  if (Object.keys(fields).length === 0) {
    return { skip: { stepId: entry.stepId, reason: '无可写回字段' } };
  }

  return {
    patch: {
      stepId: entry.stepId,
      engine: entry.engine,
      accepted: entry.accepted === true,
      fields,
      error: entry.error,
      note: entry.accepted ? '运行时已采纳' : '未采纳，仅供参考',
    },
  };
}

export function buildHealSuggestReport(
  healLogs: HealLogEntry[],
  opts: { intentPath?: string } = {},
): HealSuggestReport {
  const patches: HealSuggestPatch[] = [];
  const skipped: HealSuggestReport['skipped'] = [];
  const seen = new Set<string>();

  for (const entry of healLogs) {
    const { patch, skip } = extractHealPatch(entry);
    if (skip) {
      skipped.push(skip);
      continue;
    }
    if (!patch) continue;
    // 同一步多次 heal：保留最后一次
    if (seen.has(patch.stepId)) {
      const idx = patches.findIndex((p) => p.stepId === patch.stepId);
      if (idx >= 0) patches[idx] = patch;
    } else {
      seen.add(patch.stepId);
      patches.push(patch);
    }
  }

  return {
    version: HEAL_SUGGEST_VERSION,
    generatedAt: new Date().toISOString(),
    intentPath: opts.intentPath,
    patches,
    skipped,
  };
}

export function formatHealSuggestMarkdown(report: HealSuggestReport): string {
  const lines = [
    '## 自愈建议补丁（需人审）',
    '',
    `- 时间: ${report.generatedAt}`,
    report.intentPath ? `- Intent: \`${report.intentPath}\`` : '- Intent: —',
    `- 可写回步骤: ${report.patches.length}`,
    '',
    '规则：仅 click/fill/select 的 description / value / locatorHint；**不会改 assert**。',
    '应用：`npm run heal:suggest -- --run=<本目录> --intent=<yaml> --apply`',
    '',
  ];

  if (!report.patches.length) {
    lines.push('_无可写回补丁_');
  } else {
    lines.push('### 补丁');
    for (const p of report.patches) {
      const mark = p.accepted ? '已采纳' : '未采纳';
      lines.push(`- **${p.stepId}**（${mark}${p.engine ? ` · ${p.engine}` : ''}）`);
      for (const [k, v] of Object.entries(p.fields)) {
        lines.push(`  - ${k}: \`${v}\``);
      }
    }
    lines.push('');
  }

  if (report.skipped.length) {
    lines.push('### 跳过');
    for (const s of report.skipped.slice(0, 12)) {
      lines.push(`- ${s.stepId}: ${s.reason}`);
    }
  }

  return lines.join('\n');
}

export function writeHealSuggestArtifacts(
  outputDir: string,
  healLogs: HealLogEntry[],
  opts: { intentPath?: string } = {},
): { jsonRel?: string; mdRel?: string; report: HealSuggestReport } | undefined {
  if (!healLogs.length) return undefined;

  const abs = path.resolve(outputDir);
  fs.mkdirSync(abs, { recursive: true });
  const report = buildHealSuggestReport(healLogs, opts);
  const jsonAbs = path.join(abs, 'heal-suggest.json');
  const mdAbs = path.join(abs, 'heal-suggest.md');
  fs.writeFileSync(jsonAbs, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(mdAbs, `${formatHealSuggestMarkdown(report)}\n`, 'utf-8');

  const toRel = (p: string) => {
    const rel = path.relative(process.cwd(), p).replace(/\\/g, '/');
    return rel.startsWith('..') ? undefined : rel;
  };

  return {
    jsonRel: toRel(jsonAbs),
    mdRel: toRel(mdAbs),
    report,
  };
}

export function readHealSuggest(outputDir: string): HealSuggestReport | null {
  const file = path.join(path.resolve(outputDir), 'heal-suggest.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as HealSuggestReport;
  } catch {
    return null;
  }
}

/** 将建议补丁写回 Intent YAML（跳过 assert 步骤） */
export function applyHealSuggestToIntentYaml(
  intentPath: string,
  report: HealSuggestReport,
  opts: { onlyAccepted?: boolean } = {},
): { updated: string[]; skipped: string[] } {
  const abs = path.resolve(intentPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Intent 不存在: ${intentPath}`);
  }

  const raw = parseYaml(fs.readFileSync(abs, 'utf-8'));
  if (!isRecord(raw) || !Array.isArray(raw.steps)) {
    throw new Error('Intent YAML 缺少 steps');
  }

  const onlyAccepted = opts.onlyAccepted !== false;
  const updated: string[] = [];
  const skipped: string[] = [];
  const byId = new Map(report.patches.map((p) => [p.stepId, p]));

  for (const step of raw.steps) {
    if (!isRecord(step)) continue;
    const id = pickString(step.id);
    if (!id) continue;
    const patch = byId.get(id);
    if (!patch) continue;
    if (onlyAccepted && !patch.accepted) {
      skipped.push(`${id}: 未采纳`);
      continue;
    }
    if (pickString(step.action) === 'assert') {
      skipped.push(`${id}: assert 禁止写回`);
      continue;
    }
    if (patch.fields.description) step.description = patch.fields.description;
    if (patch.fields.value) step.value = patch.fields.value;
    if (patch.fields.locatorHint) step.locatorHint = patch.fields.locatorHint;
    updated.push(id);
  }

  if (updated.length) {
    fs.writeFileSync(abs, stringifyYaml(raw, { lineWidth: 120 }), 'utf-8');
  }

  return { updated, skipped };
}
