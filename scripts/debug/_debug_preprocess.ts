import { stripBom, stripLeadingRecordingTitle, ensurePlaywrightImport, ensureTestWrapper } from '../preprocess/preprocess-raw-recordings.js';
import fs from 'fs';

const raw = fs.readFileSync('tests/raw-recordings/original/20260512/合同-新建表单与提交_2026-05-12.spec.ts', 'utf-8');
let out = stripBom(raw);
console.log('=== After stripBom ===');
out.split('\n').slice(0,8).forEach((l,i) => console.log(i + ':', JSON.stringify(l)));

out = stripLeadingRecordingTitle(out);
console.log('=== After stripLeadingRecordingTitle ===');
out.split('\n').slice(0,8).forEach((l,i) => console.log(i + ':', JSON.stringify(l)));

out = ensurePlaywrightImport(out);
console.log('=== After ensurePlaywrightImport ===');
out.split('\n').slice(0,8).forEach((l,i) => console.log(i + ':', JSON.stringify(l)));

out = ensureTestWrapper(out);
console.log('=== After ensureTestWrapper ===');
out.split('\n').slice(0,8).forEach((l,i) => console.log(i + ':', JSON.stringify(l)));
