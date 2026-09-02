import fs from 'fs';
import path from 'path';
import type { StepMeta } from './structure-check.js';
import type { UiIssue, UiIssuesReport } from './ui-issues.js';
import type { AuditIssue } from './ui-audit-schema.js';

export const FEEDBACK_DOCS_DIR = 'results/ui-feedback-docs';
export const FEEDBACK_INDEX_FILE = path.join(FEEDBACK_DOCS_DIR, 'index.json');
export const FEEDBACK_COMPACT_JSON = path.join(FEEDBACK_DOCS_DIR, 'latest.json');
export const FEEDBACK_COMPACT_MD = path.join(FEEDBACK_DOCS_DIR, 'latest.md');
export const MANUAL_FEEDBACK_FILE = 'results/manual-feedback.json';

/** 默认 compact：单文件 latest.md + latest.json；设 UI_FEEDBACK_DOC_SPLIT=1 才每条单独 .md */
export function isSplitFeedbackDocs(): boolean {
  const v = process.env.UI_FEEDBACK_DOC_SPLIT?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export type FeedbackSource = 'automated' | 'manual';

export interface FeedbackDocContext {
  docId: string;
  source: FeedbackSource;
  env?: string;
  url?: string;
  title?: string;
  reporter?: string;
  description?: string;
  scriptKey: string;
  stepName: string;
  stepNumber?: number;
  issueId?: string;
  severity?: string;
  compareKind?: string;
  structureType?: string;
  detail?: string;
  selector?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  xpath?: string;
  stableAttributes?: Record<string, string>;
  textHint?: string;
  auditType?: string;
  screenshotPath?: string;
  baselinePath?: string;
  fixHint?: string;
}

export interface FeedbackDocRecord {
  docId: string;
  issueId?: string;
  source: FeedbackSource;
  scriptKey: string;
  stepName: string;
  stepNumber?: number;
  reporter?: string;
  severity?: string;
  relPath: string;
  generatedAt: string;
}

export interface FeedbackDocsIndex {
  generatedAt: string;
  executionId?: string;
  mode: 'compact' | 'split';
  docs: FeedbackDocRecord[];
  compactPath?: string;
}

export interface CompactFeedbackStore {
  generatedAt: string;
  executionId?: string;
  items: Array<FeedbackDocContext & { docId: string; generatedAt: string }>;
}

function slug(s: string): string {
  return String(s || '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function fmtBBox(b?: { x: number; y: number; width: number; height: number }): string {
  if (!b) return '—';
  return `x=${Math.round(b.x)}, y=${Math.round(b.y)}, w=${Math.round(b.width)}, h=${Math.round(b.height)}`;
}

function readStepMeta(pngPath: string): StepMeta | null {
  const metaPath = pngPath.replace(/\.png$/i, '.meta.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as StepMeta;
  } catch {
    return null;
  }
}

function pickElementFromMeta(meta: StepMeta | null, selector?: string): {
  bbox?: FeedbackDocContext['bbox'];
  xpath?: string;
  stableAttributes?: Record<string, string>;
  textHint?: string;
  selector?: string;
} {
  if (!meta?.selectors) return {};
  const entries = Object.entries(meta.selectors);
  if (!entries.length) return {};
  let hit = entries.find(([, v]) => v?.exists && selector && v.fingerprint);
  if (!hit) hit = entries.find(([, v]) => v?.exists);
  if (!hit) return {};
  const [, info] = hit;
  const fp = info.fingerprint;
  return {
    selector: selector || hit[0],
    bbox: info.bbox,
    xpath: fp?.xpath,
    stableAttributes: fp?.stableAttributes,
    textHint: fp?.textHint,
  };
}

export function fixHintForIssue(issue: Pick<UiIssue, 'structureType' | 'severity' | 'compareKind' | 'detail'>): string {
  const t = issue.structureType || '';
  if (t === 'selector-drift') {
    return '主选择器失效但兜底命中。运行 `npm run selector-drift:suggest` 生成补丁，确认后 `npm run selector-drift:apply`。';
  }
  if (t === 'content-update') {
    return '结构未变、仅文本/数据更新，通常为正常业务变动。若文案错误，检查数据源或 i18n。';
  }
  if (t === 'dom-drift') {
    return '分区 DOM 结构变化。对照 `config/ui-regression.json` 的 changeDetection.sections，检查最近组件/布局改动。';
  }
  if (t === 'bbox-drift') {
    return '元素位置/尺寸偏移。检查 margin/padding、flex 对齐、响应式断点与 Helios 布局模版。';
  }
  if (t === 'missing-selector') {
    return '关键元素未找到。确认页面是否加载完成、路由是否正确，或更新 structureChecks 选择器。';
  }
  if (t === 'horizontal-overflow') {
    return '页面横向溢出。检查固定宽度、min-width、表格列宽与侧栏折叠态。';
  }
  if (t === 'style-drift') {
    return 'computed style 与基线不一致。对照 Helios Token 与设计稿，检查字号/颜色/圆角/阴影。';
  }
  if (issue.compareKind === 'golden' || issue.compareKind === 'last-green') {
    return '像素与验收基线不一致。打开客户报告对比图确认；若为预期变更，promote 基线。';
  }
  return '将本文档与截图一并交给 AI 编辑器或 Codex，结合 ui-feedback-diagnosis 技能定位源码。';
}

export function fixHintForAuditType(type: string): string {
  const map: Record<string, string> = {
    truncation: '检查列宽、text-overflow、ellipsis 与表格列配置。',
    occlusion: '检查 z-index、fixed/sticky 层叠与弹窗/遮罩交互。',
    overflow: '检查容器 overflow、max-height 与内容区滚动。',
    layout: '检查 flex/grid 对齐、间距 token 与响应式布局。',
    'design-mismatch': '对照 Figma/Helios 设计稿与 helios-audit-bindings 布局说明。',
    'missing-element': '确认组件是否条件渲染、接口是否返回完整数据。',
  };
  return map[type] || '将本文档与截图交给 AI 编辑器分析修复。';
}

export function buildDocId(ctx: Pick<FeedbackDocContext, 'source' | 'scriptKey' | 'stepName' | 'issueId' | 'docId'>): string {
  if (ctx.docId) return ctx.docId;
  if (ctx.issueId) return slug(ctx.issueId) || ctx.issueId.slice(0, 24);
  const base = [ctx.source, ctx.scriptKey, ctx.stepName].filter(Boolean).join('--');
  return slug(base) || `fb-${Date.now()}`;
}

function buildCompactMarkdown(items: Array<FeedbackDocContext & { docId: string }>): string {
  const parts = items.map((ctx) => {
    const body = buildFeedbackDocMarkdown(ctx).replace(/^# /m, '## ');
    return `<a id="${ctx.docId}"></a>\n${body}`;
  });
  return [`# UI 反馈分析汇总 (${items.length})`, '', ...parts].join('\n\n');
}

function manualEntryToCompactItem(entry: ManualFeedbackEntry): FeedbackDocContext & { docId: string; generatedAt: string } {
  return {
    docId: entry.id,
    source: 'manual',
    env: entry.env,
    url: entry.url,
    reporter: entry.reporter,
    description: entry.description,
    scriptKey: entry.scriptKey || '(手动登记)',
    stepName: entry.stepName || '页面问题',
    stepNumber: entry.stepNumber,
    selector: entry.selector,
    bbox: entry.bbox,
    xpath: entry.xpath,
    screenshotPath: entry.screenshotPath,
    severity: 'warning',
    fixHint: '手动登记的 UI 问题。将本文档与截图交给 AI 编辑器，结合 ui-feedback-diagnosis 技能修复。',
    generatedAt: entry.createdAt,
  };
}

function readAutomatedCompactItems(cwd = process.cwd()): Array<FeedbackDocContext & { docId: string; generatedAt?: string }> {
  const store = readCompactFeedbackStore(cwd);
  return (store?.items || []).filter((i) => i.source !== 'manual' && !String(i.docId).startsWith('mf-'));
}

function mergeCompactWithManual(
  automated: Array<FeedbackDocContext & { docId: string }>,
  cwd = process.cwd(),
): Array<FeedbackDocContext & { docId: string; generatedAt: string }> {
  const manual = readManualFeedbackList(cwd).map(manualEntryToCompactItem);
  const seen = new Set<string>();
  const out: Array<FeedbackDocContext & { docId: string; generatedAt: string }> = [];
  for (const item of automated) {
    if (seen.has(item.docId)) continue;
    seen.add(item.docId);
    out.push({ ...item, generatedAt: (item as { generatedAt?: string }).generatedAt || new Date().toISOString() });
  }
  for (const item of manual) {
    if (seen.has(item.docId)) continue;
    seen.add(item.docId);
    out.push(item);
  }
  return out;
}

function writeCompactFeedbackDocs(
  items: Array<FeedbackDocContext & { docId: string }>,
  opts?: { outDir?: string; cwd?: string; executionId?: string },
): FeedbackDocsIndex {
  const cwd = opts?.cwd || process.cwd();
  const outDir = path.resolve(cwd, opts?.outDir || FEEDBACK_DOCS_DIR);
  fs.mkdirSync(outDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const stamped = items.map((ctx) => ({
    ...ctx,
    generatedAt: (ctx as { generatedAt?: string }).generatedAt || generatedAt,
  }));
  const jsonRel = opts?.outDir ? path.join(opts.outDir, 'latest.json') : FEEDBACK_COMPACT_JSON;
  const mdRel = opts?.outDir ? path.join(opts.outDir, 'latest.md') : FEEDBACK_COMPACT_MD;
  fs.writeFileSync(path.join(cwd, jsonRel), JSON.stringify({ generatedAt, executionId: opts?.executionId, items: stamped }, null, 2), 'utf-8');
  fs.writeFileSync(path.join(cwd, mdRel), buildCompactMarkdown(items), 'utf-8');
  const docs: FeedbackDocRecord[] = stamped.map((ctx) => ({
    docId: ctx.docId,
    issueId: ctx.issueId,
    source: ctx.source,
    scriptKey: ctx.scriptKey,
    stepName: ctx.stepName,
    stepNumber: ctx.stepNumber,
    reporter: ctx.reporter,
    severity: ctx.severity,
    relPath: `${mdRel}#${ctx.docId}`,
    generatedAt,
  }));
  const index: FeedbackDocsIndex = {
    generatedAt,
    executionId: opts?.executionId,
    mode: 'compact',
    docs,
    compactPath: mdRel,
  };
  fs.writeFileSync(path.join(cwd, opts?.outDir || FEEDBACK_DOCS_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');
  return index;
}

export function readCompactFeedbackStore(cwd = process.cwd()): CompactFeedbackStore | null {
  const file = path.join(cwd, FEEDBACK_COMPACT_JSON);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as CompactFeedbackStore;
  } catch {
    return null;
  }
}

export function exportFeedbackDocMarkdown(docId: string, cwd = process.cwd()): string | null {
  const store = readCompactFeedbackStore(cwd);
  const hit = store?.items.find((i) => i.docId === docId);
  if (hit) return buildFeedbackDocMarkdown(hit);
  const manual = readManualFeedbackList(cwd).find((e) => e.id === docId);
  if (manual) return buildFeedbackDocMarkdown(manualEntryToCompactItem(manual));
  return null;
}

export function buildFeedbackDocMarkdown(ctx: FeedbackDocContext): string {
  const lines: string[] = [];
  lines.push(`# UI 问题分析 · ${ctx.scriptKey} · ${ctx.stepName}`);
  lines.push('');
  lines.push('## 登记信息');
  lines.push(`- 来源: ${ctx.source === 'manual' ? '手动登记' : '自动回归'}`);
  if (ctx.env) lines.push(`- 环境: ${ctx.env}`);
  if (ctx.url) lines.push(`- 页面: ${ctx.url}`);
  if (ctx.title) lines.push(`- 标题: ${ctx.title}`);
  if (ctx.reporter) lines.push(`- 登记人: ${ctx.reporter}`);
  if (ctx.severity) lines.push(`- 严重度: ${ctx.severity}`);
  if (ctx.compareKind) lines.push(`- 对比类型: ${ctx.compareKind}`);
  if (ctx.structureType) lines.push(`- 结构类型: ${ctx.structureType}`);
  if (ctx.auditType) lines.push(`- 审计类型: ${ctx.auditType}`);
  lines.push(`- 步骤: ${ctx.stepNumber != null ? `#${ctx.stepNumber} ` : ''}${ctx.stepName}`);
  if (ctx.issueId) lines.push(`- 问题 ID: ${ctx.issueId}`);
  lines.push('');
  lines.push('## 问题描述');
  lines.push(ctx.description || ctx.detail || '（无文字描述，请结合截图判断）');
  lines.push('');
  lines.push('## 目标元素');
  lines.push(`- selector: ${ctx.selector || '—'}`);
  lines.push(`- bbox: ${fmtBBox(ctx.bbox)}`);
  if (ctx.xpath) lines.push(`- xpath: \`${ctx.xpath}\``);
  if (ctx.stableAttributes && Object.keys(ctx.stableAttributes).length) {
    lines.push(`- stableAttributes: \`${JSON.stringify(ctx.stableAttributes)}\``);
  }
  if (ctx.textHint) lines.push(`- textHint: ${ctx.textHint}`);
  lines.push('');
  lines.push('## 截图');
  if (ctx.screenshotPath) lines.push(`- 当前: ${ctx.screenshotPath}`);
  if (ctx.baselinePath) lines.push(`- 基线: ${ctx.baselinePath}`);
  lines.push('');
  lines.push('## 修复建议');
  lines.push(ctx.fixHint || fixHintForIssue({ structureType: ctx.structureType, severity: ctx.severity, compareKind: ctx.compareKind as UiIssue['compareKind'], detail: ctx.detail }));
  lines.push('');
  lines.push('---');
  lines.push('可将本文档与截图交给 AI 编辑器或 Codex，结合 `ui-feedback-diagnosis` 技能搜索源码并修复。');
  return lines.join('\n');
}

export function issueToFeedbackContext(issue: UiIssue, opts?: { env?: string; cwd?: string }): FeedbackDocContext {
  const cwd = opts?.cwd || process.cwd();
  const currentAbs = path.isAbsolute(issue.currentPath)
    ? issue.currentPath
    : path.join(cwd, issue.currentPath);
  const meta = fs.existsSync(currentAbs) ? readStepMeta(currentAbs) : null;
  const el = pickElementFromMeta(meta, issue.detail?.includes('selector') ? undefined : undefined);

  return {
    docId: buildDocId({ source: 'automated', scriptKey: issue.scriptKey, stepName: issue.stepName, issueId: issue.issueId, docId: '' }),
    source: issue.source || 'automated',
    env: opts?.env || process.env.PLAYWRIGHT_ENV,
    url: meta?.url,
    title: meta?.title,
    reporter: issue.reporter,
    description: issue.description || issue.detail,
    scriptKey: issue.scriptKey,
    stepName: issue.stepName,
    stepNumber: issue.stepNumber,
    issueId: issue.issueId,
    severity: issue.severity,
    compareKind: issue.compareKind,
    structureType: issue.structureType,
    detail: issue.detail,
    selector: issue.elementSelector || el.selector,
    bbox: el.bbox,
    xpath: issue.elementXpath || el.xpath,
    stableAttributes: el.stableAttributes,
    textHint: el.textHint,
    screenshotPath: issue.currentPath,
    baselinePath: issue.baselinePath,
    fixHint: fixHintForIssue(issue),
  };
}

export function auditIssueToFeedbackContext(
  audit: AuditIssue,
  step: { scriptKey: string; stepName: string; stepNumber?: number; url?: string },
  opts?: { env?: string; screenshotPath?: string },
): FeedbackDocContext {
  return {
    docId: buildDocId({
      source: 'automated',
      scriptKey: step.scriptKey,
      stepName: step.stepName,
      issueId: audit.id,
      docId: '',
    }),
    source: 'automated',
    env: opts?.env || process.env.PLAYWRIGHT_ENV,
    url: step.url,
    description: audit.description,
    scriptKey: step.scriptKey,
    stepName: step.stepName,
    stepNumber: step.stepNumber,
    issueId: audit.id,
    severity: audit.severity,
    auditType: audit.type,
    selector: audit.selector,
    bbox: audit.bbox || undefined,
    screenshotPath: opts?.screenshotPath,
    fixHint: fixHintForAuditType(audit.type),
  };
}

export function writeFeedbackDoc(ctx: FeedbackDocContext, opts?: { outDir?: string; cwd?: string }): FeedbackDocRecord {
  const cwd = opts?.cwd || process.cwd();
  const outDir = path.resolve(cwd, opts?.outDir || FEEDBACK_DOCS_DIR);
  fs.mkdirSync(outDir, { recursive: true });
  const docId = buildDocId(ctx);
  const relPath = path.join(opts?.outDir || FEEDBACK_DOCS_DIR, `${docId}.md`);
  const absPath = path.join(cwd, relPath);
  fs.writeFileSync(absPath, buildFeedbackDocMarkdown({ ...ctx, docId }), 'utf-8');
  return {
    docId,
    issueId: ctx.issueId,
    source: ctx.source,
    scriptKey: ctx.scriptKey,
    stepName: ctx.stepName,
    stepNumber: ctx.stepNumber,
    reporter: ctx.reporter,
    severity: ctx.severity,
    relPath,
    generatedAt: new Date().toISOString(),
  };
}

export function writeFeedbackDocsFromReport(
  report: UiIssuesReport,
  opts?: { outDir?: string; cwd?: string; env?: string; executionId?: string; minSeverity?: 'warning' | 'blocker' },
): FeedbackDocsIndex {
  const cwd = opts?.cwd || process.cwd();
  const min = opts?.minSeverity || 'warning';
  const order = { blocker: 3, warning: 2, noise: 1, info: 0 };
  const minW = order[min] ?? 2;
  const split = isSplitFeedbackDocs();
  const items: Array<FeedbackDocContext & { docId: string }> = [];

  for (const issue of report.issues) {
    if ((order[issue.severity] ?? 0) < minW) continue;
    const ctx = issueToFeedbackContext(issue, { env: opts?.env, cwd });
    const docId = buildDocId(ctx);
    const full = { ...ctx, docId };
    items.push(full);
    if (!issue.source) issue.source = 'automated';
    if (split) {
      const doc = writeFeedbackDoc(full, { outDir: opts?.outDir, cwd });
      issue.aiDocPath = doc.relPath;
    } else {
      issue.aiDocPath = `${FEEDBACK_COMPACT_MD}#${docId}`;
    }
  }

  if (!items.length && !readManualFeedbackList(cwd).length) {
    return { generatedAt: new Date().toISOString(), executionId: opts?.executionId, mode: split ? 'split' : 'compact', docs: [] };
  }

  if (!items.length) {
    return writeCompactFeedbackDocs(mergeCompactWithManual([], cwd), opts);
  }

  if (split) {
    const index: FeedbackDocsIndex = {
      generatedAt: new Date().toISOString(),
      executionId: opts?.executionId,
      mode: 'split',
      docs: items.map((ctx) => ({
        docId: ctx.docId,
        issueId: ctx.issueId,
        source: ctx.source,
        scriptKey: ctx.scriptKey,
        stepName: ctx.stepName,
        stepNumber: ctx.stepNumber,
        reporter: ctx.reporter,
        severity: ctx.severity,
        relPath: path.join(opts?.outDir || FEEDBACK_DOCS_DIR, `${ctx.docId}.md`),
        generatedAt: new Date().toISOString(),
      })),
    };
    const indexPath = path.resolve(cwd, opts?.outDir || FEEDBACK_DOCS_DIR, 'index.json');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    return index;
  }

  return writeCompactFeedbackDocs(mergeCompactWithManual(items, cwd), opts);
}

export function writeFeedbackDocsFromAuditIssues(
  steps: Array<{
    scriptKey: string;
    stepName: string;
    stepNumber?: number;
    url?: string;
    screenshotRel?: string;
    issues: AuditIssue[];
  }>,
  opts?: { outDir?: string; cwd?: string; env?: string },
): FeedbackDocsIndex {
  const split = isSplitFeedbackDocs();
  const items: Array<FeedbackDocContext & { docId: string }> = [];
  for (const step of steps) {
    for (const audit of step.issues) {
      if (audit.severity === 'noise' || audit.severity === 'info') continue;
      const ctx = auditIssueToFeedbackContext(audit, step, {
        env: opts?.env,
        screenshotPath: step.screenshotRel,
      });
      items.push({ ...ctx, docId: buildDocId(ctx) });
    }
  }
  if (!items.length && !readManualFeedbackList(opts?.cwd || process.cwd()).length) {
    return { generatedAt: new Date().toISOString(), mode: split ? 'split' : 'compact', docs: [] };
  }
  if (!items.length) {
    return writeCompactFeedbackDocs(mergeCompactWithManual([], opts?.cwd || process.cwd()), opts);
  }
  if (split) {
    const docs: FeedbackDocRecord[] = [];
    for (const item of items) {
      docs.push(writeFeedbackDoc(item, { outDir: opts?.outDir, cwd: opts?.cwd }));
    }
    const index: FeedbackDocsIndex = {
      generatedAt: new Date().toISOString(),
      mode: 'split',
      docs,
    };
    const indexPath = path.resolve(opts?.cwd || process.cwd(), opts?.outDir || FEEDBACK_DOCS_DIR, 'index.json');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    return index;
  }
  return writeCompactFeedbackDocs(mergeCompactWithManual(items, opts?.cwd || process.cwd()), opts);
}

export interface ManualFeedbackEntry {
  id: string;
  createdAt: string;
  reporter: string;
  description: string;
  env?: string;
  url?: string;
  scriptKey?: string;
  stepName?: string;
  stepNumber?: number;
  bbox?: { x: number; y: number; width: number; height: number };
  selector?: string;
  xpath?: string;
  screenshotPath?: string;
  assignees?: string[];
  source: 'manual';
  aiDocPath?: string;
  feishuRecordId?: string;
}

export function readManualFeedbackList(cwd = process.cwd()): ManualFeedbackEntry[] {
  const file = path.join(cwd, MANUAL_FEEDBACK_FILE);
  if (!fs.existsSync(file)) return [];
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf-8')) as { entries?: ManualFeedbackEntry[] };
    return Array.isArray(json.entries) ? json.entries : [];
  } catch {
    return [];
  }
}

function isNearDup(a: ManualFeedbackEntry, b: Omit<ManualFeedbackEntry, 'id' | 'createdAt' | 'source'>): boolean {
  if (a.reporter !== b.reporter || a.description !== b.description) return false;
  if ((a.scriptKey || '') !== (b.scriptKey || '')) return false;
  if ((a.stepName || '') !== (b.stepName || '')) return false;
  if (Date.now() - new Date(a.createdAt).getTime() > 60_000) return false;
  return true;
}

export function appendManualFeedback(entry: Omit<ManualFeedbackEntry, 'id' | 'createdAt' | 'source'>, cwd = process.cwd()): ManualFeedbackEntry {
  const list = readManualFeedbackList(cwd);
  const dup = list.find((e) => isNearDup(e, entry));
  if (dup) return dup;
  const full: ManualFeedbackEntry = {
    ...entry,
    id: `mf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    source: 'manual',
  };
  const ctx: FeedbackDocContext = {
    docId: full.id,
    source: 'manual',
    env: full.env,
    url: full.url,
    reporter: full.reporter,
    description: full.description,
    scriptKey: full.scriptKey || '(手动登记)',
    stepName: full.stepName || '页面问题',
    stepNumber: full.stepNumber,
    selector: full.selector,
    bbox: full.bbox,
    xpath: full.xpath,
    screenshotPath: full.screenshotPath,
    severity: 'warning',
    fixHint: '手动登记的 UI 问题。将本文档与截图交给 AI 编辑器，结合 ui-feedback-diagnosis 技能修复。',
  };
  list.push(full);
  const file = path.join(cwd, MANUAL_FEEDBACK_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ updatedAt: new Date().toISOString(), entries: list }, null, 2), 'utf-8');
  if (isSplitFeedbackDocs()) {
    const doc = writeFeedbackDoc(ctx, { cwd });
    full.aiDocPath = doc.relPath;
  } else {
    full.aiDocPath = `${FEEDBACK_COMPACT_MD}#${ctx.docId}`;
    const automated = readAutomatedCompactItems(cwd);
    writeCompactFeedbackDocs(mergeCompactWithManual(automated, cwd), { cwd });
  }
  return full;
}

export function parseAssignees(description: string): string[] {
  const out: string[] = [];
  const re = /@([^\s@]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(description))) {
    const name = m[1].trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}
