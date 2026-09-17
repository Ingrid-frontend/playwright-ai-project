const fs = require('fs');
const path = require('path');
const { send, logLine } = require('./ws-safe');

const COMPARE_REPORT_REL = path.join('results', 'screenshot-comparison.html');
const CUSTOMER_REPORT_REL = path.join('results', 'ui-regression-customer.html');
const DELIVERY_PREVIEW_REL = path.join('results', 'feishu-delivery-preview.html');

function resolveCustomerReportRel(envId) {
  const id = String(envId || '').trim().toLowerCase();
  if (id) return path.join('results', `ui-regression-customer-${id}.html`);
  return CUSTOMER_REPORT_REL;
}

function repoHasScreenshotPng(dir) {
  if (!fs.existsSync(dir)) return false;
  let found = false;
  const walk = (current) => {
    if (found) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (found) break;
      if (ent.name.startsWith('.')) continue;
      const full = path.join(current, ent.name);
      if (ent.isFile() && /\.png$/i.test(ent.name)) {
        found = true;
        break;
      }
      if (ent.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return found;
}

function compareReportOpenPath() {
  return `/repo-report/${COMPARE_REPORT_REL.split(path.sep).join('/')}`;
}

function customerReportOpenPath(envId) {
  const rel = resolveCustomerReportRel(envId);
  return `/repo-report/${rel.split(path.sep).join('/')}`;
}

function deliveryPreviewOpenPath() {
  return `/repo-report/${DELIVERY_PREVIEW_REL.split(path.sep).join('/')}`;
}

function sendCompareReportReady(ws, extra = {}) {
  send(ws, 'repo:compare-report:done', { ok: true, openPath: compareReportOpenPath(), ...extra });
  logLine(ws, `[repo] 对比报告就绪: ${compareReportOpenPath()}`, 'ok');
}

function sendCustomerReportReady(ws, extra = {}) {
  const openPath = extra.openPath || customerReportOpenPath(extra.envId);
  send(ws, 'repo:customer-report:done', { ok: true, openPath, ...extra });
  logLine(ws, `[repo] 客户报告就绪: ${openPath}`, 'ok');
}

function readUiIssuesSummary(repoRoot) {
  const p = path.join(repoRoot, 'results/ui-issues.json');
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return data.summary || null;
  } catch {
    return null;
  }
}

function getCompareReportStatus(repoRoot, envId) {
  const customerRel = resolveCustomerReportRel(envId);
  const absReport = path.join(repoRoot, COMPARE_REPORT_REL);
  const absCustomer = path.join(repoRoot, customerRel);
  const absPreview = path.join(repoRoot, DELIVERY_PREVIEW_REL);
  const hasReport = fs.existsSync(absReport);
  const hasCustomerReport = fs.existsSync(absCustomer);
  const hasDeliveryPreview = fs.existsSync(absPreview);
  const hasScreenshots = repoHasScreenshotPng(path.join(repoRoot, 'screenshots'));
  return {
    hasReport,
    hasCustomerReport,
    hasDeliveryPreview,
    hasScreenshots,
    envId: envId || '',
    openPath: hasReport ? compareReportOpenPath() : null,
    customerOpenPath: hasCustomerReport ? customerReportOpenPath(envId) : null,
    previewOpenPath: hasDeliveryPreview ? deliveryPreviewOpenPath() : null,
    reportRel: COMPARE_REPORT_REL,
    customerReportRel: customerRel,
    previewReportRel: DELIVERY_PREVIEW_REL,
    uiIssues: readUiIssuesSummary(repoRoot),
  };
}

function isAllowedRepoPublicPath(fromRoot) {
  const parts = fromRoot.split('/');
  const top = parts[0];
  if (top === 'results' || top === 'screenshots' || top === 'screenshots-baseline') return true;
  if (top === 'playwright-report') return true;
  if ((top === 'request-flow' || top === 'approval-flow') && parts[1] === 'playwright-report') return true;
  return false;
}

/** 仅允许通过 Studio 暴露仓库内白名单目录 */
function resolveRepoPublicReadFile(repoRoot, urlRel) {
  const rel = decodeURIComponent(String(urlRel || '').replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!rel || rel.split('/').some((s) => !s || s === '..')) return null;
  const abs = path.normalize(path.join(repoRoot, ...rel.split('/')));
  const root = path.resolve(repoRoot);
  if (!abs.startsWith(root + path.sep)) return null;
  const fromRoot = path.relative(root, abs).replace(/\\/g, '/');
  if (!isAllowedRepoPublicPath(fromRoot)) return null;
  return abs;
}

async function sendRepoUiIssues(ws, resolveRepoRoot) {
  const repoRoot = resolveRepoRoot();
  const p = path.join(repoRoot, 'results/ui-issues.json');
  if (!fs.existsSync(p)) {
    send(ws, 'repo:ui-issues', { ok: true, issues: [], summary: null });
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    send(ws, 'repo:ui-issues', { ok: true, ...data });
  } catch (e) {
    send(ws, 'error', { message: `读取 ui-issues.json 失败: ${e.message}` });
    send(ws, 'repo:ui-issues', { ok: false });
  }
}

function sendCompareReportStatus(ws, repoRoot, envId) {
  send(ws, 'repo:compare-report:status', getCompareReportStatus(repoRoot, envId));
}

module.exports = {
  COMPARE_REPORT_REL,
  CUSTOMER_REPORT_REL,
  DELIVERY_PREVIEW_REL,
  resolveCustomerReportRel,
  repoHasScreenshotPng,
  compareReportOpenPath,
  customerReportOpenPath,
  deliveryPreviewOpenPath,
  readUiIssuesSummary,
  getCompareReportStatus,
  sendCompareReportReady,
  sendCustomerReportReady,
  resolveRepoPublicReadFile,
  sendRepoUiIssues,
  sendCompareReportStatus,
};
