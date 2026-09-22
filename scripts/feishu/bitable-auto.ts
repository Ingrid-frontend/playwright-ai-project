import { execSync } from 'child_process';
import type { BitableWriteInput, BitableWriteResult } from './write-bitable-report.js';
import { writeBitableReport } from './write-bitable-report.js';

export function isAutoBitableEnabled(): boolean {
  return process.env.FEISHU_BITABLE_AUTO !== '0';
}

export function ensureBitableFields(): void {
  if (process.env.FEISHU_BITABLE_AUTO_FIX_FIELDS === '0') return;
  try {
    execSync('npm run feishu:bitable-setup -- --fix-fields', {
      cwd: process.cwd(),
      stdio: 'pipe',
      encoding: 'utf-8',
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️  飞书字段补齐跳过: ${msg.slice(0, 200)}`);
  }
}

export async function writeBitableIfAuto(input: BitableWriteInput = {}): Promise<BitableWriteResult | null> {
  if (!isAutoBitableEnabled()) return null;
  const result = await writeBitableReport(input);
  if (!result.skipped) {
    console.log(`📊 飞书多维表已自动同步${result.issueRecordCount ? `（${result.issueRecordCount} 条问题）` : ''}`);
  }
  return result;
}
