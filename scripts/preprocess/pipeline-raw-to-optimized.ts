/**
 * 串联：preprocess-raw-recordings → optimize-raw-recordings（对每个生成的 processed 目录执行一次）
 *
 * 用法:
 *   npx tsx scripts/preprocess/pipeline-raw-to-optimized.ts
 *   npx tsx scripts/preprocess/pipeline-raw-to-optimized.ts tests/raw-recordings/original/20260512
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveProcessedOutputPath } from './preprocess-raw-recordings';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function collectSpecFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'processed') continue;
      out.push(...collectSpecFiles(full));
    } else if (e.isFile() && e.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

function uniqueProcessedDirs(inputFiles: string[]): string[] {
  const dirs = new Set<string>();
  for (const f of inputFiles) {
    const outFile = resolveProcessedOutputPath(f);
    dirs.add(path.dirname(outFile));
  }
  return [...dirs].sort();
}

function runOptimize(processedDir: string): void {
  const r = spawnSync('npx', ['tsx', 'scripts/optimize/optimize-raw-recordings.ts', processedDir], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
  });
  if (r.status !== 0) process.exit(r.status === null ? 1 : r.status);
}

function main(): void {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const defaultOriginal = path.join(projectRoot, 'tests/raw-recordings/original');
  const target = argv[0] ? path.resolve(projectRoot, argv[0]) : defaultOriginal;

  if (!fs.existsSync(target)) {
    console.error(`❌ 路径不存在: ${target}`);
    process.exit(1);
  }

  const stat = fs.statSync(target);
  const inputFiles = stat.isFile()
    ? target.endsWith('.spec.ts')
      ? [target]
      : (console.error('❌ 仅支持 .spec.ts'), process.exit(1), [])
    : collectSpecFiles(target);

  if (inputFiles.length === 0) {
    console.log('⚠️  未找到待预处理的 .spec.ts');
    return;
  }

  console.log('━━ 1/2 预处理 ━━\n');
  const prep = spawnSync('npx', ['tsx', 'scripts/preprocess/preprocess-raw-recordings.ts', target], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
  });
  if (prep.status !== 0) process.exit(prep.status === null ? 1 : prep.status);

  const dirs = uniqueProcessedDirs(inputFiles);
  console.log('\n━━ 2/2 optimize-raw-recordings ━━\n');
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    console.log(`📂 ${path.relative(projectRoot, d)}\n`);
    runOptimize(d);
  }

  console.log('\n🎉 pipeline 完成');
}

main();
