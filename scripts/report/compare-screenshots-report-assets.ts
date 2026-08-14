import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { compareReportVizCss, compareReportVizJs } from './compare-report-viz.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

export function compareReportCss(): string {
  const css = fs.readFileSync(path.join(dir, 'compare-screenshots-report.css'), 'utf-8');
  return `${css}\n${compareReportVizCss()}`;
}

export function compareReportClientJs(): string {
  const js = fs.readFileSync(path.join(dir, 'compare-screenshots-report.js'), 'utf-8');
  return `${js}\n${compareReportVizJs()}`;
}
