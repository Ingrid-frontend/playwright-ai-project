import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PNG } from 'pngjs';
import type { StepMeta } from './structure-check.js';
import { auditStep, shouldUseMock, shouldUseFigmaVision, resolveVisionConfig } from './ui-audit-analyzer.js';
import {
  renderAuditDashboardHtml,
  renderAuditReportHtml,
  relativeAssetPath,
  type AuditStepReport,
} from './ui-audit-report.js';
import {
  archiveAuditRun,
  deriveRunMeta,
  groupCandidatesByRun,
  pickLatestRunGroup,
  readAuditHistory,
  runsDir,
  verdictFromCounts,
  type AuditHistoryEntry,
} from './ui-audit-history.js';
import { resolveFigmaBaseline } from './figma-baseline.js';
import { resolveHeliosAuditContext } from './helios-design-spec.js';
import { applyAuditRules, resolveAuditRule } from './ui-audit-rules.js';
import { writeFeedbackDocsFromAuditIssues } from './ui-feedback-doc.js';

// 必须在读取任何 AI_* 环境变量前加载，否则 .env 里配好的 Key 会被漏掉、永远降级 mock
dotenv.config({ path: path.join(process.cwd(), '.env') });

interface Args {
  dir: string;
  limit: number;
  out: string;
  gate: boolean;
  script?: string;
  scriptKey?: string;
  run?: string;
  figma?: string;
  figmaImage?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const withEq = argv.find((a) => a.startsWith(`--${name}=`));
    if (withEq) return withEq.slice(name.length + 3);
    const idx = argv.indexOf(`--${name}`);
    if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return argv[idx + 1];
    return undefined;
  };

  return {
    dir: get('dir') || 'screenshots',
    limit: Math.max(1, Number(get('limit')) || 6),
    out: get('out') || path.join('results', 'ui-audit'),
    gate: argv.includes('--gate'),
    script: get('script'),
    scriptKey: get('script-key'),
    run: get('run'),
    figma: get('figma'),
    figmaImage: get('figma-image'),
  };
}

interface Candidate {
  pngPath: string;
  metaPath: string;
  scriptKey: string;
  stepName: string;
  stepNumber?: number;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) out.push(full);
  }
  return out;
}

/** screenshots/<scriptKey>/run-<browser>/<timestamp>/step-xx.png → scriptKey */
function deriveScriptKey(pngPath: string, rootDir: string): string {
  const rel = path.relative(rootDir, pngPath).split(path.sep);
  const runIdx = rel.findIndex((seg) => seg.startsWith('run-'));
  const parts = runIdx > 0 ? rel.slice(0, runIdx) : rel.slice(0, -1);
  return parts.join('/') || '(未知脚本)';
}

function deriveStep(fileName: string): { stepName: string; stepNumber?: number } {
  const base = fileName.replace(/\.png$/i, '');
  const m = base.match(/^step-(\d+)[-_]?(.*)$/i);
  if (m) {
    return {
      stepNumber: Number(m[1]),
      stepName: (m[2] || `step ${m[1]}`).replace(/__/g, ' · ').replace(/_/g, ' '),
    };
  }
  return { stepName: base };
}

function readMeta(metaPath: string): StepMeta | null {
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as StepMeta;
  } catch {
    return null;
  }
}

function readPngSize(pngPath: string): { width: number; height: number } | null {
  try {
    const png = PNG.sync.read(fs.readFileSync(pngPath));
    return { width: png.width, height: png.height };
  } catch {
    return null;
  }
}

function collectCandidates(rootDir: string, script?: string, exact = false): Candidate[] {
  const out: Candidate[] = [];
  for (const pngPath of walk(rootDir)) {
    const metaPath = pngPath.replace(/\.png$/i, '.meta.json');
    if (!fs.existsSync(metaPath)) continue;
    const scriptKey = deriveScriptKey(pngPath, rootDir);
    if (script && (exact ? scriptKey !== script : !scriptKey.includes(script))) continue;
    const { stepName, stepNumber } = deriveStep(path.basename(pngPath));
    out.push({ pngPath, metaPath, scriptKey, stepName, stepNumber });
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.scriptKey) args.scriptKey = args.scriptKey.replace(/^flows\//, '');
  const rootDir = path.resolve(process.cwd(), args.dir);
  const outDir = path.resolve(process.cwd(), args.out);
  const assetDir = path.join(outDir, 'assets');

  const mock = shouldUseMock();
  const figmaVision = shouldUseFigmaVision() || Boolean(args.figmaImage);
  console.log(`🔍 AI UI 审计启动`);
  console.log(`   扫描目录: ${path.relative(process.cwd(), rootDir) || '.'}`);
  console.log(`   分析模式: ${mock ? 'mock（规则推断）' : 'AI 视觉'}`);
  console.log(
    `   Figma: ${figmaVision ? '双图视觉对比（慢，AI_AUDIT_FIGMA_VISION=1）' : '文本规范 + 单图（默认）'}`,
  );
  if (!mock) {
    const visionConfig = resolveVisionConfig();
    if (visionConfig) {
      // 打印端点与模型，便于排查兼容网关配置问题（不打印 Key）
      console.log(`   视觉模型: ${visionConfig.model}`);
      console.log(`   接口地址: ${visionConfig.url}`);
    } else {
      console.log('   ⚠️  未检测到 AI_API_KEY，将自动降级');
    }
  }
  if (args.figma) console.log(`   Figma URL: ${args.figma}`);
  if (args.figmaImage) console.log(`   Figma 本地图: ${args.figmaImage}`);

  const allCandidates = collectCandidates(rootDir, args.scriptKey || args.script, Boolean(args.scriptKey));
  const runGroup = args.run
    ? groupCandidatesByRun(allCandidates, rootDir).find(
        (group) => group.runTs === args.run && (!args.scriptKey || group.scriptKey === args.scriptKey),
      ) || null
    : pickLatestRunGroup(allCandidates, rootDir);
  const candidates = (runGroup?.items || []).slice(0, args.limit);
  if (runGroup) {
    console.log(`   本次 run: ${runGroup.runTs}（${runGroup.scriptKey}，${runGroup.items.length} 步）`);
  } else if (args.run) {
    console.error(`   未找到绑定 run: ${args.run}`);
    process.exit(1);
  }
  if (candidates.length === 0) {
    console.log(`\n⚠️  未找到可审计的截图（需要 .png 与同名 .meta.json 配对）`);
  }

  fs.mkdirSync(assetDir, { recursive: true });

  const steps: AuditStepReport[] = [];
  for (const [index, cand] of candidates.entries()) {
    const meta = readMeta(cand.metaPath);
    if (!meta) {
      console.log(`  ⏭️  跳过（meta 不可解析）: ${cand.stepName}`);
      continue;
    }

    const size = readPngSize(cand.pngPath);
    const imageWidth = size?.width ?? meta.imageWidth ?? meta.viewport?.width ?? 0;
    const imageHeight = size?.height ?? meta.imageHeight ?? meta.viewport?.height ?? 0;

    const figma = await resolveFigmaBaseline({
      scriptKey: cand.scriptKey,
      stepName: cand.stepName,
      stepNumber: cand.stepNumber,
      cliFigmaUrl: args.figma,
      cliFigmaImage: args.figmaImage,
    });

    const auditRule = resolveAuditRule(cand.scriptKey, cand.stepName, cand.stepNumber);
    const helios = resolveHeliosAuditContext(cand.scriptKey, cand.stepName, cand.stepNumber);

    const rawResult = await auditStep(
      cand.pngPath,
      meta,
      {
        scriptKey: cand.scriptKey,
        stepName: cand.stepName,
        stepNumber: cand.stepNumber,
        figmaUrl: figma?.url,
        figmaNote: figma?.note,
        expect: auditRule?.expect,
        helios: helios.enabled
          ? {
              tokensSummary: helios.tokensSummary,
              layoutRules: helios.layoutRules,
              figmaPage: helios.figmaPage,
            }
          : undefined,
      },
      { figmaImagePath: figmaVision ? figma?.imagePath : undefined },
    );
    const result = applyAuditRules(rawResult, auditRule);

    // 复制截图到报告目录，保证报告可独立分享
    const assetName = `${String(index + 1).padStart(2, '0')}-${path.basename(cand.pngPath)}`;
    const assetPath = path.join(assetDir, assetName);
    try {
      fs.copyFileSync(cand.pngPath, assetPath);
    } catch {
      /* 复制失败不影响审计结论 */
    }

    let figmaRel: string | undefined;
    if (figmaVision && figma?.imagePath) {
      const figmaName = `${String(index + 1).padStart(2, '0')}-figma${path.extname(figma.imagePath) || '.png'}`;
      const figmaPath = path.join(assetDir, figmaName);
      try {
        fs.copyFileSync(figma.imagePath, figmaPath);
        figmaRel = relativeAssetPath(outDir, figmaPath);
      } catch {
        /* 复制失败不影响审计结论 */
      }
    }

    steps.push({
      scriptKey: cand.scriptKey,
      stepName: cand.stepName,
      stepNumber: cand.stepNumber,
      screenshotRel: relativeAssetPath(outDir, assetPath),
      figmaRel,
      figmaUrl: figma?.url,
      helios: helios.enabled,
      imageWidth,
      imageHeight,
      viewportWidth: meta.viewport?.width ?? imageWidth,
      viewportHeight: meta.viewport?.height ?? imageHeight,
      url: meta.url,
      result,
    });

    const icon =
      result.verdict === 'fail'
        ? '🔴'
        : result.verdict === 'review'
          ? '🟡'
          : result.verdict === 'skipped'
            ? '⚪'
            : '🟢';
    const detail =
      result.verdict === 'skipped'
        ? '未审计（缺少判定依据）'
        : `分 ${result.score}，问题 ${result.issues.length}`;
    const figmaTag =
      result.baseline === 'figma'
        ? ' · Figma 双图'
        : result.baseline === 'figma-spec'
          ? ' · Figma 规范'
          : '';
    console.log(`  ${icon} ${cand.scriptKey} / ${cand.stepName} — ${detail}${figmaTag}`);
  }

  const figmaVisionCount = steps.filter((s) => s.result.baseline === 'figma').length;
  const figmaSpecCount = steps.filter((s) => s.result.baseline === 'figma-spec').length;
  const heliosCount = steps.filter((s) =>
    resolveHeliosAuditContext(s.scriptKey, s.stepName, s.stepNumber).enabled,
  ).length;
  const figmaModeLabel = [
    figmaVisionCount ? `Figma 双图 ${figmaVisionCount}` : '',
    figmaSpecCount ? `Figma 规范 ${figmaSpecCount}` : '',
    heliosCount ? `Helios ${heliosCount}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const aiSteps = steps.filter((s) => s.result.source === 'ai').length;
  const ruleSteps = steps.filter((s) => s.result.source === 'mock').length;
  const degradedSteps = steps.filter((s) => s.result.source === 'error').length;
  const sourceLabel = [
    aiSteps ? `AI 视觉 ${aiSteps}` : '',
    ruleSteps ? `规则分析 ${ruleSteps}` : '',
    degradedSteps ? `AI 降级 ${degradedSteps}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const modeLabel = `${sourceLabel || (mock ? 'mock 规则分析' : 'AI 视觉分析')}${figmaModeLabel ? ` · ${figmaModeLabel}` : ''}`;
  const generatedAt = new Date();
  const firstCand = candidates[0];
  const runMeta = firstCand ? deriveRunMeta(firstCand.pngPath, rootDir, firstCand.scriptKey) : null;
  const scriptKey = runGroup?.scriptKey || firstCand?.scriptKey;
  const runId = runMeta?.runId;
  const runTs = runMeta?.runTs;

  const reportMeta = {
    generatedAt,
    mode: modeLabel,
    scriptKey,
    runId,
    runTs,
    manifestRunId: args.run || runTs,
  };

  const history = readAuditHistory(outDir);
  const dashboardHtml = renderAuditDashboardHtml(steps, reportMeta, history);
  const htmlPath = path.join(outDir, 'index.html');
  fs.writeFileSync(htmlPath, dashboardHtml, 'utf-8');

  if (runId && steps.length > 0) {
    const runOut = path.join(runsDir(outDir), runId);
    const runAssetDir = path.join(runOut, 'assets');
    fs.mkdirSync(runAssetDir, { recursive: true });
    const runSteps: AuditStepReport[] = steps.map((s) => {
      const shotName = path.basename(s.screenshotRel);
      const figmaName = s.figmaRel ? path.basename(s.figmaRel) : '';
      const srcShot = path.join(outDir, s.screenshotRel);
      const destShot = path.join(runAssetDir, shotName);
      try {
        fs.copyFileSync(srcShot, destShot);
      } catch {
        /* ignore */
      }
      let figmaRel: string | undefined;
      if (s.figmaRel && figmaName) {
        const srcFigma = path.join(outDir, s.figmaRel);
        const destFigma = path.join(runAssetDir, figmaName);
        try {
          fs.copyFileSync(srcFigma, destFigma);
          figmaRel = `assets/${figmaName}`;
        } catch {
          /* ignore */
        }
      }
      return {
        ...s,
        screenshotRel: `assets/${shotName}`,
        figmaRel,
      };
    });
    const runHtml = renderAuditReportHtml(runSteps, reportMeta);
    fs.writeFileSync(path.join(runOut, 'index.html'), runHtml, 'utf-8');
  }

  const summary = {
    generatedAt: generatedAt.toISOString(),
    runId,
    runTs,
    manifestRunId: args.run || runTs,
    scriptKey,
    mode: degradedSteps > 0 ? 'degraded' : aiSteps > 0 ? 'ai' : 'mock',
    requestedMode: mock ? 'mock' : 'ai',
    aiSteps,
    ruleSteps,
    degradedSteps,
    total: steps.length,
    pass: steps.filter((s) => s.result.verdict === 'pass').length,
    review: steps.filter((s) => s.result.verdict === 'review').length,
    fail: steps.filter((s) => s.result.verdict === 'fail').length,
    skipped: steps.filter((s) => s.result.verdict === 'skipped').length,
    figma: figmaVisionCount + figmaSpecCount,
    figmaVision: figmaVisionCount,
    figmaSpec: figmaSpecCount,
    helios: heliosCount,
    issueTotal: steps.reduce(
      (n, s) =>
        n +
        s.result.issues.filter(
          (issue) => issue.severity === 'blocker' || issue.severity === 'warning',
        ).length,
      0,
    ),
    observationTotal: steps.reduce(
      (n, s) => n + s.result.issues.filter((issue) => issue.severity === 'noise').length,
      0,
    ),
    steps: steps.map((s) => ({
      scriptKey: s.scriptKey,
      stepName: s.stepName,
      verdict: s.result.verdict,
      score: s.result.score,
      source: s.result.source,
      baseline: s.result.baseline,
      helios: s.helios,
      figmaUrl: s.figmaUrl,
      issues: s.result.issues,
    })),
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  if (runId && steps.length > 0) {
    const runOut = path.join(runsDir(outDir), runId);
    fs.mkdirSync(runOut, { recursive: true });
    fs.writeFileSync(path.join(runOut, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  }

  const flat = steps
    .filter((s) => s.result.issues.length > 0 && s.result.verdict !== 'skipped')
    .map((s) => ({
      scriptKey: s.scriptKey,
      stepName: s.stepName,
      stepNumber: s.stepNumber,
      url: s.url,
      screenshotRel: s.screenshotRel,
      issues: s.result.issues.filter((i) => i.severity === 'blocker' || i.severity === 'warning'),
    }))
    .filter((s) => s.issues.length > 0);
  if (flat.length) {
    const docIndex = writeFeedbackDocsFromAuditIssues(flat, { env: process.env.PLAYWRIGHT_ENV });
    if (docIndex.docs.length) {
    console.log(`📝 AI 分析文档: ${docIndex.docs.length} 条 → results/ui-feedback-docs/latest.md`);
    }
  }

  if (runId && scriptKey) {
    const { verdict, verdictLabel } = verdictFromCounts({ fail: summary.fail, review: summary.review });
    const entry: AuditHistoryEntry = {
      runId,
      runKey: runMeta?.runKey || `${scriptKey}::${runTs}`,
      runTs,
      scriptKey,
      generatedAt: summary.generatedAt,
      mode: modeLabel,
      total: summary.total,
      pass: summary.pass,
      review: summary.review,
      fail: summary.fail,
      skipped: summary.skipped,
      issueTotal: steps.reduce(
        (n, s) =>
          n +
          s.result.issues.filter(
            (issue) => issue.severity === 'blocker' || issue.severity === 'warning',
          ).length,
        0,
      ),
      verdict,
      verdictLabel,
      reportRel: `runs/${runId}/index.html`,
    };
    archiveAuditRun(outDir, entry);
  }

  console.log(
    `\n📊 汇总: 🟢 ${summary.pass}  🟡 ${summary.review}  🔴 ${summary.fail}  ⚪ ${summary.skipped}`,
  );
  console.log(`📄 报告: ${path.relative(process.cwd(), htmlPath)}`);

  if (summary.skipped > 0 && mock) {
    console.log(
      `\n⚠️  ${summary.skipped} 个步骤缺少判定依据未审计。mock 模式只能识别既有信号，` +
        `真实缺陷检出需设置 AI_API_KEY 启用 AI 视觉分析。`,
    );
  }

  if (args.gate && summary.fail > 0) {
    console.log(`\n❌ --gate 已启用且存在 ${summary.fail} 个需修复项`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('AI UI 审计执行失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
