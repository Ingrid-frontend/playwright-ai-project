#!/usr/bin/env tsx
/**
 * CLI：登记一条手动 UI 反馈（供 Studio API / 客户报告标注调用）
 *
 * echo '{"reporter":"张三","description":"@李四 按钮未对齐"}' | npm run feedback:submit
 */
import fs from 'fs';
import { appendManualFeedback, parseAssignees } from '../report/ui-feedback-doc.js';
import { writeManualFeedbackToBitable } from '../feishu/write-feedback-bitable.js';

type SubmitBody = {
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
  syncFeishu?: boolean;
};

async function readBody(): Promise<SubmitBody> {
  const fileArg = process.argv.find((a) => a.startsWith('--file='))?.slice('--file='.length);
  if (fileArg && fs.existsSync(fileArg)) {
    return JSON.parse(fs.readFileSync(fileArg, 'utf-8')) as SubmitBody;
  }
  const jsonArg = process.argv.find((a) => a.startsWith('--json='))?.slice('--json='.length);
  if (jsonArg) return JSON.parse(jsonArg) as SubmitBody;
  if (!process.stdin.isTTY) {
    const raw = await new Promise<string>((resolve, reject) => {
      let buf = '';
      process.stdin.on('data', (c) => (buf += c));
      process.stdin.on('end', () => resolve(buf));
      process.stdin.on('error', reject);
    });
    return JSON.parse(raw || '{}') as SubmitBody;
  }
  throw new Error('需要 --json= 或 stdin JSON');
}

async function main() {
  const body = await readBody();
  if (!body.reporter?.trim()) throw new Error('缺少 reporter（登记人姓名）');
  if (!body.description?.trim()) throw new Error('缺少 description（问题描述）');

  const assignees = parseAssignees(body.description);
  const entry = appendManualFeedback({
    reporter: body.reporter.trim(),
    description: body.description.trim(),
    env: body.env,
    url: body.url,
    scriptKey: body.scriptKey,
    stepName: body.stepName,
    stepNumber: body.stepNumber,
    bbox: body.bbox,
    selector: body.selector,
    xpath: body.xpath,
    screenshotPath: body.screenshotPath,
    assignees,
  });

  if (body.syncFeishu !== false) {
    const sync = await writeManualFeedbackToBitable([entry]);
    if (!sync.skipped && sync.written) {
      console.log(`📊 已同步飞书反馈表`);
    }
  }

  const out = {
    ok: true,
    id: entry.id,
    aiDocPath: entry.aiDocPath,
  };
  console.log(JSON.stringify(out));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
