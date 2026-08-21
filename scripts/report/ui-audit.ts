import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PNG } from 'pngjs';
import type { StepMeta } from './structure-check.js';
import { auditStep, shouldUseMock, resolveVisionConfig } from './ui-audit-analyzer.js';
import {
  renderAuditReportHtml,
  relativeAssetPath,
  type AuditStepReport,
} from './ui-audit-report.js';

// 必须在读取任何 AI_* 环境变量前加载，否则 .env 里配好的 Key 会被漏掉、永远降级 mock
dotenv.config({ path: path.join(process.cwd(), '.env') });

interface Args {
  dir: string;
  limit: number;
  out: string;
  gate: boolean;
  script?: string;
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
    limit: Math.max(1, Number(get('limit')) || 12),
    out: get('out') || path.join('results', 'ui-audit'),
    gate: argv.includes('--gate'),
    script: get('script'),
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

function collectCandidates(rootDir: string, script?: string): Candidate[] {
  const out: Candidate[] = [];
  for (const pngPath of walk(rootDir)) {
    const metaPath = pngPath.replace(/\.png$/i, '.meta.json');
    if (!fs.existsSync(metaPath)) continue;
    const scriptKey = deriveScriptKey(pngPath, rootDir);
    if (script && !scriptKey.includes(script)) continue;
    const { stepName, stepNumber } = deriveStep(path.basename(pngPath));
    out.push({ pngPath, metaPath, scriptKey, stepName, stepNumber });
  }
  // 新的优先，便于只审计最近一次结果
  out.sort((a, b) => {
    const ta = fs.statSync(a.pngPath).mtimeMs;
    const tb = fs.statSync(b.pngPath).mtimeMs;
    return tb - ta;
  });
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(process.cwd(), args.dir);
  const outDir = path.resolve(process.cwd(), args.out);
  const assetDir = path.join(outDir, 'assets');

  const mock = shouldUseMock();
  console.log(`🔍 AI UI 审计启动`);
  console.log(`   扫描目录: ${path.relative(process.cwd(), rootDir) || '.'}`);
  console.log(`   分析模式: ${mock ? 'mock（规则推断）' : 'AI 视觉'}`);
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

  const candidates = collectCandidates(rootDir, args.script).slice(0, args.limit);
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

    const result = await auditStep(cand.pngPath, meta, {
      scriptKey: cand.scriptKey,
      stepName: cand.stepName,
      stepNumber: cand.stepNumber,
    });

    // 复制截图到报告目录，保证报告可独立分享
    const assetName = `${String(index + 1).padStart(2, '0')}-${path.basename(cand.pngPath)}`;
    const assetPath = path.join(assetDir, assetName);
    try {
      fs.copyFileSync(cand.pngPath, assetPath);
    } catch {
      /* 复制失败不影响审计结论 */
    }

    steps.push({
      scriptKey: cand.scriptKey,
      stepName: cand.stepName,
      stepNumber: cand.stepNumber,
      screenshotRel: relativeAssetPath(outDir, assetPath),
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
    console.log(`  ${icon} ${cand.scriptKey} / ${cand.stepName} — ${detail}`);
  }

  const html = renderAuditReportHtml(steps, {
    mode: mock ? 'mock 规则分析' : 'AI 视觉分析',
  });
  const htmlPath = path.join(outDir, 'index.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: mock ? 'mock' : 'ai',
    total: steps.length,
    pass: steps.filter((s) => s.result.verdict === 'pass').length,
    review: steps.filter((s) => s.result.verdict === 'review').length,
    fail: steps.filter((s) => s.result.verdict === 'fail').length,
    skipped: steps.filter((s) => s.result.verdict === 'skipped').length,
    steps: steps.map((s) => ({
      scriptKey: s.scriptKey,
      stepName: s.stepName,
      verdict: s.result.verdict,
      score: s.result.score,
      issues: s.result.issues,
    })),
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

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
