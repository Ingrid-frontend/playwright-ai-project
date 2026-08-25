const fs = require('fs');
const path = require('path');
const { checkCatalogAgainstSnapshot } = require('../../approval-flow/utils/catalog-check.cjs');

const snapshotArg = process.argv.find((a) => a.startsWith('--snapshot='));
const snapshotPath = snapshotArg
  ? path.resolve(process.cwd(), snapshotArg.slice('--snapshot='.length))
  : path.join(process.cwd(), 'approval-flow/datasource/live-snapshot.json');

if (!fs.existsSync(snapshotPath)) {
  console.error(`❌ 缺少 snapshot：${snapshotPath}`);
  console.error('请先执行 approval-flow 实机探活，或传入 --snapshot=approval-flow/datasource/live-snapshot.json');
  process.exit(1);
}

let snapshot;
try {
  snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
} catch (e) {
  console.error(`❌ 无法解析 snapshot：${e.message || e}`);
  process.exit(1);
}

const result = checkCatalogAgainstSnapshot(snapshot);
if (result.ok) {
  console.log(`✅ approval catalog 校验通过 · ${snapshotPath}`);
  process.exit(0);
}

console.error(`❌ approval catalog 校验失败 · ${snapshotPath}`);
for (const w of result.warnings) {
  console.error(`  - ${w}`);
}
process.exit(1);
